/**
 * Open Media AI (ADR 0028): one private AI conversation in Messages for every model a person uses.
 *
 * - Routing: a free built-in model (Llama on Cloudflare Workers AI) answers by default. People who
 *   bring their own key (OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek, xAI) are
 *   routed to it through the open-source AI SDK (Apache-2.0), straight to the provider.
 * - No settings screen: pasting a key into the chat saves it, and saying “use Claude” or “ask GPT
 *   …” picks a model. The key is encrypted here with a key the database never sees, the message
 *   holding it is never stored or shown to any model, and only its last four characters are kept
 *   in view.
 * - History: every exchange, including AI search summaries, is stored in the person's own
 *   ai_messages rows, which row-level security keeps private to them.
 */
import { createHmac } from 'node:crypto';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel, type ModelMessage } from 'ai';

import { decryptSecret, encryptSecret } from './crypto.js';
import { UserFacingError } from './errors.js';
import type { AiBinding } from './searchAssist.js';

export interface AiChatEnv {
  AI?: AiBinding;
  /** Optional dedicated key; otherwise one is derived from MAIL_CREDENTIALS_KEY. */
  AI_KEYS_KEY?: string;
  MAIL_CREDENTIALS_KEY?: string;
}

export const builtInModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const maxMessageLength = 8000;
const historyTurns = 24;
const maxReply = 1600;

export type ProviderId = 'built-in' | 'openai' | 'anthropic' | 'google' | 'openrouter' | 'groq' | 'mistral' | 'deepseek' | 'xai';

interface Provider {
  name: string;
  /** Words that name this provider or its models in a message. */
  mention: RegExp;
  /** Shape of its API keys, when the key alone identifies the provider. */
  key?: RegExp;
  model: string;
  build?: (apiKey: string, model: string) => LanguageModel;
}

const compatible = (name: string, baseURL: string) => (apiKey: string, model: string) => createOpenAICompatible({ name, baseURL, apiKey })(model);

/** Order matters: the more specific key shapes come first (sk-ant- and sk-or- before sk-). */
export const providers: Record<ProviderId, Provider> = {
  'built-in': { name: 'Llama', mention: /\b(llama|built[- ]?in|open media ai|free model)\b/i, model: builtInModel },
  anthropic: { name: 'Claude', mention: /\b(claude|anthropic|opus|sonnet|haiku)\b/i, key: /\bsk-ant-[A-Za-z0-9_-]{20,}/, model: 'claude-sonnet-5-5', build: (apiKey, model) => createAnthropic({ apiKey })(model) },
  openrouter: { name: 'OpenRouter', mention: /\bopen ?router\b/i, key: /\bsk-or-v1-[A-Za-z0-9]{32,}/, model: 'openrouter/auto', build: compatible('openrouter', 'https://openrouter.ai/api/v1') },
  openai: { name: 'GPT', mention: /\b(gpt|chatgpt|openai|o\d)\b/i, key: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/, model: 'gpt-5.6', build: (apiKey, model) => createOpenAI({ apiKey })(model) },
  google: { name: 'Gemini', mention: /\b(gemini|google ai)\b/i, key: /\bAIza[0-9A-Za-z_-]{35}\b/, model: 'gemini-3.8-flash', build: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model) },
  groq: { name: 'Groq', mention: /\bgroq\b/i, key: /\bgsk_[A-Za-z0-9]{40,}/, model: 'llama-3.3-70b-versatile', build: compatible('groq', 'https://api.groq.com/openai/v1') },
  xai: { name: 'Grok', mention: /\b(grok|xai|x\.ai)\b/i, key: /\bxai-[A-Za-z0-9]{40,}/, model: 'grok-4', build: compatible('xai', 'https://api.x.ai/v1') },
  // These two have no distinctive key prefix, so the message must name them.
  deepseek: { name: 'DeepSeek', mention: /\bdeep ?seek\b/i, model: 'deepseek-chat', build: compatible('deepseek', 'https://api.deepseek.com/v1') },
  mistral: { name: 'Mistral', mention: /\b(mistral|le chat)\b/i, model: 'mistral-large-latest', build: compatible('mistral', 'https://api.mistral.ai/v1') },
};

const providerIds = Object.keys(providers) as ProviderId[];
const keyed = providerIds.filter((id) => id !== 'built-in');

export interface StoredKey { provider: ProviderId; ciphertext: string; hint: string }
export interface AiSettings { provider?: ProviderId; model?: string }
export interface AiRecord {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  source: 'chat' | 'search';
  provider?: string;
  model?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}
export type NewAiRecord = Omit<AiRecord, 'id' | 'createdAt'>;

/** Where the conversation and keys live; the Worker implements it with the person's own token. */
export interface AiStore {
  history(limit: number): Promise<AiRecord[]>;
  append(records: NewAiRecord[]): Promise<AiRecord[]>;
  keys(): Promise<StoredKey[]>;
  saveKey(key: StoredKey): Promise<void>;
  deleteKey(provider: ProviderId): Promise<void>;
  settings(): Promise<AiSettings>;
  saveSettings(settings: AiSettings): Promise<void>;
}

/** A separate key for AI provider keys, so they never share one with mailbox passwords. */
export function aiKeysKey(env: AiChatEnv): string {
  if (env.AI_KEYS_KEY) return env.AI_KEYS_KEY;
  if (!env.MAIL_CREDENTIALS_KEY) throw new UserFacingError('Saving AI keys isn’t available on this server.');
  return createHmac('sha256', Buffer.from(env.MAIL_CREDENTIALS_KEY, 'base64')).update('open-media-ai-keys-v1').digest('base64');
}

export interface FoundKey { provider: ProviderId; key: string }

/** API keys in a message, with the provider each belongs to. A provider named in the message wins for keys without a prefix. */
export function findKeys(text: string): FoundKey[] {
  const found: FoundKey[] = [];
  let rest = text;
  for (const id of keyed) {
    const pattern = providers[id].key;
    if (!pattern) continue;
    const match = rest.match(pattern);
    if (!match) continue;
    // A plain sk-… key also fits DeepSeek's shape; the message decides.
    const provider = id === 'openai' && providers.deepseek.mention.test(text) ? 'deepseek' : id;
    found.push({ provider, key: match[0] });
    rest = rest.replace(match[0], ' ');
  }
  // Mistral keys are 32 letters and digits with no prefix: only taken when the message says Mistral.
  const mistral = providers.mistral.mention.test(text) ? rest.match(/\b[A-Za-z0-9]{32}\b/) : null;
  if (mistral) found.push({ provider: 'mistral', key: mistral[0] });
  return found;
}

/** The message with every key replaced, safe to store and show. */
export function withoutKeys(text: string, keys: FoundKey[]): string {
  return keys.reduce((value, { key }) => value.split(key).join(`…${key.slice(-4)}`), text);
}

export type Intent =
  | { kind: 'forget'; provider: ProviderId | 'all' }
  | { kind: 'default'; provider: ProviderId; model?: string }
  | { kind: 'models' }
  | { kind: 'ask'; provider?: ProviderId; text: string };

function named(text: string): ProviderId | undefined {
  return providerIds.find((id) => providers[id].mention.test(text));
}

/** What a message asks for. Plain questions are “ask”; a few short phrasings manage keys and models. */
export function intentOf(text: string): Intent {
  const trimmed = text.trim();
  if (/^(forget|remove|delete|disconnect)\b.{0,40}\bkeys?\b/i.test(trimmed) && trimmed.length < 80) {
    return { kind: 'forget', provider: /\ball\b/i.test(trimmed) ? 'all' : named(trimmed) ?? 'all' };
  }
  if (/^(which|what) (models?|keys?|ais?)\b|^(list|show)( my)? (models?|keys?)\b/i.test(trimmed) && trimmed.length < 80) return { kind: 'models' };
  const model = trimmed.match(/^(?:use|switch to) model ([A-Za-z0-9._:/@-]{2,80})\s*[.!]?$/i);
  if (model) return { kind: 'default', provider: named(model[1]) ?? 'openrouter', model: model[1] };
  const sticky = trimmed.match(/^(?:use|switch to|always use|default to)\s+(.{2,40}?)(?:\s+(?:from now on|by default|always|for everything))?\s*[.!]?$/i);
  if (sticky) {
    const provider = named(sticky[1]);
    if (provider) return { kind: 'default', provider };
  }
  // “@claude …”, “ask gemini …”, “claude: …” route one message.
  const once = trimmed.match(/^(?:@|ask\s+|hey\s+)?([A-Za-z.]+(?:\s?[A-Za-z]+)?)\s*[:,]\s*|^@([A-Za-z.]+)\s+|^ask\s+([A-Za-z.]+)\s+/i);
  const word = once?.[1] ?? once?.[2] ?? once?.[3];
  const provider = word ? named(word) : undefined;
  if (provider && once) return { kind: 'ask', provider, text: trimmed.slice(once[0].length).trim() || trimmed };
  return { kind: 'ask', text: trimmed };
}

export interface Route { provider: ProviderId; model: string; apiKey?: string }

/** Who answers: the model named in the message, else the person's choice, else their newest key, else the built-in model. */
export function chooseRoute(asked: ProviderId | undefined, settings: AiSettings, keys: Map<ProviderId, string>): Route | { missing: ProviderId } {
  const pick = (provider: ProviderId, model?: string): Route | { missing: ProviderId } => {
    if (provider === 'built-in') return { provider, model: builtInModel };
    const apiKey = keys.get(provider);
    return apiKey ? { provider, model: model ?? providers[provider].model, apiKey } : { missing: provider };
  };
  if (asked) return pick(asked, asked === settings.provider ? settings.model : undefined);
  if (settings.provider && (settings.provider === 'built-in' || keys.has(settings.provider))) return pick(settings.provider, settings.model);
  const newest = [...keys.keys()].at(-1);
  return newest ? pick(newest) : pick('built-in');
}

const system = [
  'You are Open Media AI, the assistant inside Open Media, an open social network and inbox.',
  'This is the person’s private AI chat. Earlier turns may include their AI searches of public posts.',
  'Answer clearly and briefly in Markdown. Say when you are unsure. You cannot see their messages, email, posts or settings, and you cannot act in the app; when they ask for that, tell them where in Open Media to do it.',
  'Never ask for passwords or API keys.',
].join(' ');

/** Earlier turns as model messages. Searches become a question and its summary. */
export function conversationFor(history: AiRecord[], text: string): ModelMessage[] {
  const turns: ModelMessage[] = history.slice(-historyTurns).map((record) => record.role === 'user'
    ? { role: 'user', content: record.source === 'search' ? `(AI search) ${record.body}` : record.body }
    : { role: 'assistant', content: record.body });
  turns.push({ role: 'user', content: text });
  // Models need the turns to start with the person.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export async function answer(route: Route, messages: ModelMessage[], env: AiChatEnv): Promise<string> {
  if (route.provider === 'built-in') {
    if (!env.AI) throw new UserFacingError('The built-in AI isn’t available on this server.');
    const output = await env.AI.run(builtInModel, { messages: [{ role: 'system', content: system }, ...messages], max_tokens: 900, temperature: 0.4 }) as { response?: unknown };
    return typeof output.response === 'string' ? output.response.trim() : '';
  }
  const result = await generateText({ model: providers[route.provider].build!(route.apiKey!, route.model), system, messages, maxOutputTokens: 1200, maxRetries: 1, abortSignal: AbortSignal.timeout(45_000) });
  return result.text.trim();
}

/** A provider error said plainly, without echoing anything that could hold a key. */
export function providerProblem(error: unknown): string {
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403) return 'didn’t accept the saved key';
  if (status === 402 || status === 429) return 'is out of credit or busy';
  if (status === 404) return 'doesn’t offer that model';
  if ((error as { name?: string })?.name === 'TimeoutError') return 'took too long';
  return 'didn’t answer';
}

export type Runner = (route: Route, messages: ModelMessage[], env: AiChatEnv) => Promise<string>;

/**
 * Handles one message in the AI chat and returns the records added. Keys are saved and removed
 * here; everything else is a question for the chosen model.
 */
export async function chat(input: unknown, store: AiStore, env: AiChatEnv, run: Runner = answer): Promise<AiRecord[]> {
  const raw = typeof (input as { text?: unknown })?.text === 'string' ? (input as { text: string }).text : '';
  if (!raw.trim()) throw new UserFacingError('Write a message first.');
  if (raw.length > maxMessageLength) throw new UserFacingError(`Messages to the AI can be up to ${maxMessageLength.toLocaleString('en-US')} characters.`);
  const reply = (body: string, extra: Partial<NewAiRecord> = {}): NewAiRecord => ({ role: 'assistant', body, source: 'chat', provider: 'open-media', ...extra });

  const found = findKeys(raw);
  if (found.length) {
    const secret = aiKeysKey(env);
    for (const { provider, key } of found) await store.saveKey({ provider, ciphertext: encryptSecret(key, secret), hint: key.slice(-4) });
    const names = found.map(({ provider, key }) => `${providers[provider].name} (key ending ${key.slice(-4)})`).join(' and ');
    const first = found[0].provider;
    await store.saveSettings({ provider: first });
    const shown = withoutKeys(raw, found);
    return store.append([
      { role: 'user', body: shown, source: 'chat', meta: { redacted: true } },
      reply(`Saved ${names}. It’s encrypted, and I’ll never show it again. From now on ${providers[first].name} answers here, using ${providers[first].model}. Say “use Llama” to go back to the free model, or “forget my ${providers[first].name} key” to remove it.`),
    ]);
  }

  const intent = intentOf(raw);
  const stored = await store.keys();
  const keys = new Map<ProviderId, string>();
  const hints = new Map<ProviderId, string>();
  for (const key of stored) {
    hints.set(key.provider, key.hint);
    try { keys.set(key.provider, decryptSecret(key.ciphertext, aiKeysKey(env))); } catch { /* A key sealed with an old server key can't be used; it's listed so it can be removed. */ }
  }
  const settings = await store.settings();
  const asked: NewAiRecord = { role: 'user', body: raw.trim(), source: 'chat' };

  if (intent.kind === 'forget') {
    const gone = intent.provider === 'all' ? [...hints.keys()] : hints.has(intent.provider as ProviderId) ? [intent.provider as ProviderId] : [];
    for (const provider of gone) await store.deleteKey(provider);
    if (settings.provider && gone.includes(settings.provider)) await store.saveSettings({});
    const text = gone.length ? `Removed your ${gone.map((id) => providers[id].name).join(', ')} key${gone.length > 1 ? 's' : ''}. Nothing of it is kept.` : 'There was no saved key to remove.';
    return store.append([asked, reply(text)]);
  }
  if (intent.kind === 'models') {
    const current = chooseRoute(undefined, settings, keys);
    const lines = [
      `- **Llama** (${builtInModel.split('/').pop()}): free, built in${'provider' in current && current.provider === 'built-in' ? ' · answering now' : ''}`,
      ...[...hints.entries()].map(([id, hint]) => `- **${providers[id].name}**: your key ending ${hint}${'provider' in current && current.provider === id ? ` · answering now with ${current.model}` : ''}`),
    ];
    return store.append([asked, reply(`${lines.join('\n')}\n\nPaste an API key from OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek or xAI to add it. Say “use Claude”, or start a message with “@gemini”, to choose who answers.`)]);
  }
  if (intent.kind === 'default') {
    const route = chooseRoute(intent.provider, { provider: intent.provider, model: intent.model }, keys);
    if ('missing' in route) return store.append([asked, reply(missingKey(route.missing))]);
    await store.saveSettings({ provider: intent.provider, model: intent.model });
    return store.append([asked, reply(`${providers[intent.provider].name} answers here from now on, using ${route.model}.`)]);
  }

  const route = chooseRoute(intent.provider, settings, keys);
  if ('missing' in route) return store.append([asked, reply(missingKey(route.missing))]);
  const messages = conversationFor(await store.history(historyTurns), intent.text);
  try {
    const text = (await run(route, messages, env)).slice(0, maxReply * 4);
    if (!text) throw new Error('empty');
    return store.append([asked, reply(text, { provider: route.provider, model: route.model })]);
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    if (route.provider === 'built-in') throw new UserFacingError('The AI didn’t answer. Try again.');
    // A provider that fails falls back to the built-in model, and says so.
    const fallback: Route = { provider: 'built-in', model: builtInModel };
    const text = await run(fallback, messages, env).catch(() => '');
    if (!text) throw new UserFacingError(`${providers[route.provider].name} ${providerProblem(error)}, and the built-in AI didn’t answer either. Try again.`);
    return store.append([asked, reply(text, { provider: 'built-in', model: builtInModel, meta: { fallbackFrom: route.provider, reason: providerProblem(error) } })]);
  }
}

function missingKey(provider: ProviderId): string {
  return `To use ${providers[provider].name}, paste your ${providers[provider].name} API key here${provider === 'mistral' || provider === 'deepseek' ? ` and say it’s for ${providers[provider].name}` : ''}. It’s encrypted and never shown again. Until then, Llama answers for free.`;
}

/** An AI search, recorded in the AI chat as the search and its summary. */
export function searchRecords(result: { query: string; answer: string; citations: string[]; model: string }): NewAiRecord[] {
  return [
    { role: 'user', body: result.query, source: 'search' },
    { role: 'assistant', body: result.answer, source: 'search', provider: 'built-in', model: result.model, meta: { citations: result.citations } },
  ];
}

/** Saves an AI search to the person's AI chat with their own token; row-level security decides whose. */
export async function recordSearch(env: { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string }, token: string, result: Parameters<typeof searchRecords>[0], fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/ai_messages`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(searchRecords(result).map((item) => ({ role: item.role, body: item.body, source: item.source, provider: item.provider ?? null, model: item.model ?? null, meta: item.meta ?? {} }))),
  });
  if (!response.ok) throw new Error(`AI search not recorded (${response.status})`);
}

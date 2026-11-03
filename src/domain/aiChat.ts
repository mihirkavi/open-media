import { Conversation, Message, Person } from './models';

/**
 * Open Media AI (ADR 0028): every model a person talks to, and every AI search, in one
 * conversation in Messages. It always sits first, under the Open Media mark.
 */

export const aiConversationId = 'open-media-ai';

/** Something Open Media AI did on the person's device, applied by the app (ADR 0028). */
export type AiAction =
  | { type: 'appearance'; value: 'system' | 'light' | 'dark' }
  | { type: 'translate'; value: boolean }
  | { type: 'feed'; value: string }
  | { type: 'open'; value: string };
export const aiPersonId = 'open-media-ai';

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

export const aiPerson: Person = { id: aiPersonId, name: 'Open Media AI', initials: 'AI', avatarColor: '#000000', identities: [] };

export function isAiConversation(conversation: Pick<Conversation, 'id'>): boolean {
  return conversation.id === aiConversationId;
}

/** Who wrote an answer, in words: “Claude · claude-sonnet-5-5”, “Llama (Claude didn’t accept the saved key)”. */
export function aiByline(record: Pick<AiRecord, 'role' | 'source' | 'provider' | 'model' | 'meta'>): string | undefined {
  if (record.role !== 'assistant') return record.source === 'search' ? 'AI search' : undefined;
  if (record.provider === 'open-media' || !record.provider) return undefined;
  const names: Record<string, string> = { 'built-in': 'Llama', openai: 'GPT', anthropic: 'Claude', google: 'Gemini', openrouter: 'OpenRouter', groq: 'Groq', mistral: 'Mistral', deepseek: 'DeepSeek', xai: 'Grok' };
  const name = names[record.provider] ?? record.provider;
  // The built-in model is named plainly; others show the exact model the person chose.
  const model = record.provider === 'built-in' ? 'free' : record.model?.split('/').pop();
  const from = typeof record.meta?.fallbackFrom === 'string' ? names[record.meta.fallbackFrom] ?? record.meta.fallbackFrom : undefined;
  const label = `${record.source === 'search' ? 'AI search · ' : ''}${name}${model && model.toLowerCase() !== name.toLowerCase() ? ` · ${model}` : ''}`;
  return from ? `${label} · ${from} ${String(record.meta?.reason ?? 'didn’t answer')}` : label;
}

const welcome = 'Hi! I’m Open Media AI. Ask me anything, or ask me to do things for you: “set my theme to dark”, “less Hive and more videos in my feed”, “help me connect my email”, or “give me a tour”. I’m one chat for every AI you use: a free model answers by default, and you can paste an API key from ChatGPT, Claude, Gemini or OpenRouter to use your own. Your AI searches are saved here too.';

/** The AI conversation, built from its saved messages. A new one opens with a short welcome. */
export function aiConversation(records: AiRecord[], currentUserId: string): Conversation {
  const messages: Message[] = records.map((record) => ({
    id: `ai:${record.id}`,
    sourceMessageId: record.id,
    conversationId: aiConversationId,
    senderPersonId: record.role === 'user' ? currentUserId : aiPersonId,
    senderIdentityId: record.role === 'user' ? currentUserId : aiPersonId,
    recipientPersonIds: [record.role === 'user' ? aiPersonId : currentUserId],
    sentAt: record.createdAt,
    // A search summary's [1]-style citations point at posts that aren't in the chat.
    body: record.source === 'search' && record.role === 'assistant' ? record.body.replace(/\s?\[\d{1,2}(?:,\s?\d{1,2})*\]/g, '') : record.body,
    source: 'ai',
    channel: 'native',
    direction: record.role === 'user' ? 'outbound' : 'inbound',
    deliveryState: record.role === 'user' ? 'sent' : 'received',
    ai: { byline: aiByline(record), search: record.source === 'search', citations: Array.isArray(record.meta?.citations) ? (record.meta.citations as string[]) : undefined },
  }));
  if (!messages.length) messages.push({
    id: 'ai:welcome', sourceMessageId: 'welcome', conversationId: aiConversationId, senderPersonId: aiPersonId, senderIdentityId: aiPersonId,
    recipientPersonIds: [currentUserId], sentAt: new Date().toISOString(), body: welcome, source: 'ai', channel: 'native', direction: 'inbound', deliveryState: 'received', ai: {},
  });
  const last = messages[messages.length - 1];
  return {
    id: aiConversationId,
    participants: [aiPerson],
    messages,
    sourceSummary: ['ai'],
    lastMessageAt: last.sentAt,
    preview: last.body.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140),
    unreadCount: 0,
    labels: [],
  };
}

/** Hides anything shaped like an AI provider key, keeping its last four characters, while it is on its way. */
export function maskKeys(text: string): string {
  return text.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,})/g, (key) => `…${key.slice(-4)}`);
}

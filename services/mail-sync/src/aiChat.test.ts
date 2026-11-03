import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { agrees, AiRecord, AiSettings, AiStore, AiToolkit, builtInModel, chat, chooseRoute, conversationFor, findKeys, intentOf, NewAiRecord, recordSearch, Route, StoredKey, withoutKeys, withoutToolTalk } from './aiChat.js';

// Made-up keys in each provider's shape; none is real.
const fake = {
  openai: `sk-proj-${'a1B2'.repeat(12)}`,
  anthropic: `sk-ant-api03-${'Zx9_'.repeat(10)}`,
  openrouter: `sk-or-v1-${'0f'.repeat(32)}`,
  google: `AIza${'Sy0_example-key'.padEnd(35, 'x')}`,
  groq: `gsk_${'Q7'.repeat(26)}`,
};

function memoryStore() {
  const records: AiRecord[] = [];
  const keys = new Map<string, StoredKey>();
  let settings: AiSettings = {};
  const store: AiStore = {
    history: async (limit) => records.slice(-limit),
    append: async (items: NewAiRecord[]) => items.map((item) => { const record = { ...item, id: String(records.length), createdAt: new Date().toISOString() }; records.push(record); return record; }),
    keys: async () => [...keys.values()],
    saveKey: async (key) => { keys.delete(key.provider); keys.set(key.provider, key); },
    deleteKey: async (provider) => { keys.delete(provider); },
    settings: async () => settings,
    saveSettings: async (next) => { settings = next; },
  };
  return { store, records, keys, settings: () => settings };
}

const env = { MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') };

test('pasted keys are recognised by their shape, and a message naming the provider settles keys without a prefix', () => {
  assert.deepEqual(findKeys(`here you go ${fake.anthropic}`).map((key) => key.provider), ['anthropic']);
  assert.deepEqual(findKeys(fake.openrouter).map((key) => key.provider), ['openrouter'], 'an OpenRouter key is not mistaken for OpenAI');
  assert.deepEqual(findKeys(`${fake.openai} and ${fake.google}`).map((key) => key.provider).sort(), ['google', 'openai']);
  assert.deepEqual(findKeys(`my deepseek key ${fake.openai}`).map((key) => key.provider), ['deepseek']);
  assert.deepEqual(findKeys(`mistral key ${'M'.repeat(16)}${'7'.repeat(16)}`).map((key) => key.provider), ['mistral']);
  assert.deepEqual(findKeys('what is sk-learn and why is AIza short'), [], 'ordinary words are not keys');
  assert.equal(withoutKeys(`key ${fake.groq} thanks`, findKeys(`key ${fake.groq}`)), `key …${fake.groq.slice(-4)} thanks`);
});

test('plain questions are questions; a few short phrasings choose or forget a model', () => {
  assert.deepEqual(intentOf('What happened in Lisbon today?'), { kind: 'ask', text: 'What happened in Lisbon today?' });
  assert.deepEqual(intentOf('Hello, how are you?'), { kind: 'ask', text: 'Hello, how are you?' });
  assert.deepEqual(intentOf('@claude write me a haiku'), { kind: 'ask', provider: 'anthropic', text: 'write me a haiku' });
  assert.deepEqual(intentOf('Gemini: summarise this'), { kind: 'ask', provider: 'google', text: 'summarise this' });
  assert.deepEqual(intentOf('use GPT from now on'), { kind: 'default', provider: 'openai' });
  assert.deepEqual(intentOf('use llama'), { kind: 'default', provider: 'built-in' });
  assert.deepEqual(intentOf('use model anthropic/claude-opus-5-5'), { kind: 'default', provider: 'anthropic', model: 'anthropic/claude-opus-5-5' });
  assert.deepEqual(intentOf('forget my OpenAI key'), { kind: 'forget', provider: 'openai' });
  assert.deepEqual(intentOf('which models'), { kind: 'models' });
  assert.equal(intentOf('Should I use Claude or GPT for coding? I write a lot of TypeScript.').kind, 'ask', 'a question that mentions models is still a question');
});

test('routing: the model named wins, then the person’s choice, then their newest key, then the free built-in model', () => {
  const keys = new Map([['openai', 'k1'], ['anthropic', 'k2']] as const);
  assert.deepEqual(chooseRoute(undefined, {}, new Map()), { provider: 'built-in', model: builtInModel });
  assert.equal((chooseRoute(undefined, {}, new Map(keys)) as Route).provider, 'anthropic');
  assert.equal((chooseRoute(undefined, { provider: 'openai' }, new Map(keys)) as Route).provider, 'openai');
  assert.equal((chooseRoute('anthropic', { provider: 'openai', model: 'gpt-x' }, new Map(keys)) as Route).model, 'claude-sonnet-5-5', 'a one-off never borrows another provider’s model');
  assert.deepEqual(chooseRoute('google', {}, new Map(keys)), { missing: 'google' });
});

test('a pasted key is saved encrypted, never stored in the chat and never sent to a model', async () => {
  const memory = memoryStore();
  const seen: string[] = [];
  const run = async (route: Route, messages: { content: unknown }[]) => { seen.push(`${route.provider}:${JSON.stringify(messages)}`); return 'Hi!'; };
  const [mine, saved] = await chat({ text: `Here is my key ${fake.anthropic}` }, memory.store, env, run as never);
  assert.ok(!mine.body.includes(fake.anthropic) && mine.body.includes(fake.anthropic.slice(-4)));
  assert.match(saved.body, /Saved Claude/);
  const stored = memory.keys.get('anthropic')!;
  assert.ok(!stored.ciphertext.includes(fake.anthropic.slice(8, 20)), 'only ciphertext is stored');
  assert.equal(memory.settings().provider, 'anthropic');

  await chat({ text: 'Plan my week' }, memory.store, env, run as never);
  assert.ok(seen[0].startsWith('anthropic:'));
  assert.ok(!seen.some((line) => line.includes(fake.anthropic)), 'no model ever sees the key');
  assert.ok(!memory.records.some((record) => record.body.includes(fake.anthropic)));
  assert.equal(memory.records.at(-1)?.provider, 'anthropic');
});

test('a provider that fails falls back to the built-in model and says why; forgetting a key goes back to free', async () => {
  const memory = memoryStore();
  await chat({ text: fake.openai }, memory.store, env, (async () => 'x') as never);
  const run = async (route: Route) => { if (route.provider === 'openai') throw Object.assign(new Error('nope'), { statusCode: 401 }); return 'From Llama'; };
  const [, reply] = await chat({ text: 'Hello?' }, memory.store, env, run as never);
  assert.equal(reply.provider, 'built-in');
  assert.deepEqual(reply.meta, { fallbackFrom: 'openai', reason: 'didn’t accept the saved key' });

  const [, gone] = await chat({ text: 'forget my OpenAI key' }, memory.store, env, run as never);
  assert.match(gone.body, /Removed your GPT key/);
  assert.equal(memory.keys.size, 0);
  const [, free] = await chat({ text: 'Still there?' }, memory.store, env, run as never);
  assert.equal(free.provider, 'built-in');
  const [, ask] = await chat({ text: '@claude hi' }, memory.store, env, run as never);
  assert.match(ask.body, /paste your Claude API key/);
});

test('AI searches join the conversation the model sees, and are saved with the person’s own token', async () => {
  const history: AiRecord[] = [
    { id: '1', role: 'assistant', body: 'Welcome', source: 'chat', createdAt: '' },
    { id: '2', role: 'user', body: 'ethereum fees', source: 'search', createdAt: '' },
    { id: '3', role: 'assistant', body: 'Posts say fees fell [1].', source: 'search', createdAt: '' },
  ];
  const turns = conversationFor(history, 'Why did they fall?');
  assert.deepEqual(turns.map((turn) => turn.role), ['user', 'assistant', 'user'], 'turns start with the person');
  assert.equal(turns[0].content, '(AI search) ethereum fees');

  let sent: { url: string; init?: RequestInit } | undefined;
  await recordSearch({ SUPABASE_URL: 'https://db.test/', SUPABASE_PUBLISHABLE_KEY: 'pk' }, 'person-token', { query: 'q', answer: 'a', citations: ['p1'], model: 'm' }, (async (url: string, init?: RequestInit) => { sent = { url, init }; return new Response(null, { status: 201 }); }) as never);
  assert.equal(sent?.url, 'https://db.test/rest/v1/ai_messages');
  assert.equal((sent?.init?.headers as Record<string, string>).authorization, 'Bearer person-token');
  assert.deepEqual(JSON.parse(String(sent?.init?.body)).map((row: { source: string }) => row.source), ['search', 'search']);
});

test('a yes is a yes, and tool talk never reaches the person', () => {
  for (const yes of ['yes', 'Yes please', 'ok', 'sure, go ahead', 'do it', 'Sounds good']) assert.equal(agrees(yes), true, yes);
  for (const no of ['no', 'not yet', 'what would change?', 'yesterday was fun', 'okayish idea, but no']) assert.equal(agrees(no), false, no);
  assert.equal(withoutToolTalk('Done, your feed has less Hive.\nI used the function `tune_feed_lens` with {"key":"relevant"}.'), 'Done, your feed has less Hive.');
  assert.equal(withoutToolTalk('Here is the preview:\n{"id":"my-relevant","manifest":{}}\nSave it?'), 'Save it?');
  assert.equal(withoutToolTalk('Opened Settings using the `open_settings` function.'), 'Opened Settings.');
});

test('a proposed change waits for the person, and their yes carries out exactly that change', async () => {
  const memory = memoryStore();
  const ran: string[] = [];
  let latestSeen = '';
  memory.store.toolkit = (latest) => {
    latestSeen = latest;
    const kit: AiToolkit = { tools: {}, actions: [], used: [], run: async (name, args) => { ran.push(`${name}:${JSON.stringify(args)}`); kit.used.push(name); return '{"understood":["Much less Hive"]}'; } };
    return kit;
  };
  // The model proposes (the toolkit records what it would do) and asks.
  const proposing = async () => { memory.store.toolkit!('x'); return 'I’ll make Hive much less common. Shall I?'; };
  const wrapped = memory.store.toolkit;
  memory.store.toolkit = (latest) => { const kit = wrapped(latest); kit.pending = { name: 'tune_feed_lens', args: { key: 'relevant', request: 'less hive' } }; return kit; };
  const [, proposal] = await chat({ text: 'less hive please' }, memory.store, env, proposing as never);
  assert.deepEqual(proposal.meta?.pending, { name: 'tune_feed_lens', args: { key: 'relevant', request: 'less hive' } });
  assert.deepEqual(ran, [], 'nothing changes before the yes');

  memory.store.toolkit = wrapped;
  const [, done] = await chat({ text: 'yes' }, memory.store, env, (async () => 'Done: Hive is now much less common.') as never);
  assert.deepEqual(ran, ['tune_feed_lens:{"key":"relevant","request":"less hive"}']);
  assert.equal(latestSeen, 'yes');
  assert.deepEqual(done.meta?.used, ['tune_feed_lens']);

  // A second yes has nothing left to approve, so nothing runs again.
  await chat({ text: 'yes' }, memory.store, env, (async () => 'Anything else?') as never);
  assert.equal(ran.length, 1);
});

test('app actions travel with the answer', async () => {
  const memory = memoryStore();
  memory.store.toolkit = () => ({ tools: {}, actions: [{ type: 'appearance', value: 'dark' }], used: ['change_app_setting'], run: async () => '' });
  const [, reply] = await chat({ text: 'set my theme to dark' }, memory.store, env, (async () => 'Your theme is now dark.') as never);
  assert.deepEqual(reply.meta, { actions: [{ type: 'appearance', value: 'dark' }], used: ['change_app_setting'] });
});

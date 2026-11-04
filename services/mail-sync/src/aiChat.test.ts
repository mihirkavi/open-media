import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { encryptSecret } from './crypto.js';
import { aiKeysKey, agrees, answeredBefore, clientIdOf, describeChanged, inBatches, plainOutcome, aiKeysSummary, AiRecord, AiSettings, AiStore, AiToolkit, builtInModel, chat, chooseAiModel, chooseRoute, conversationFor, findKeys, intentOf, NewAiRecord, ownSearchModel, pendingOf, recordSearch, removeAiKey, Route, saveAiKey, StoredKey, withoutKeys, withoutToolTalk } from './aiChat.js';

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
  assert.match(ask.body, /add your Claude API key in Settings → Open Media AI/);
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
  memory.store.toolkit = (latest) => { const kit = wrapped(latest); kit.pending = [{ name: 'tune_feed_lens', args: { key: 'relevant', request: 'less hive' } }]; return kit; };
  const [, proposal] = await chat({ text: 'less hive please' }, memory.store, env, proposing as never);
  assert.deepEqual(proposal.meta?.pending, [{ name: 'tune_feed_lens', args: { key: 'relevant', request: 'less hive' } }]);
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

test('one yes carries out every change proposed in that answer, and an older single proposal still works', async () => {
  const memory = memoryStore();
  const ran: string[] = [];
  const changes = [{ name: 'tune_feed_lens', args: { key: 'relevant', request: 'more tech, no crypto' } }, { name: 'follow_web_feed', args: { url: 'simonwillison.net' } }, { name: 'follow_web_feed', args: { url: 'nope.invalid' } }];
  memory.store.toolkit = () => {
    const kit: AiToolkit = { tools: {}, actions: [], used: [], run: async (name, args) => { if (args.url === 'nope.invalid') throw new Error('No feed there.'); ran.push(`${name}:${String(args.url ?? args.request)}`); kit.used.push(name); return 'ok'; } };
    return kit;
  };
  const plain = memory.store.toolkit;
  memory.store.toolkit = (latest) => { const kit = plain(latest); kit.pending = changes; return kit; };
  await chat({ text: 'tech feed and the best tech blogs please' }, memory.store, env, (async () => 'I’ll make three changes. Shall I?') as never);
  memory.store.toolkit = plain;
  let told = '';
  const [, done] = await chat({ text: 'yes' }, memory.store, env, (async (_route: unknown, messages: { content: string }[]) => { told = messages.at(-1)!.content; return 'Done.'; }) as never);
  assert.deepEqual(ran, ['tune_feed_lens:more tech, no crypto', 'follow_web_feed:simonwillison.net']);
  assert.match(told, /3 changes/);
  assert.match(told, /follow_web_feed: It didn’t work: No feed there\./);
  assert.deepEqual(done.meta?.used, ['tune_feed_lens', 'follow_web_feed']);
  assert.deepEqual(pendingOf({ name: 'tune_feed_lens', args: { key: 'relevant' } }), [{ name: 'tune_feed_lens', args: { key: 'relevant' } }]);
  assert.deepEqual(pendingOf('junk'), []);
});

test('a message sent again with the same id returns the first answer, and never asks or changes anything twice', async () => {
  const memory = memoryStore();
  let calls = 0;
  const run = async () => { calls += 1; return `Answer ${calls}`; };
  const first = await chat({ text: 'Plan my week', clientId: 'pending-1-abc' }, memory.store, env, run as never);
  const again = await chat({ text: 'Plan my week', clientId: 'pending-1-abc' }, memory.store, env, run as never);
  assert.equal(calls, 1);
  assert.deepEqual(again.map((record) => record.id), first.map((record) => record.id));
  assert.equal(first[0].meta?.clientId, 'pending-1-abc');
  await chat({ text: 'Plan my week', clientId: 'pending-2-abc' }, memory.store, env, run as never);
  assert.equal(calls, 2, 'a new message with the same words is a new question');
  assert.equal(clientIdOf({ clientId: 'bad id!' }), undefined);
  assert.equal(answeredBefore(memory.records, 'nope-123'), undefined);
});

test('twenty approved feeds run a few at a time, one that hangs gives up, and the ones that failed wait for another yes', async () => {
  const memory = memoryStore();
  let running = 0;
  let most = 0;
  const changes = Array.from({ length: 20 }, (_, index) => ({ name: 'follow_web_feed', args: { url: `site${index}.example` } }));
  const kit = (): AiToolkit => {
    const toolkit: AiToolkit = { tools: {}, actions: [], used: [], run: async (name, args) => {
      running += 1; most = Math.max(most, running);
      try {
        if (args.url === 'site3.example') throw new Error('No feed there.');
        await new Promise((resolve) => setTimeout(resolve, 5));
        toolkit.used.push(name);
        return 'ok';
      } finally { running -= 1; }
    } };
    return toolkit;
  };
  memory.store.toolkit = (latest) => { const toolkit = kit(); if (latest !== 'yes!') toolkit.pending = changes; return toolkit; };
  const [, proposal] = await chat({ text: 'add all the tech feeds' }, memory.store, env, (async () => { memory.store.toolkit!('x'); return 'Shall I add all 20?'; }) as never);
  assert.equal((proposal.meta?.pending as unknown[]).length, 20, 'more than twelve changes wait for one yes');
  // The model can't summarise: the person still gets a plain account, not “not sent”.
  const [, done] = await chat({ text: 'yes!' }, memory.store, env, (async () => { throw new Error('timeout'); }) as never);
  assert.ok(most > 1 && most <= 4, `ran ${most} at once`);
  assert.match(done.body, /19 feeds followed/);
  assert.match(done.body, /site3\.example: No feed there\./);
  assert.match(done.body, /Say yes to try the one that didn’t work again\./);
  assert.deepEqual(done.meta?.pending, [{ name: 'follow_web_feed', args: { url: 'site3.example' } }]);
});

test('changes already made are kept when the answer fails late, instead of the message showing as not sent', async () => {
  const memory = memoryStore();
  memory.store.toolkit = () => ({ tools: {}, actions: [], used: ['follow_web_feed', 'follow_web_feed'], changed: ['follow_web_feed', 'follow_web_feed'], run: async () => '' });
  let calls = 0;
  const [asked, reply] = await chat({ text: 'yes, add them' }, memory.store, env, (async () => { calls += 1; throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); }) as never);
  assert.equal(calls, 1, 'no second attempt that could make the changes again');
  assert.equal(asked.role, 'user');
  assert.match(reply.body, /Done so far: 2 feeds followed\. I couldn’t finish my answer/);
});

test('helpers: batches keep order, and changes are counted in words', async () => {
  assert.deepEqual(await inBatches([3, 1, 2], 2, async (n) => { await new Promise((resolve) => setTimeout(resolve, n)); return n * 10; }), [30, 10, 20]);
  assert.equal(describeChanged(['follow_web_feed', 'tune_feed_lens', 'follow_web_feed']), '2 feeds followed and 1 other change');
  assert.equal(describeChanged(['set_profile_fields']), '1 change');
  assert.equal(plainOutcome([{ change: { name: 'follow', args: { handle: 'a' } }, ok: false, text: 'Not found.' }]), 'None of those changes went through.\n- a: Not found.');
});

test('app actions travel with the answer', async () => {
  const memory = memoryStore();
  memory.store.toolkit = () => ({ tools: {}, actions: [{ type: 'appearance', value: 'dark' }], used: ['change_app_setting'], run: async () => '' });
  const [, reply] = await chat({ text: 'set my theme to dark' }, memory.store, env, (async () => 'Your theme is now dark.') as never);
  assert.deepEqual(reply.meta, { actions: [{ type: 'appearance', value: 'dark' }], used: ['change_app_setting'] });
});

test('when the free AI’s daily allowance is spent, the chat says so instead of failing', async () => {
  const memory = memoryStore();
  const spent = async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); };
  const [, reply] = await chat({ text: 'hello' }, memory.store, env, spent as never);
  assert.match(reply.body, /reached today’s limit.*midnight UTC.*add an API key.*Settings → Open Media AI/s);
  await chat({ text: fake.openai }, memory.store, env, (async () => 'x') as never);
  const failing = async (route: Route) => { if (route.provider === 'openai') throw Object.assign(new Error('nope'), { statusCode: 401 }); return spent(); };
  const [, both] = await chat({ text: 'hello again' }, memory.store, env, failing as never);
  assert.match(both.body, /^GPT didn’t accept the saved key\. The free built-in AI has reached today’s limit/);
});

test('Settings saves a key without a chat message, checks its shape, and never returns it', async () => {
  const { store, records, keys, settings } = memoryStore();
  await assert.rejects(saveAiKey('anthropic', { key: fake.openai }, store, env), /doesn’t look like a Claude key/);
  await assert.rejects(saveAiKey('anthropic', { key: 'short' }, store, env), /doesn’t look like an API key/);
  await assert.rejects(saveAiKey('nobody', { key: fake.anthropic }, store, env), /Choose one of/);
  await assert.rejects(saveAiKey('built-in', { key: fake.anthropic }, store, env), /Choose one of/);
  const summary = await saveAiKey('anthropic', { key: ` ${fake.anthropic} ` }, store, env);
  assert.equal(records.length, 0, 'nothing is written to the chat');
  assert.notEqual(keys.get('anthropic')?.ciphertext, fake.anthropic);
  assert.ok(!JSON.stringify(summary).includes(fake.anthropic.slice(0, -4)), 'the key never comes back');
  assert.deepEqual(summary.keys, [{ provider: 'anthropic', name: 'Claude', hint: fake.anthropic.slice(-4), model: 'claude-sonnet-5-5', usable: true }]);
  assert.equal(summary.answering.provider, 'anthropic');
  assert.equal(settings().provider, 'anthropic');
  // Mistral and DeepSeek keys have no prefix, so any key-like value is taken when the provider is chosen.
  assert.equal((await saveAiKey('mistral', { key: 'M'.repeat(32) }, store, env)).answering.provider, 'mistral');
});

test('Settings chooses who answers and removes keys; removing the one answering goes back to the free model', async () => {
  const { store, keys } = memoryStore();
  await saveAiKey('openai', { key: fake.openai }, store, env);
  await saveAiKey('google', { key: fake.google }, store, env);
  await assert.rejects(chooseAiModel({ provider: 'anthropic' }, store, env), /Add a Claude key first/);
  assert.equal((await chooseAiModel({ provider: 'openai' }, store, env)).answering.provider, 'openai');
  assert.equal((await chooseAiModel({ provider: 'built-in' }, store, env)).answering.provider, 'built-in');
  await chooseAiModel({ provider: 'google' }, store, env);
  const after = await removeAiKey('google', store, env);
  assert.equal(keys.has('google'), false);
  assert.deepEqual(after.keys.map((key) => key.provider), ['openai']);
  assert.equal(after.answering.provider, 'openai', 'the remaining key answers once the chosen one is gone');
  const other = { MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') };
  assert.equal((await aiKeysSummary(store, other)).keys[0].usable, false, 'a key sealed with an old server key is listed so it can be removed');
});

test('Search summaries use the model answering the person’s AI chat, read with their own token', async () => {
  const seen: string[] = [];
  const supabase = (stored: StoredKey[], settings: AiSettings[] = [], status = 200) => (async (url: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).authorization);
    if (status !== 200) return new Response('{}', { status });
    return Response.json(url.includes('ai_provider_keys') ? stored : settings);
  }) as never;
  const sealed = (provider: StoredKey['provider'], key: string): StoredKey => ({ provider, ciphertext: encryptSecret(key, aiKeysKey(env)), hint: key.slice(-4) });
  const config = { ...env, SUPABASE_URL: 'https://db.test/', SUPABASE_PUBLISHABLE_KEY: 'pk' };

  const own = await ownSearchModel(config, 'person-token', supabase([sealed('openai', fake.openai), sealed('anthropic', fake.anthropic)], [{ provider: 'openai', model: 'gpt-5.6-mini' }]));
  assert.deepEqual([own?.provider, own?.model, own?.name], ['openai', 'gpt-5.6-mini', 'GPT'], 'the chosen model, not just the newest key');
  assert.ok(seen.every((value) => value === 'Bearer person-token'));
  assert.equal(await ownSearchModel(config, 't', supabase([])), undefined, 'no key: the free model');
  assert.equal(await ownSearchModel(config, 't', supabase([sealed('openai', fake.openai)], [{ provider: 'built-in', model: null } as never])), undefined, 'chose the free model');
  assert.equal(await ownSearchModel({ ...config, MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') }, 't', supabase([sealed('openai', fake.openai)])), undefined, 'a key that can’t be opened');
  await assert.rejects(ownSearchModel(config, 'expired', supabase([], [], 401)), /not read \(401\)/);
});

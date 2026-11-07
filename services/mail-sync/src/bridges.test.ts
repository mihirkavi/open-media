import assert from 'node:assert/strict';
import test from 'node:test';

import { availableNetworks, Bridges, matrixUserFor, messageText, networkOfProtocol, toStep, withoutReadTimes } from './bridges.js';

const env = {
  BRIDGES_HOMESERVER_URL: 'http://hs.test',
  BRIDGES_SERVER_NAME: 'openmedia.test',
  BRIDGES_AS_TOKEN: 'as-token',
  BRIDGES_PROVISIONING_SECRET: 'provisioning-secret',
  BRIDGES_WHATSAPP_URL: 'http://wa.test',
};
const userId = '4493a42e-416b-41d0-baea-aed2666f5225';

test('each Open Media account maps to exactly one Matrix user', () => {
  assert.equal(matrixUserFor(userId, env), '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test');
  assert.throws(() => matrixUserFor('../../admin', env));
});

test('only networks with a configured bridge are offered', () => {
  assert.deepEqual(availableNetworks(env), ['whatsapp']);
  assert.deepEqual(availableNetworks({ ...env, BRIDGES_AS_TOKEN: undefined }), []);
});

test('login steps keep only what the app needs', () => {
  assert.deepEqual(toStep({ login_id: 'l1', type: 'display_and_wait', step_id: 's1', instructions: 'Scan', txn_id: 'secret', display_and_wait: { type: 'qr', data: 'https://wa.me/settings/linked_devices#abc' } }), {
    loginId: 'l1', stepId: 's1', instructions: 'Scan', type: 'display_and_wait', display: { type: 'qr', data: 'https://wa.me/settings/linked_devices#abc' },
  });
  assert.deepEqual(toStep({ login_id: 'l1', type: 'user_input', step_id: 's2', user_input: { fields: [{ id: 'phone_number', name: 'Phone number', type: 'phone_number' }] } }).fields, [{ id: 'phone_number', name: 'Phone number', description: undefined, type: 'phone_number' }]);
  assert.equal(toStep({ type: 'complete', login_id: 'l1', step_id: 's3' }).type, 'complete');
  assert.equal(toStep({ type: 'webauthn', login_id: 'l1', step_id: 's4' }).type, 'unsupported');
});

test('media messages get readable previews', () => {
  assert.equal(messageText({ msgtype: 'm.text', body: 'hi' }), 'hi');
  assert.equal(messageText({ msgtype: 'm.image', body: 'IMG_1.jpg' }), '📷 Photo');
});

test('every homeserver call acts as the signed-in person only', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
  try {
    await new Bridges(env, userId).send('!room:openmedia.test', 'hello');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/rooms\/!room%3Aopenmedia\.test\/send\/m\.room\.message\//);
  assert.match(calls[0], /user_id=%40om_4493a42e416b41d0baeaaed2666f5225%3Aopenmedia\.test$/);
});

test('room ids and message bodies are validated before reaching Matrix', async () => {
  const bridges = new Bridges(env, userId);
  await assert.rejects(() => bridges.send('../admin', 'hi'), /Chat not found/);
  await assert.rejects(() => bridges.send('!room:openmedia.test', '   '), /Write a message/);
});

test('cookie sign-ins list each value the person must copy', () => {
  const step = toStep({ login_id: 'l', step_id: 's', type: 'cookies', cookies: { url: 'https://www.instagram.com/', fields: [{ id: 'sessionid', required: true, sources: [{ type: 'cookie', name: 'sessionid', cookie_domain: 'instagram.com' }] }] } });
  assert.equal(step.type, 'cookies');
  assert.equal(step.url, 'https://www.instagram.com/');
  assert.deepEqual(step.fields, [{ id: 'sessionid', name: 'sessionid', description: 'cookie on instagram.com', type: 'cookie' }]);
});

async function withFetch(handler: (url: string, init?: RequestInit) => unknown, run: () => Promise<void>): Promise<string[]> {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return new Response(JSON.stringify(handler(String(input), init) ?? {}), { status: 200 });
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = realFetch; }
  return calls;
}

test('Messenger chats are recognised even though its bridge calls itself "facebook"', async () => {
  const me = '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test';
  const sync = { rooms: { join: { '!m:openmedia.test': {
    state: { events: [
      { type: 'm.bridge', state_key: 'x', content: { protocol: { id: 'facebook' } } },
      { type: 'm.room.member', state_key: me, content: { membership: 'join' } },
      { type: 'm.room.member', state_key: '@messenger_100:openmedia.test', content: { membership: 'join', displayname: 'Sam' } },
    ] },
    timeline: { events: [{ type: 'm.room.message', event_id: '$1', sender: '@messenger_100:openmedia.test', origin_server_ts: 1, content: { msgtype: 'm.text', body: 'hey' } }] },
  } } } };
  let result: Awaited<ReturnType<Bridges['conversations']>> | undefined;
  await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges({ ...env, BRIDGES_MESSENGER_URL: 'http://fb.test' }, userId).conversations(); });
  assert.equal(result?.rooms[0]?.network, 'messenger');
  assert.equal(networkOfProtocol('facebook'), 'messenger');
  assert.equal(networkOfProtocol('discordgo'), 'discord');
  assert.equal(networkOfProtocol('carrier-pigeon'), undefined);
});

test('a bridged chat shows even when the other side never joins (Signal contacts known only by number); management rooms and spaces stay hidden', async () => {
  const me = '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test';
  const bot = { type: 'm.room.member', state_key: '@signalbot:openmedia.test', content: { membership: 'join' } };
  const self = { type: 'm.room.member', state_key: me, content: { membership: 'join' } };
  const sync = { rooms: { join: {
    '!chat:openmedia.test': {
      state: { events: [{ type: 'm.bridge', state_key: 'x', content: { protocol: { id: 'signal' }, channel: { id: 'PNI:1', displayname: 'Alex' } } }, bot, self] },
      timeline: { events: [{ type: 'm.room.message', event_id: '$1', sender: me, origin_server_ts: 1, content: { msgtype: 'm.text', body: 'hi' } }] },
    },
    '!manage:openmedia.test': { state: { events: [bot, self] }, timeline: { events: [] } },
    '!space:openmedia.test': { state: { events: [{ type: 'm.room.create', state_key: '', content: { type: 'm.space' } }, { type: 'm.bridge', state_key: 'x', content: { protocol: { id: 'signal' }, channel: { id: 'space' } } }, bot, self] }, timeline: { events: [] } },
  } } };
  let result: Awaited<ReturnType<Bridges['conversations']>> | undefined;
  await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges({ ...env, BRIDGES_SIGNAL_URL: 'http://signal.test' }, userId).conversations(); });
  assert.deepEqual(result?.rooms.map((room) => [room.id, room.network, room.name, room.events.length]), [['!chat:openmedia.test', 'signal', 'Alex', 1]]);
});

test('Discord uses its older sign-in API: token sign-in, status from ping, logout', async () => {
  const discordEnv = { ...env, BRIDGES_DISCORD_URL: 'http://discord.test' };
  const bridges = new Bridges(discordEnv, userId);
  const calls = await withFetch((url) => url.includes('/v1/ping') ? { discord: { id: '42', logged_in: true, connected: true } } : {}, async () => {
    assert.deepEqual((await bridges.flows('discord')).map((flow) => flow.id), ['token']);
    const step = await bridges.startLogin('discord', 'token');
    assert.equal(step.type, 'cookies');
    assert.deepEqual(step.fields?.map((field) => [field.id, field.description]), [['token', 'request header']]);
    assert.equal((await bridges.continueLogin('discord', { loginId: step.loginId, stepId: step.stepId, type: 'cookies', values: { token: 'abc' } })).type, 'complete');
    const status = await bridges.status();
    assert.deepEqual(status.networks.find((network) => network.id === 'discord')?.logins, [{ id: '42', name: '', state: 'CONNECTED' }]);
    await bridges.logout('discord', '42');
  });
  const discordCalls = calls.filter((call) => call.includes('discord.test'));
  assert.deepEqual(discordCalls.map((call) => call.split('?')[0]), [
    'POST http://discord.test/_matrix/provision/v1/login/token',
    'GET http://discord.test/_matrix/provision/v1/ping',
    'POST http://discord.test/_matrix/provision/v1/logout',
  ]);
  assert.ok(discordCalls.every((call) => call.endsWith('user_id=%40om_4493a42e416b41d0baeaaed2666f5225%3Aopenmedia.test')));
  await assert.rejects(() => bridges.continueLogin('discord', { loginId: 'discord-token', stepId: 'token', type: 'cookies', values: { token: '' } }), /Paste your sign-in token/);
});

test('Google Voice is offered when its bridge is configured', () => {
  assert.deepEqual(availableNetworks({ ...env, BRIDGES_GVOICE_URL: 'http://gv.test' }), ['whatsapp', 'gvoice']);
});

/** A WhatsApp chat with Sam: two of your messages, then Sam's reply, then a third of yours. */
function receiptRoom(ephemeral: Array<Record<string, unknown>>, extra: Array<Record<string, unknown>> = [], unread?: number) {
  const me = '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test';
  const sam = '@whatsapp_44700:openmedia.test';
  const text = (id: string, sender: string, ts: number) => ({ type: 'm.room.message', event_id: id, sender, origin_server_ts: ts, content: { msgtype: 'm.text', body: id } });
  return { me, sam, sync: { rooms: { join: { '!w:openmedia.test': {
    state: { events: [
      { type: 'm.room.member', state_key: me, content: { membership: 'join' } },
      { type: 'm.room.member', state_key: sam, content: { membership: 'join', displayname: 'Sam' } },
    ] },
    timeline: { events: [text('$a', me, 1000), text('$b', me, 2000), ...extra, text('$c', sam, 3000), text('$d', sam, 4000), text('$e', me, 5000), text('$f', sam, 6000)] },
    ephemeral: { events: ephemeral },
    ...(unread === undefined ? {} : { unread_notifications: { notification_count: unread } }),
  } } } } };
}

test('bridged chats read Matrix receipts: read up to the other side\'s receipt, delivered from message status (ADR 0026)', async () => {
  const me = '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test';
  const sam = '@whatsapp_44700:openmedia.test';
  const { sync } = receiptRoom(
    [{ type: 'm.receipt', content: { $b: { 'm.read': { [sam]: { ts: 2500 } } }, $d: { 'm.read.private': { [me]: { ts: 4100 } } } } }],
    [{ type: 'com.beeper.message_send_status', event_id: '$s', sender: '@whatsappbot:openmedia.test', origin_server_ts: 1100, content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$e' }, status: 'SUCCESS', delivered_to_users: [sam] } }],
  );
  let result: Awaited<ReturnType<Bridges['conversations']>> | undefined;
  const calls = await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges(env, userId).conversations(); });
  assert.match(decodeURIComponent(calls.find((call) => call.includes('/sync'))!), /"ephemeral":\{"types":\["m.receipt"\]\}/);
  const events = Object.fromEntries(result!.rooms[0].events.map((event) => [event.id, event]));
  assert.equal(events.$a.readAt, 2500);
  assert.equal(events.$b.readAt, 2500);
  assert.equal(events.$b.deliveredAt, 2500, 'read implies delivered');
  assert.equal(events.$e.readAt, undefined, 'sent after the receipt');
  assert.equal(events.$e.deliveredAt, 1100, 'delivered, from the bridge\'s status event');
  assert.equal(events.$c.readAt, undefined, 'their messages carry no receipt');
  // Your own message after their messages counts as reading them; only $f is new.
  assert.equal(result!.rooms[0].unread, 1);
  // Someone who doesn't share receipts sees delivery but no read times.
  const hidden = withoutReadTimes(result!);
  assert.equal(hidden.rooms[0].events.find((event) => event.id === '$b')?.readAt, undefined);
  assert.equal(hidden.rooms[0].events.find((event) => event.id === '$b')?.deliveredAt, 2500);
});

test('without any receipt or message of yours in view, the server\'s unread count caps the count', async () => {
  const { sync } = receiptRoom([], [], 1);
  const room = sync.rooms.join['!w:openmedia.test'];
  room.timeline.events = room.timeline.events.filter((event) => event.sender !== '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test');
  let result: Awaited<ReturnType<Bridges['conversations']>> | undefined;
  await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges(env, userId).conversations(); });
  assert.equal(result!.rooms[0].unread, 1);
});

test('opening a bridged chat sends m.read, or a private receipt when read receipts are off', async () => {
  const bridges = new Bridges(env, userId);
  const shared = await withFetch(() => ({}), () => bridges.markRead('!w:openmedia.test', '$f', true));
  assert.match(shared[0], /^POST http:\/\/hs\.test\/_matrix\/client\/v3\/rooms\/!w%3Aopenmedia\.test\/receipt\/m\.read\/%24f\?user_id=%40om_/);
  const hidden = await withFetch(() => ({}), () => bridges.markRead('!w:openmedia.test', '$f', false));
  assert.match(hidden[0], /\/receipt\/m\.read\.private\/%24f/);
  await assert.rejects(bridges.markRead('!w:openmedia.test', 'not-an-event', true));
  await assert.rejects(bridges.markRead('../admin', '$f', true));
  // Room version 12 ids have no server part.
  const v12 = await withFetch(() => ({}), () => bridges.markRead('!C26jEaZ600yKt2YrYRwuuFqLX5Br7eYmjKK85Zyu9Sw', '$f', true));
  assert.match(v12[0], /\/rooms\/!C26jEaZ600yKt2YrYRwuuFqLX5Br7eYmjKK85Zyu9Sw\/receipt\/m\.read\//);
});

test('a chat marked unread (m.marked_unread) counts as one unread until read, and reading clears the mark', async () => {
  const { sync } = receiptRoom([{ type: 'm.receipt', content: { $f: { 'm.read.private': { '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.test': { ts: 7000 } } } } }]);
  const room = sync.rooms.join['!w:openmedia.test'] as Record<string, unknown>;
  let result: Awaited<ReturnType<Bridges['conversations']>> | undefined;
  await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges(env, userId).conversations(); });
  assert.equal(result!.rooms[0].unread, 0, 'read up to the newest message');
  room.account_data = { events: [{ type: 'm.marked_unread', content: { unread: true } }] };
  const calls = await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges(env, userId).conversations(); });
  assert.match(decodeURIComponent(calls.find((call) => call.includes('/sync'))!), /"account_data":\{"types":\["m.marked_unread","com.famedly.marked_unread"\]\}/);
  assert.equal(result!.rooms[0].unread, 1);
  room.account_data = { events: [{ type: 'com.famedly.marked_unread', content: { unread: true } }] };
  await withFetch((url) => url.includes('/sync') ? sync : {}, async () => { result = await new Bridges(env, userId).conversations(); });
  assert.equal(result!.rooms[0].unread, 1, 'the unstable name older clients write counts too');

  const bridges = new Bridges(env, userId);
  const marked = await withFetch(() => ({}), () => bridges.markUnread('!w:openmedia.test'));
  assert.ok(marked.some((call) => /^PUT http:\/\/hs\.test\/_matrix\/client\/v3\/user\/%40om_[^/]+\/rooms\/!w%3Aopenmedia\.test\/account_data\/m\.marked_unread/.test(call)));
  await assert.rejects(bridges.markUnread('../admin'));
  const read = await withFetch(() => ({}), () => bridges.markRead('!w:openmedia.test', '$f', true));
  assert.match(read[1], /^PUT .*\/account_data\/m\.marked_unread/, 'reading clears the mark');
});

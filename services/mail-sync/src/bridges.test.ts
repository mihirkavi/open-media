import assert from 'node:assert/strict';
import test from 'node:test';

import { availableNetworks, Bridges, matrixUserFor, messageText, networkOfProtocol, toStep } from './bridges.js';

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

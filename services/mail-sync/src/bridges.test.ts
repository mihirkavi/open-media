import assert from 'node:assert/strict';
import test from 'node:test';

import { availableNetworks, Bridges, matrixUserFor, messageText, toStep } from './bridges.js';

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

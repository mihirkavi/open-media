import assert from 'node:assert/strict';
import test from 'node:test';

import { meetsPasskeyStep } from './session.js';

test('a session that still owes its passkey step is refused, and the answer is cached briefly', async () => {
  let calls = 0;
  const refused = (async () => { calls += 1; return new Response('{"code":"open_media_passkey_required"}', { status: 403 }); }) as typeof fetch;
  assert.equal(await meetsPasskeyStep('http://db', 'key', 'token-a', refused, 1000), false);
  assert.equal(await meetsPasskeyStep('http://db', 'key', 'token-a', refused, 2000), false);
  assert.equal(calls, 1, 'checked once within a minute');
  assert.equal(await meetsPasskeyStep('http://db', 'key', 'token-a', refused, 62_000), false);
  assert.equal(calls, 2, 'checked again after a minute');
});

test('people without a passkey pass, and the check sends their own token', async () => {
  let seen: Headers | undefined;
  const allowed = (async (_url: string | URL | Request, init?: RequestInit) => { seen = new Headers(init?.headers); return Response.json(true); }) as typeof fetch;
  assert.equal(await meetsPasskeyStep('http://db', 'publishable', 'token-b', allowed, 1000), true);
  assert.equal(seen?.get('authorization'), 'Bearer token-b');
  assert.equal(seen?.get('apikey'), 'publishable');
});

test('a server error is not mistaken for permission', async () => {
  const failing = (async () => new Response('oops', { status: 500 })) as typeof fetch;
  await assert.rejects(meetsPasskeyStep('http://db', 'key', 'token-c', failing, 1000));
});

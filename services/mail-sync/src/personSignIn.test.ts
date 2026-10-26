import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAgentRequest } from './agentApi.js';

const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
const origin = 'https://api.test';

async function withAuthServer<T>(answer: (path: string, body: Record<string, unknown>) => Response, run: (calls: { path: string; body: Record<string, unknown> }[]) => Promise<T>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ path, body });
    return answer(path, body);
  }) as typeof fetch;
  try { return await run(calls); } finally { globalThis.fetch = realFetch; }
}
const post = (path: string, body: unknown) => handleAgentRequest(new Request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);

test('an agent signs a person in with the code from their email', async () => {
  await withAuthServer((path) => (path.startsWith('/auth/v1/verify')
    ? Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer', user: { id: 'u1', email: 'ada@example.test' } })
    : Response.json({})), async (calls) => {
    const sent = await (await post('/v1/auth/email-code', { email: ' Ada@Example.test ' })).json() as { sent: boolean; verify: string };
    assert.equal(sent.sent, true);
    assert.deepEqual(calls[0], { path: '/auth/v1/otp', body: { email: 'ada@example.test', create_user: true } });
    const session = await (await post('/v1/auth/verify', { email: 'ada@example.test', code: '1234 5678' })).json() as { access_token: string; refresh_token: string; next: { account_mcp: string } };
    assert.equal(session.access_token, 'at');
    assert.equal(session.refresh_token, 'rt');
    assert.equal(session.next.account_mcp, 'https://api.test/me/mcp');
    assert.deepEqual(calls[1].body, { type: 'email', email: 'ada@example.test', token: '12345678' });
  });
});

test('wrong codes, bad input and Supabase rate limits come back as clear errors', async () => {
  await withAuthServer((path) => (path.startsWith('/auth/v1/otp')
    ? new Response(JSON.stringify({ msg: 'For security purposes, you can only request this after 42 seconds.' }), { status: 429 })
    : new Response(JSON.stringify({ msg: 'Token has expired or is invalid' }), { status: 403 })), async () => {
    const limited = await post('/v1/auth/email-code', { email: 'ada@example.test' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '42');
    const wrong = await post('/v1/auth/verify', { email: 'ada@example.test', code: '00000000' });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json() as { error: { code: string } }).error.code, 'invalid_code');
    assert.equal((await post('/v1/auth/email-code', { email: 'not-an-email' })).status, 400);
    assert.equal((await post('/v1/auth/verify', { email: 'ada@example.test', code: 'abc' })).status, 400);
  });
});

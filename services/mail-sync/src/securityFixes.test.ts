import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAgentRequest } from './agentApi.js';
import { isPublicAddress } from './networkSafety.js';

const origin = 'https://api.test';

/** A limiter that allows `max` hits per key, like Cloudflare's binding within one window. */
function limiter(max: number) {
  const hits = new Map<string, number>();
  return { hits, limit: async ({ key }: { key: string }) => { const count = (hits.get(key) ?? 0) + 1; hits.set(key, count); return { success: count <= max }; } };
}

test('agent identities never lift the per-IP limit', async () => {
  const general = limiter(2);
  const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'x', PUBLIC_API_RATE_LIMITER: general };
  const ask = () => handleAgentRequest(new Request(`${origin}/v1/settings`, { headers: { 'cf-connecting-ip': '203.0.113.9' } }), env);
  assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 429);
  assert.equal(general.hits.get('ip:203.0.113.9'), 3);
});

test('sign-in codes are limited per email address and per IP, and agent registration per IP', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({})) as typeof fetch;
  try {
    const perEmail = limiter(3);
    const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'x', AUTH_RATE_LIMITER: limiter(100), AUTH_EMAIL_RATE_LIMITER: perEmail, REGISTRATION_RATE_LIMITER: limiter(1), MAIL_CREDENTIALS_KEY: Buffer.alloc(32).toString('base64') };
    const send = (email: string) => handleAgentRequest(new Request(`${origin}/v1/auth/email-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }), env);
    for (let index = 0; index < 3; index += 1) assert.equal((await send('Victim@Example.test')).status, 200);
    assert.equal((await send('victim@example.test')).status, 429, 'the same address, however it is written');
    assert.equal((await send('someone@example.test')).status, 200);
    const register = () => handleAgentRequest(new Request(`${origin}/agent/identity`, { method: 'POST', body: '{"type":"anonymous"}' }), env);
    assert.equal((await register()).status, 200);
    assert.equal((await register()).status, 429);
  } finally { globalThis.fetch = realFetch; }
});

test('large bodies are refused before they are read', async () => {
  const response = await handleAgentRequest(new Request(`${origin}/v1/auth/email-code`, { method: 'POST', headers: { 'content-length': String(5_000_000) }, body: 'x' }), { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'x' });
  assert.equal(response.status, 413);
});

test('mail servers must be on public addresses, including the less obvious private ranges', () => {
  for (const address of ['64:ff9b::7f00:1', '2002:7f00:1::1', '::ffff:7f00:1', '::ffff:127.0.0.1', '198.18.0.1', '192.0.0.8', '192.0.2.1', 'fec0::1', 'ff02::1', '100.64.0.1', '169.254.169.254']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['17.57.152.5', '2a00:1450:4001:80b::200e', '142.250.74.110']) assert.equal(isPublicAddress(address), true, address);
});

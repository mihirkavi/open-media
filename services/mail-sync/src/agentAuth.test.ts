import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { handleAgentRequest } from './agentApi.js';
import { agentFromRequest, exchangeAssertion, jwtBearerGrant, registerAgent } from './agentAuth.js';

const env = { MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') };
const origin = 'https://api.test';
const form = (assertion: string) => new URLSearchParams({ grant_type: jwtBearerGrant, assertion });
const bearer = (token: string) => new Request(`${origin}/v1/feed`, { headers: { authorization: `Bearer ${token}` } });

test('an anonymous agent registers, exchanges its assertion and is recognised by its token', async () => {
  const registration = await registerAgent(env, origin, { type: 'anonymous', name: 'test-agent' });
  assert.match(registration.registration_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(registration.pre_claim_scopes, ['public:read']);
  const token = await exchangeAssertion(env, origin, form(registration.identity_assertion));
  assert.equal(token.token_type, 'Bearer');
  assert.equal(token.scope, 'public:read');
  assert.equal(await agentFromRequest(env, origin, bearer(token.access_token)), `agent:${registration.registration_id}`);
});

test('only anonymous registration, only real assertions, and never a person’s token', async () => {
  await assert.rejects(registerAgent(env, origin, { type: 'service_auth', login_hint: 'a@b.test' }), /only/);
  const registration = await registerAgent(env, origin, { type: 'anonymous' });
  const tampered = `${registration.identity_assertion.slice(0, -4)}AAAA`;
  await assert.rejects(exchangeAssertion(env, origin, form(tampered)), /invalid or expired/);
  const token = await exchangeAssertion(env, origin, form(registration.identity_assertion));
  await assert.rejects(exchangeAssertion(env, origin, form(token.access_token)), /invalid or expired/, 'an access token is not an assertion');
  assert.equal(await agentFromRequest(env, origin, bearer(registration.identity_assertion)), undefined, 'an assertion is not an access token');
  const otherServer = { MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') };
  assert.equal(await agentFromRequest(otherServer, origin, bearer(token.access_token)), undefined, 'another server’s key rejects it');
  assert.equal(await agentFromRequest(env, 'https://other.test', bearer(token.access_token)), undefined, 'another origin rejects it');
});

test('the registration endpoint answers in OAuth error style', async () => {
  const ok = await handleAgentRequest(new Request(`${origin}/agent/identity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"anonymous"}' }), { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'x', ...env });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json() as { identity_assertion: string }).identity_assertion);
  const refused = await handleAgentRequest(new Request(`${origin}/agent/identity`, { method: 'POST', body: '{"type":"identity_assertion"}' }), { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'x', ...env });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json() as { error: string }).error, 'unsupported_identity_type');
});

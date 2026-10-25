import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';

import { decryptSecret } from './crypto.js';
import { handleVerificationWebhook, identityKey, isOver18, startVerification, validStripeSignature, VerificationEnv, verificationConfigured } from './verification.js';

const secret = 'whsec_test';
const env: VerificationEnv = {
  SUPABASE_URL: 'http://db.test', SUPABASE_SECRET_KEY: 'sb_secret_test', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_IDENTITY_WEBHOOK_SECRET: secret,
  MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64'),
};
const user = '6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11';
const sign = (body: string, at = Math.floor(Date.now() / 1000)) => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;

function fakeFetch(stripeSession: object) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? (String(init.body).startsWith('{') ? JSON.parse(String(init.body)) : String(init.body)) : undefined, headers: init?.headers as Record<string, string> });
    if (url.startsWith('https://api.stripe.com')) return new Response(JSON.stringify(stripeSession), { status: 200 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { impl, calls };
}

test('verification stays off until every key is set', async () => {
  assert.equal(verificationConfigured({ SUPABASE_URL: 'x' }), false);
  assert.equal(verificationConfigured({ ...env, STRIPE_SECRET_KEY: undefined }), false);
  assert.equal(verificationConfigured(env), true);
  await assert.rejects(startVerification({ SUPABASE_URL: 'x' }, user), /not available/);
});

test('starting asks Stripe for a document and live selfie, and records it as pending', async () => {
  const { impl, calls } = fakeFetch({ id: 'vs_1', url: 'https://verify.stripe.com/start/x' });
  const result = await startVerification(env, user, impl);
  assert.equal(result.url, 'https://verify.stripe.com/start/x');
  const form = new URLSearchParams(calls[0].body as string);
  assert.equal(form.get('type'), 'document');
  assert.equal(form.get('options[document][require_matching_selfie]'), 'true');
  assert.equal(form.get('metadata[open_media_user_id]'), user);
  assert.deepEqual(calls[1].body, { p_user: user, p_provider: 'stripe_identity', p_reference: 'vs_1', p_status: 'pending' });
});

test('only correctly signed, recent webhooks are accepted', () => {
  const body = '{"type":"x"}';
  assert.ok(validStripeSignature(body, sign(body), secret));
  assert.ok(!validStripeSignature(body, sign(body).replace(/v1=[0-9a-f]+/, `v1=${'0'.repeat(64)}`), secret));
  assert.ok(!validStripeSignature(`${body} `, sign(body), secret));
  assert.ok(!validStripeSignature(body, sign(body, Math.floor(Date.now() / 1000) - 3600), secret));
  assert.ok(!validStripeSignature(body, null, secret));
});

test('a verified result is re-read from Stripe and the legal name is stored encrypted', async () => {
  const { impl, calls } = fakeFetch({ id: 'vs_1', status: 'verified', verified_outputs: { first_name: 'Nora', last_name: 'Owl', dob: { day: 1, month: 2, year: 1990 }, address: { country: 'US' } } });
  const body = JSON.stringify({ type: 'identity.verification_session.verified', data: { object: { id: 'vs_1', metadata: { open_media_user_id: user } } } });
  assert.deepEqual(await handleVerificationWebhook(env, body, sign(body), impl), { received: true, status: 'verified' });
  assert.match(calls[0].url, /verification_sessions\/vs_1\?expand\[\]=verified_outputs$/);
  const recorded = calls[1].body as Record<string, unknown>;
  assert.equal(recorded.p_status, 'verified');
  assert.equal(recorded.p_age_over_18, true);
  assert.equal(recorded.p_document_country, 'US');
  assert.ok(!JSON.stringify(recorded).includes('Nora'), 'no plaintext name leaves the Worker');
  assert.equal(decryptSecret(String(recorded.p_legal_name_ciphertext), identityKey(env)), 'Nora Owl');
  assert.equal(calls[1].headers.apikey, 'sb_secret_test');
});

test('forged or unknown webhooks change nothing', async () => {
  const { impl, calls } = fakeFetch({});
  const body = JSON.stringify({ type: 'identity.verification_session.verified', data: { object: { id: 'vs_1', metadata: { open_media_user_id: user } } } });
  await assert.rejects(handleVerificationWebhook(env, body, 't=1,v1=00', impl), /Signature/);
  const other = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
  assert.deepEqual(await handleVerificationWebhook(env, other, sign(other), impl), { received: true });
  assert.equal(calls.length, 0);
});

test('age is computed from the date of birth', () => {
  const today = new Date(Date.UTC(2026, 9, 24));
  assert.equal(isOver18({ year: 2008, month: 10, day: 24 }, today), true);
  assert.equal(isOver18({ year: 2008, month: 10, day: 25 }, today), false);
  assert.equal(isOver18(null, today), null);
});

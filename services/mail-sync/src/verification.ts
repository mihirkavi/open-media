/**
 * Identity verification (ADR 0013, phase 2) through Stripe Identity.
 *
 * Off until the operator sets STRIPE_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET and
 * SUPABASE_SECRET_KEY; until then the app says verification is not available and nobody gets a
 * tick. Stripe keeps the document and selfie. Open Media keeps only the result: verified or not,
 * the legal name (encrypted here), the document country and whether the person is over 18.
 * Status changes arrive only through Stripe's signed webhook, never from the app.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { decryptSecret, encryptSecret } from './crypto.js';

export interface VerificationEnv {
  SUPABASE_URL: string;
  /** Server key used only for the two verification functions the database grants to service_role. */
  SUPABASE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_IDENTITY_WEBHOOK_SECRET?: string;
  /** Where Stripe sends people back after verifying, for example https://openmedia.app/#profile. */
  VERIFICATION_RETURN_URL?: string;
  IDENTITY_KEY?: string;
  MAIL_CREDENTIALS_KEY?: string;
}

type Fetch = typeof fetch;
const stripeApi = 'https://api.stripe.com/v1';
const signatureTolerance = 300;

export function verificationConfigured(env: VerificationEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_IDENTITY_WEBHOOK_SECRET && env.SUPABASE_SECRET_KEY && identityKeyOrUndefined(env));
}

function identityKeyOrUndefined(env: VerificationEnv): string | undefined {
  if (env.IDENTITY_KEY) return env.IDENTITY_KEY;
  if (!env.MAIL_CREDENTIALS_KEY) return undefined;
  return createHmac('sha256', Buffer.from(env.MAIL_CREDENTIALS_KEY, 'base64')).update('open-media-legal-name-v1').digest('base64');
}

/** A key for legal names alone, so they never share one with mailbox passwords or contacts. */
export function identityKey(env: VerificationEnv): string {
  const key = identityKeyOrUndefined(env);
  if (!key) throw new Error('Identity verification is not configured on this server.');
  return key;
}

export class VerificationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function stripe<T>(env: VerificationEnv, fetchImpl: Fetch, method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
  const response = await fetchImpl(`${stripeApi}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new VerificationError(502, 'provider_error', 'The identity provider did not accept the request. Try again shortly.');
  return body;
}

async function recordResult(env: VerificationEnv, fetchImpl: Fetch, name: string, args: Record<string, unknown>): Promise<void> {
  const key = env.SUPABASE_SECRET_KEY!;
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new VerificationError(502, 'storage_error', 'Could not record the verification result.');
}

/** Starts a hosted Stripe Identity check (document plus matching selfie) and returns its URL. */
export async function startVerification(env: VerificationEnv, userId: string, fetchImpl: Fetch = fetch): Promise<{ url: string; provider: 'stripe_identity' }> {
  if (!verificationConfigured(env)) throw new VerificationError(503, 'not_configured', 'Identity verification is not available yet.');
  const session = await stripe<{ id: string; url: string }>(env, fetchImpl, 'POST', '/identity/verification_sessions', {
    type: 'document',
    'options[document][require_matching_selfie]': 'true',
    'options[document][require_live_capture]': 'true',
    client_reference_id: userId,
    'metadata[open_media_user_id]': userId,
    ...(env.VERIFICATION_RETURN_URL ? { return_url: env.VERIFICATION_RETURN_URL } : {}),
  });
  await recordResult(env, fetchImpl, 'open_media_record_verification', { p_user: userId, p_provider: 'stripe_identity', p_reference: session.id, p_status: 'pending' });
  return { url: session.url, provider: 'stripe_identity' };
}

/** Checks Stripe's signature (HMAC-SHA256 over "timestamp.body") within five minutes. */
export function validStripeSignature(body: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = header.split(',').map((part) => part.split('=') as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > signatureTolerance) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return parts.filter(([key]) => key === 'v1').some(([, value]) => {
    const given = Buffer.from(value ?? '', 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface VerifiedOutputs {
  first_name?: string | null;
  last_name?: string | null;
  dob?: { day?: number | null; month?: number | null; year?: number | null } | null;
  address?: { country?: string | null } | null;
}

export function isOver18(dob: VerifiedOutputs['dob'], today = new Date()): boolean | null {
  if (!dob?.year || !dob.month || !dob.day) return null;
  const eighteenth = Date.UTC(dob.year + 18, dob.month - 1, dob.day);
  return eighteenth <= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

const statusForEvent: Record<string, 'verified' | 'failed' | 'revoked'> = {
  'identity.verification_session.verified': 'verified',
  'identity.verification_session.requires_input': 'failed',
  'identity.verification_session.canceled': 'failed',
  'identity.verification_session.redacted': 'revoked',
};

/** Handles one signed webhook. Unknown events are acknowledged and ignored. */
export async function handleVerificationWebhook(env: VerificationEnv, body: string, signature: string | null, fetchImpl: Fetch = fetch): Promise<{ received: true; status?: string }> {
  if (!verificationConfigured(env)) throw new VerificationError(503, 'not_configured', 'Identity verification is not available yet.');
  if (!validStripeSignature(body, signature, env.STRIPE_IDENTITY_WEBHOOK_SECRET!)) throw new VerificationError(400, 'bad_signature', 'Signature check failed.');
  const event = JSON.parse(body) as { type?: string; data?: { object?: { id?: string; metadata?: Record<string, string>; client_reference_id?: string } } };
  const status = statusForEvent[event.type ?? ''];
  const session = event.data?.object;
  const userId = session?.metadata?.open_media_user_id ?? session?.client_reference_id;
  if (!status || !session?.id || !userId || !/^[0-9a-f-]{36}$/i.test(userId)) return { received: true };
  if (status !== 'verified') {
    await recordResult(env, fetchImpl, 'open_media_record_verification', { p_user: userId, p_provider: 'stripe_identity', p_reference: session.id, p_status: status });
    return { received: true, status };
  }
  // Read the result from Stripe rather than trusting the event body.
  const full = await stripe<{ id: string; status: string; verified_outputs?: VerifiedOutputs | null }>(env, fetchImpl, 'GET', `/identity/verification_sessions/${encodeURIComponent(session.id)}?expand[]=verified_outputs`);
  if (full.status !== 'verified') return { received: true };
  const outputs = full.verified_outputs ?? {};
  const legalName = [outputs.first_name, outputs.last_name].filter((part) => part && part.trim()).join(' ').trim();
  const country = outputs.address?.country && /^[A-Z]{2}$/.test(outputs.address.country) ? outputs.address.country : null;
  await recordResult(env, fetchImpl, 'open_media_record_verification', {
    p_user: userId, p_provider: 'stripe_identity', p_reference: full.id, p_status: 'verified',
    p_legal_name_ciphertext: legalName ? encryptSecret(legalName, identityKey(env)) : null,
    p_document_country: country, p_age_over_18: isOver18(outputs.dob), p_expires_at: null,
  });
  return { received: true, status: 'verified' };
}

/**
 * After a verified person chooses to show their legal name, copies it out of the encrypted record
 * so the database can show it. The database refuses unless they are verified and chose it.
 */
export async function discloseLegalName(env: VerificationEnv, userId: string, ciphertext: string | null, fetchImpl: Fetch = fetch): Promise<void> {
  if (!verificationConfigured(env) || !ciphertext) throw new VerificationError(409, 'not_verified', 'Verify your identity before showing your legal name.');
  await recordResult(env, fetchImpl, 'open_media_set_disclosed_legal_name', { p_user: userId, p_name: decryptSecret(ciphertext, identityKey(env)) });
}

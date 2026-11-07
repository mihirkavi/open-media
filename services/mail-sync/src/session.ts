import { createRemoteJWKSet, jwtVerify } from 'jose';

// One key set per Supabase project, reused across requests so keys are not refetched every call.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Raised when the person has a passkey but this session hasn't used it yet (ADR 0034). */
export class PasskeyStepRequired extends Error {
  constructor() { super('Confirm this sign-in with your passkey first.'); }
}

/**
 * Verifies an Open Media (Supabase) access token against the project's published signing keys.
 * Someone who added a passkey must also have done the passkey step (aal2) for the token to count,
 * so routes that act with the Worker's own key can't be reached with a password alone.
 */
export async function authenticate(request: Request, supabaseURL: string, publishableKey: string, fetchImpl: typeof fetch = fetch): Promise<{ token: string; userId: string }> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('A valid Open Media session is required.');
  const token = authorization.slice(7);
  const base = supabaseURL.replace(/\/$/, '');
  let jwks = keySets.get(base);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`)); keySets.set(base, jwks); }
  const { payload } = await jwtVerify(token, jwks, { issuer: `${base}/auth/v1` });
  if (!payload.sub) throw new Error('A valid Open Media session is required.');
  if (payload.aal !== 'aal2' && !(await meetsPasskeyStep(base, publishableKey, token, fetchImpl))) throw new PasskeyStepRequired();
  return { token, userId: payload.sub };
}

// Short cache so a burst of requests checks once. A token's answer can only change from "no passkey"
// to "passkey added"; a minute's delay there is acceptable.
const passkeyChecks = new Map<string, { ok: boolean; until: number }>();

/** Asks the database (open_media_session_meets_mfa) whether this aal1 session is enough. */
export async function meetsPasskeyStep(supabaseURL: string, publishableKey: string, token: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  const cached = passkeyChecks.get(token);
  if (cached && cached.until > now) return cached.ok;
  const response = await fetchImpl(`${supabaseURL}/rest/v1/rpc/open_media_session_meets_mfa`, {
    method: 'POST',
    headers: { apikey: publishableKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  // The database's pre-request check answers 403 for a session that still owes its passkey step.
  if (response.status === 403) { remember(token, false, now); return false; }
  if (!response.ok) throw new Error('Could not check this session. Try again.');
  const ok = (await response.json()) === true;
  remember(token, ok, now);
  return ok;
}

function remember(token: string, ok: boolean, now: number) {
  if (passkeyChecks.size > 5000) passkeyChecks.clear();
  passkeyChecks.set(token, { ok, until: now + 60_000 });
}

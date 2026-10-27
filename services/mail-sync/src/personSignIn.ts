/**
 * Signing a person in from an agent, CLI or script: the same email code the app uses.
 *
 * 1. POST /v1/auth/email-code {email}: Open Media emails the person a sign-in code (and a link).
 * 2. The person tells the agent the code; POST /v1/auth/verify {email, code} returns their
 *    session: an access token for the account API and /me/mcp, and a refresh token.
 * 3. POST /v1/auth/refresh {refresh_token} renews it; POST /v1/auth/sign-out ends it.
 *
 * Nothing here can sign anyone in without the code from their inbox, and the tokens act only as
 * that person, under the same database rules as the app. New addresses become new accounts, which
 * then pick a name and handle with PUT /v1/me/profile.
 */

export interface SignInEnv { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string }

export class SignInError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSeconds?: number) { super(message); }
}

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
type Fetch = typeof fetch;

async function auth<T>(env: SignInEnv, fetchImpl: Fetch, path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; } })();
  if (response.ok) return payload as T;
  const message = String(payload.msg ?? payload.message ?? payload.error_description ?? '');
  if (response.status === 429 || /rate limit|security purposes/i.test(message)) {
    const wait = Number(message.match(/after (\d+) seconds/)?.[1]) || 60;
    throw new SignInError(429, 'rate_limited', `Too many sign-in emails for now. Try again in ${wait} seconds.`, wait);
  }
  if (response.status === 403 || /expired|invalid/i.test(message)) throw new SignInError(400, 'invalid_code', 'That code is wrong or has expired. Ask for a new one.');
  if (response.status === 422 && /signups? not allowed/i.test(message)) throw new SignInError(403, 'signups_closed', 'New accounts are closed right now.');
  throw new SignInError(response.status >= 500 ? 502 : 400, 'sign_in_failed', 'Sign-in failed. Try again shortly.');
}

function readEmail(body: unknown): string {
  const email = typeof (body as { email?: unknown })?.email === 'string' ? (body as { email: string }).email.trim().toLowerCase() : '';
  if (!emailPattern.test(email) || email.length > 254) throw new SignInError(400, 'bad_request', 'Send the person’s email address as “email”.');
  return email;
}

interface Session { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; token_type: string; user: { id: string; email?: string } }

function session(result: Session, origin: string) {
  return {
    access_token: result.access_token,
    token_type: 'Bearer',
    expires_in: result.expires_in,
    refresh_token: result.refresh_token,
    user: { id: result.user.id, email: result.user.email },
    next: {
      account_api: `${origin}/v1/me`,
      account_mcp: `${origin}/me/mcp`,
      finish_new_account: `PUT ${origin}/v1/me/profile with {"displayName": "…", "handle": "…"} if GET /v1/me answers no_profile`,
      refresh: `POST ${origin}/v1/auth/refresh with {"refresh_token": "…"} before ${result.expires_in} seconds pass`,
    },
  };
}

export async function requestSignInCode(env: SignInEnv, origin: string, body: unknown, fetchImpl: Fetch = fetch) {
  const email = readEmail(body);
  await auth(env, fetchImpl, '/otp', { email, create_user: true });
  return {
    sent: true, email,
    message: `Open Media emailed a sign-in code to ${email} from security@openmedia.site. Ask the person for the code, then POST it to ${origin}/v1/auth/verify.`,
    expires_in: 900,
    verify: `${origin}/v1/auth/verify`,
  };
}

export async function verifySignInCode(env: SignInEnv, origin: string, body: unknown, fetchImpl: Fetch = fetch) {
  const email = readEmail(body);
  const code = String((body as { code?: unknown })?.code ?? '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(code)) throw new SignInError(400, 'bad_request', 'Send the code from the email as “code” (digits only).');
  return session(await auth<Session>(env, fetchImpl, '/verify', { type: 'email', email, token: code }), origin);
}

export async function refreshSignIn(env: SignInEnv, origin: string, body: unknown, fetchImpl: Fetch = fetch) {
  const refreshToken = (body as { refresh_token?: unknown })?.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.length < 8) throw new SignInError(400, 'bad_request', 'Send the refresh_token from sign-in.');
  try {
    return session(await auth<Session>(env, fetchImpl, '/token?grant_type=refresh_token', { refresh_token: refreshToken }), origin);
  } catch (error) {
    if (error instanceof SignInError && error.code === 'invalid_code') throw new SignInError(401, 'invalid_refresh_token', 'That refresh token is no longer valid. Sign in again with an email code.');
    throw error;
  }
}

export async function signOut(env: SignInEnv, accessToken: string | undefined, fetchImpl: Fetch = fetch) {
  if (!accessToken) throw new SignInError(401, 'unauthorized', 'Send the access token to sign out.');
  await auth(env, fetchImpl, '/logout?scope=local', {}, accessToken).catch((error) => { if (!(error instanceof SignInError) || error.status >= 500) throw error; });
  return { signedOut: true };
}

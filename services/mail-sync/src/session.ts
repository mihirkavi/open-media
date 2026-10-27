import { createRemoteJWKSet, jwtVerify } from 'jose';

// One key set per Supabase project, reused across requests so keys are not refetched every call.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verifies an Open Media (Supabase) access token against the project's published signing keys. */
export async function authenticate(request: Request, supabaseURL: string): Promise<{ token: string; userId: string }> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('A valid Open Media session is required.');
  const token = authorization.slice(7);
  let jwks = keySets.get(supabaseURL);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${supabaseURL}/auth/v1/.well-known/jwks.json`)); keySets.set(supabaseURL, jwks); }
  const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseURL}/auth/v1` });
  if (!payload.sub) throw new Error('A valid Open Media session is required.');
  return { token, userId: payload.sub };
}

import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Verifies an Open Media (Supabase) access token against the project's published signing keys. */
export async function authenticate(request: Request, supabaseURL: string): Promise<{ token: string; userId: string }> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('A valid Open Media session is required.');
  const token = authorization.slice(7);
  const jwks = createRemoteJWKSet(new URL(`${supabaseURL}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseURL}/auth/v1` });
  if (!payload.sub) throw new Error('A valid Open Media session is required.');
  return { token, userId: payload.sub };
}

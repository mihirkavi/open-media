import { createRemoteJWKSet, jwtVerify } from 'jose';
import { IncomingMessage } from 'node:http';

export async function authenticate(request: IncomingMessage): Promise<string> {
  const authorization = request.headers.authorization;
  const supabaseURL = process.env.SUPABASE_URL;
  if (authorization?.startsWith('Bearer ') && supabaseURL) {
    const jwks = createRemoteJWKSet(new URL(`${supabaseURL}/auth/v1/.well-known/jwks.json`));
    const { payload } = await jwtVerify(authorization.slice(7), jwks, { issuer: `${supabaseURL}/auth/v1` });
    if (!payload.sub) throw new Error('Session has no user ID.');
    return payload.sub;
  }
  const localUser = request.headers['x-convo-local-user'];
  if (process.env.NODE_ENV !== 'production' && process.env.CONVO_ALLOW_INSECURE_LOCAL_AUTH === 'true' && typeof localUser === 'string') return localUser;
  throw new Error('A valid Open Media session is required.');
}

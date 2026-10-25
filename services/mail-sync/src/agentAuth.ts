/**
 * Agent self-registration (WorkOS auth.md, "anonymous" type).
 *
 * An agent registers at POST /agent/identity and receives a signed identity assertion. It trades
 * that at /oauth/token (RFC 7523 JWT-bearer grant) for an access token with the `public:read`
 * scope. The token identifies the agent and gives it its own rate-limit bucket instead of sharing
 * one with everyone on its IP address. It never grants access to anyone's account: account calls
 * still need the person's own token. There is no claim ceremony and no revocation event stream;
 * assertions expire after 30 days and access tokens after an hour.
 */
import { createHmac } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

export interface AgentAuthEnv {
  MAIL_CREDENTIALS_KEY?: string;
  AGENT_AUTH_KEY?: string;
}

export const jwtBearerGrant = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const agentScopes = ['public:read'];
const assertionSeconds = 30 * 24 * 60 * 60;
const accessSeconds = 60 * 60;

export class AgentAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** A key for agent tokens alone, derived from the server key so no new secret is needed. */
function signingKey(env: AgentAuthEnv): Uint8Array {
  if (env.AGENT_AUTH_KEY) return new TextEncoder().encode(env.AGENT_AUTH_KEY);
  if (!env.MAIL_CREDENTIALS_KEY) throw new AgentAuthError(503, 'temporarily_unavailable', 'Agent registration is not available on this server.');
  return createHmac('sha256', Buffer.from(env.MAIL_CREDENTIALS_KEY, 'base64')).update('open-media-agent-auth-v1').digest();
}

export function agentAuthMetadata(origin: string) {
  return {
    skill: `${origin}/auth.md`,
    identity_endpoint: `${origin}/agent/identity`,
    identity_types_supported: ['anonymous'],
  };
}

/** POST /agent/identity: register an anonymous agent. */
export async function registerAgent(env: AgentAuthEnv, origin: string, body: unknown) {
  const input = (body && typeof body === 'object' ? body : {}) as { type?: unknown; name?: unknown };
  if (input.type !== 'anonymous') throw new AgentAuthError(400, 'unsupported_identity_type', 'Open Media supports only {"type": "anonymous"} registration.');
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : undefined;
  const registrationId = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + assertionSeconds;
  const assertion = await new SignJWT({ scope: agentScopes.join(' '), ...(name ? { agent_name: name } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'agent-identity+jwt' })
    .setIssuer(origin).setAudience(origin).setSubject(`agent:${registrationId}`)
    .setIssuedAt().setExpirationTime(expires)
    .sign(signingKey(env));
  return {
    registration_id: registrationId,
    identity_assertion: assertion,
    assertion_expires: new Date(expires * 1000).toISOString(),
    pre_claim_scopes: agentScopes,
    post_claim_scopes: [],
    token_endpoint: `${origin}/oauth/token`,
    note: 'Exchange identity_assertion at token_endpoint with grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer. Open Media offers no claim ceremony: agent tokens read public data with their own rate limit and never act as a person.',
  };
}

/** The JWT-bearer grant at /oauth/token: an identity assertion for an hour-long access token. */
export async function exchangeAssertion(env: AgentAuthEnv, origin: string, form: URLSearchParams) {
  const assertion = form.get('assertion');
  if (!assertion) throw new AgentAuthError(400, 'invalid_request', 'Send the identity_assertion as assertion.');
  let subject: string; let scope: string;
  try {
    const { payload, protectedHeader } = await jwtVerify(assertion, signingKey(env), { issuer: origin, audience: origin, algorithms: ['HS256'] });
    if (protectedHeader.typ !== 'agent-identity+jwt' || !String(payload.sub).startsWith('agent:')) throw new Error('not an identity assertion');
    subject = String(payload.sub); scope = String(payload.scope ?? '');
  } catch {
    throw new AgentAuthError(400, 'invalid_grant', 'The identity assertion is invalid or expired. Register again at /agent/identity.');
  }
  const accessToken = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'HS256', typ: 'agent-access+jwt' })
    .setIssuer(origin).setAudience(origin).setSubject(subject)
    .setIssuedAt().setExpirationTime(`${accessSeconds}s`)
    .sign(signingKey(env));
  return { access_token: accessToken, token_type: 'Bearer', expires_in: accessSeconds, scope };
}

/** The agent behind an agent access token, or undefined for anything else (including people's tokens). */
export async function agentFromRequest(env: AgentAuthEnv, origin: string, request: Request): Promise<string | undefined> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const { payload, protectedHeader } = await jwtVerify(header.slice(7), signingKey(env), { issuer: origin, audience: origin, algorithms: ['HS256'] });
    return protectedHeader.typ === 'agent-access+jwt' && String(payload.sub).startsWith('agent:') ? String(payload.sub) : undefined;
  } catch {
    return undefined;
  }
}

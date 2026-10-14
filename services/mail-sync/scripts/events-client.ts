/**
 * Minimal Open Media Events client for scripts: OAuth 2.1 (dynamic registration,
 * owner approval, PKCE) and MCP tool calls. Tokens and the owner code are never printed.
 */
export const base = (process.env.EVENTS_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const ownerCode = process.env.EVENTS_OWNER_CODE;
if (!ownerCode) throw new Error('Set EVENTS_OWNER_CODE (for production: security find-generic-password -s open-media-events-owner-code -a owner -w).');

const redirectUri = 'http://127.0.0.1:9/callback';

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.url}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function token(resource?: string): Promise<string> {
  const client = await json<{ client_id: string }>(await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Open Media E2E', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  }));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const authorize = new URL(`${base}/authorize`);
  authorize.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, scope: 'events:read events:write', state: 'e2e', code_challenge: challenge, code_challenge_method: 'S256', ...(resource ? { resource } : {}) }).toString();
  const page = await fetch(authorize, { redirect: 'manual' });
  const html = await page.text();
  if (!page.ok) throw new Error(`authorize page ${page.status}: ${html.slice(0, 200)}`);
  const challengeId = /name="challenge" value="([0-9a-f]{64})"/.exec(html)?.[1];
  const cookie = page.headers.get('set-cookie')?.split(';')[0];
  if (!challengeId || !cookie) throw new Error('Authorization page did not issue a challenge.');
  const complete = await fetch(`${base}/authorize/complete`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: base },
    body: new URLSearchParams({ challenge: challengeId, code: ownerCode!, approve: 'yes' }).toString(),
  });
  const location = complete.headers.get('location');
  if (complete.status !== 302 || !location) throw new Error(`Owner approval failed with ${complete.status}: ${(await complete.text()).slice(0, 200)}`);
  const code = new URL(location).searchParams.get('code');
  if (!code) throw new Error('No authorization code returned.');
  const tokens = await json<{ access_token: string; scope?: string }>(await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, ...(resource ? { resource } : {}) }).toString(),
  }));
  return tokens.access_token;
}

let rpcId = 0;
export async function mcp(accessToken: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} ${response.status}: ${text.slice(0, 300)}`);
  const payload = text.startsWith('event:') || text.startsWith('data:')
    ? JSON.parse(text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5)).join(''))
    : JSON.parse(text);
  if (payload.error) throw new Error(`MCP ${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

export async function call(accessToken: string, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await mcp(accessToken, 'tools/call', { name, arguments: args });
  const body = JSON.parse(result.content[0].text);
  if (result.isError) throw new Error(`${name}: ${body.message}`);
  return body;
}


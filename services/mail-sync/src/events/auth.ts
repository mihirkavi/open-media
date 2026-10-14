import { AuthorizationError, type AuthRequest, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';

import { grantedScopes } from './tools.js';

/**
 * Owner sign-in for the OAuth 2.1 authorization server that guards the MCP
 * endpoint. Layer 1 serves one person: they approve an AI client by entering a
 * private owner access code. The code itself is never stored, only its SHA-256.
 * The resulting grant is bound to a fixed internal user id, so agents can never
 * choose whose data they read.
 */
export interface AuthEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  EVENTS_OWNER_CODE_SHA256?: string;
  EVENTS_OWNER_USER_ID?: string;
  EVENTS_PUBLIC_ORIGIN?: string;
}

export interface GrantProps {
  userId: string;
  scopes: string[];
}

const CHALLENGE_COOKIE = 'om_events_oauth';
const CHALLENGE_TTL_SECONDS = 10 * 60;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
const ATTEMPT_LIMIT = 10;

export function isGrantProps(value: unknown): value is GrantProps {
  const props = value as GrantProps | undefined;
  return typeof props?.userId === 'string' && Array.isArray(props.scopes);
}

export async function handleAuthorization(request: Request, env: AuthEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === '/authorize' && request.method === 'GET') return beginAuthorization(request, env);
  if (url.pathname === '/authorize/complete' && request.method === 'POST') return finishAuthorization(request, env);
  if (url.pathname === '/authorize' || url.pathname === '/authorize/complete') return new Response('Method not allowed', { status: 405 });
  return undefined;
}

async function beginAuthorization(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.EVENTS_OWNER_CODE_SHA256 || !env.EVENTS_OWNER_USER_ID) {
    return html(page('Not configured', '<h1>Connections are not enabled</h1><p>The owner access code has not been configured on this server.</p>'), 503);
  }
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return oauthError(error);
    throw error;
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return html(page('Unknown client', '<h1>Unknown AI client</h1><p>This connection request is not registered.</p>'), 400);
  const challengeId = randomHex(32);
  const clientName = client.clientName?.slice(0, 120) || 'an AI client';
  await env.OAUTH_KV.put(`events-challenge:${challengeId}`, JSON.stringify({ oauthRequest, clientName }), { expirationTtl: CHALLENGE_TTL_SECONDS });
  return html(renderForm(challengeId, clientName, grantedScopes(oauthRequest.scope)), 200, {
    'set-cookie': `${CHALLENGE_COOKIE}=${challengeId}; Path=/authorize; Max-Age=${CHALLENGE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  });
}

async function finishAuthorization(request: Request, env: AuthEnv): Promise<Response> {
  const origin = request.headers.get('origin');
  const expected = env.EVENTS_PUBLIC_ORIGIN ?? new URL(request.url).origin;
  if (origin && origin !== expected && origin !== 'null') return html('Forbidden', 403);
  if (Number(request.headers.get('content-length') ?? '0') > 8_192) return html('Request too large', 413);
  // The sign-in form posts application/x-www-form-urlencoded.
  const form = new URLSearchParams(await request.text());
  const challengeId = String(form.get('challenge') ?? '');
  const cookie = /(?:^|;\s*)om_events_oauth=([0-9a-f]{64})/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (!/^[0-9a-f]{64}$/.test(challengeId) || cookie !== challengeId) return expiredPage();
  const raw = await env.OAUTH_KV.get(`events-challenge:${challengeId}`);
  if (!raw) return expiredPage();
  const challenge = JSON.parse(raw) as { oauthRequest: AuthRequest; clientName: string };
  const scopes = grantedScopes(challenge.oauthRequest.scope);
  const retry = (message: string, status: number) => html(renderForm(challengeId, challenge.clientName, scopes, message), status);

  if (form.get('approve') !== 'yes') return retry('Tick the box to approve this connection.', 400);
  if (!(await allowAttempt(request, env))) return retry('Too many attempts. Try again in 15 minutes.', 429);
  const code = String(form.get('code') ?? '');
  if (code.length < 12 || code.length > 200 || !timingSafeEqual(await sha256Hex(code), env.EVENTS_OWNER_CODE_SHA256 ?? '')) {
    return retry('That access code is not correct.', 401);
  }

  const userId = env.EVENTS_OWNER_USER_ID!;
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: challenge.oauthRequest,
    userId,
    metadata: { clientName: challenge.clientName },
    scope: scopes,
    props: { userId, scopes } satisfies GrantProps,
  });
  await env.OAUTH_KV.delete(`events-challenge:${challengeId}`);
  return new Response(null, {
    status: 302,
    headers: { location: redirectTo, 'cache-control': 'no-store', 'set-cookie': `${CHALLENGE_COOKIE}=; Path=/authorize; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
  });
}

async function allowAttempt(request: Request, env: AuthEnv): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const bucket = Math.floor(Date.now() / (ATTEMPT_WINDOW_SECONDS * 1000));
  const key = `events-auth-attempts:${await sha256Hex(`${ip}:${bucket}`)}`;
  const count = Number((await env.OAUTH_KV.get(key)) ?? '0');
  if (count >= ATTEMPT_LIMIT) return false;
  await env.OAUTH_KV.put(key, String(count + 1), { expirationTtl: ATTEMPT_WINDOW_SECONDS + 60 });
  return true;
}

function renderForm(challengeId: string, clientName: string, scopes: string[], error?: string): string {
  const labels: Record<string, string> = {
    'events:read': 'Search events and read your saved plans, registrations and preferences',
    'events:write': 'Save events, place calendar holds you approve, record registration outcomes and update preferences you confirm',
  };
  return page('Connect Open Media Events', `
<h1>Connect Open Media Events to ${escapeHtml(clientName)}</h1>
<p>Enter your owner access code to let this AI client use your event planner. The code stays on this server and is never shared with the AI client.</p>
${error ? `<p class="notice" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize/complete">
  <input type="hidden" name="challenge" value="${challengeId}">
  <label for="code">Owner access code</label>
  <input id="code" name="code" type="password" autocomplete="current-password" required minlength="12" maxlength="200">
  <h2>This connection can</h2>
  <ul>${scopes.map((scope) => `<li>${escapeHtml(labels[scope] ?? scope)}</li>`).join('')}</ul>
  <p class="fine">It cannot register you for events or buy tickets. Registration always happens on the event’s official page.</p>
  <div class="consent"><input id="approve" name="approve" type="checkbox" value="yes" required><label for="approve">I approve this connection.</label></div>
  <button type="submit">Connect</button>
</form>`);
}

function expiredPage(): Response {
  return html(page('Expired', '<h1>This connection request expired</h1><p>Go back to your AI client and choose Connect again.</p>'), 400);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--ink:#16181d;--muted:#5d6470;--line:#d8dce3;--accent:#2f5bd3}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1b1e25;--ink:#eef0f4;--muted:#a6adba;--line:#333845;--accent:#7c9cff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:520px;margin:8vh auto;padding:28px;background:var(--card);border:1px solid var(--line);border-radius:18px}
h1{font-size:24px;line-height:1.25;margin:0 0 12px}h2{font-size:16px;margin:22px 0 6px}p,li{color:var(--muted)}
label{display:block;font-weight:600;margin:16px 0 6px}input[type=password]{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink)}
.consent{display:flex;gap:10px;align-items:flex-start;margin:18px 0}.consent label{margin:0;font-weight:500}.consent input{margin-top:5px}
button{width:100%;border:0;border-radius:10px;padding:13px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.notice{padding:10px 12px;border-radius:10px;background:#fdecea;color:#8a1f11}.fine{font-size:14px}</style></head>
<body><main>${body}</main></body></html>`;
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com https://chat.openai.com https://claude.ai https://claude.com; frame-ancestors 'none'; base-uri 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function oauthError(error: AuthorizationError): Response {
  if (!error.redirectUri) return html(page('Connection error', `<h1>Connection could not start</h1><p>${escapeHtml(error.description)}</p>`), 400);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set('error', error.code);
  redirect.searchParams.set('error_description', error.description);
  if (error.state) redirect.searchParams.set('state', error.state);
  return Response.redirect(redirect.toString(), 302);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

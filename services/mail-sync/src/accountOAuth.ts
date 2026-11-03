/**
 * "Sign in with Open Media" for AI hosts (ADR 0027): any person can connect Claude, ChatGPT or
 * another MCP host to their own account at /account/mcp with OAuth 2.1, instead of pasting a token.
 *
 * 1. The host sends the person to /authorize (resource …/account/mcp or scope "account").
 * 2. They enter their email; Open Media emails them the same sign-in code the app uses.
 * 3. They enter the code and approve what the host may do. Open Media keeps their session inside
 *    the OAuth grant, which the provider stores encrypted; the host only ever sees its own tokens.
 * 4. When the host refreshes its token, the session is refreshed with it, so the person signs in
 *    once. Signing out or revoking the grant ends it.
 *
 * Requests to /account/mcp are then answered by the same account server as /me/mcp, with the same
 * database rules and rate limits: nothing here widens what an account can do.
 */
import type { AuthRequest, GrantType, OAuthHelpers, TokenExchangeCallbackOptions, TokenExchangeCallbackResult } from '@cloudflare/workers-oauth-provider';

import { refreshSignIn, requestSignInCode, SignInEnv, SignInError, verifySignInCode } from './personSignIn.js';

export const ACCOUNT_SCOPE = 'account';
export const accountMcpPath = '/account/mcp';

export interface AccountOAuthEnv extends SignInEnv {
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: KVNamespace;
}

/** What the grant keeps: the person and their Open Media session (stored encrypted by the provider). */
export interface AccountGrantProps { kind: 'account'; userId: string; email: string; accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] }

export function isAccountGrant(props: unknown): props is AccountGrantProps {
  const value = props as AccountGrantProps | undefined;
  return value?.kind === 'account' && typeof value.userId === 'string' && typeof value.accessToken === 'string' && typeof value.refreshToken === 'string';
}

/** An authorization request for the person's account, rather than the Events owner's planner. */
export function wantsAccount(request: Pick<AuthRequest, 'scope' | 'resource'>): boolean {
  const resources = Array.isArray(request.resource) ? request.resource : request.resource ? [request.resource] : [];
  return request.scope.includes(ACCOUNT_SCOPE) || resources.some((resource) => { try { return new URL(resource).pathname.replace(/\/+$/, '') === accountMcpPath; } catch { return false; } });
}

const challengeTtl = 900;
const cookieName = 'om_account_oauth';
const attemptLimit = 10;

interface Challenge { oauthRequest: AuthRequest; clientName: string; redirectHost: string; email?: string }

/** /authorize for account connections; answers undefined for anything else so the Events flow runs. */
export async function handleAccountAuthorization(request: Request, env: AccountOAuthEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === '/authorize' && request.method === 'GET') {
    let oauthRequest: AuthRequest;
    try { oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request); } catch { return undefined; }
    if (!wantsAccount(oauthRequest)) return undefined;
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
    if (!client) return page(400, 'Unknown app', '<h1>This app isn’t registered</h1><p>Open Media doesn’t recognise the app asking to connect. Close this page and try again from the app.</p>');
    const id = randomHex(32);
    const challenge: Challenge = { oauthRequest: { ...oauthRequest, scope: [ACCOUNT_SCOPE] }, clientName: client.clientName?.slice(0, 120) || 'An AI app', redirectHost: hostOf(oauthRequest.redirectUri) };
    await env.OAUTH_KV.put(`account-challenge:${id}`, JSON.stringify(challenge), { expirationTtl: challengeTtl });
    return page(200, 'Connect to Open Media', emailForm(id, challenge), { 'set-cookie': `${cookieName}=${id}; Path=/authorize; Max-Age=${challengeTtl}; HttpOnly; Secure; SameSite=Lax` });
  }
  if (request.method !== 'POST' || (url.pathname !== '/authorize/account/email' && url.pathname !== '/authorize/account/complete')) return undefined;

  if (Number(request.headers.get('content-length') ?? '0') > 8_192) return page(413, 'Too large', '<h1>That request was too large</h1>');
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin && origin !== 'null') return page(403, 'Not allowed', '<h1>Not allowed</h1>');
  const form = new URLSearchParams(await request.text());
  const id = String(form.get('challenge') ?? '');
  const cookie = new RegExp(`(?:^|;\\s*)${cookieName}=([0-9a-f]{64})`).exec(request.headers.get('cookie') ?? '')?.[1];
  const raw = /^[0-9a-f]{64}$/.test(id) && cookie === id ? await env.OAUTH_KV.get(`account-challenge:${id}`) : null;
  if (!raw) return page(400, 'Expired', '<h1>This sign-in has expired</h1><p>Go back to the app and connect Open Media again.</p>');
  const challenge = JSON.parse(raw) as Challenge;
  if (!(await allowAttempt(request, env))) return page(429, 'Too many attempts', '<h1>Too many attempts</h1><p>Wait 15 minutes, then try again from the app.</p>');

  if (url.pathname === '/authorize/account/email') {
    try {
      const sent = await requestSignInCode(env, url.origin, { email: form.get('email') });
      challenge.email = sent.email;
      await env.OAUTH_KV.put(`account-challenge:${id}`, JSON.stringify(challenge), { expirationTtl: challengeTtl });
      return page(200, 'Check your email', codeForm(id, challenge));
    } catch (error) {
      return page(error instanceof SignInError ? error.status : 500, 'Connect to Open Media', emailForm(id, challenge, error instanceof SignInError ? error.message : 'Sign-in failed. Try again shortly.'));
    }
  }

  if (!challenge.email) return page(400, 'Connect to Open Media', emailForm(id, challenge, 'Enter your email first.'));
  if (form.get('approve') !== 'yes') return page(400, 'Check your email', codeForm(id, challenge, 'Tick the box to allow this app.'));
  let session: Awaited<ReturnType<typeof verifySignInCode>>;
  try {
    session = await verifySignInCode(env, url.origin, { email: challenge.email, code: form.get('code') });
  } catch (error) {
    return page(error instanceof SignInError ? error.status : 500, 'Check your email', codeForm(id, challenge, error instanceof SignInError ? error.message : 'Sign-in failed. Try again shortly.'));
  }
  const props: AccountGrantProps = { kind: 'account', userId: session.user.id, email: challenge.email, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: Date.now() + session.expires_in * 1000, scopes: [ACCOUNT_SCOPE] };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({ request: challenge.oauthRequest, userId: session.user.id, metadata: { clientName: challenge.clientName }, scope: [ACCOUNT_SCOPE], props });
  await env.OAUTH_KV.delete(`account-challenge:${id}`);
  return new Response(null, { status: 302, headers: { location: redirectTo, 'cache-control': 'no-store', 'set-cookie': `${cookieName}=; Path=/authorize; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
}

/**
 * Keeps the person's Open Media session in step with the host's token: on every refresh the
 * session is refreshed too (its refresh token rotates), and the host's token never outlives it.
 */
export async function accountTokenExchange(options: TokenExchangeCallbackOptions, env: SignInEnv, fetchImpl: typeof fetch = fetch): Promise<TokenExchangeCallbackResult | void> {
  if (!isAccountGrant(options.props)) return undefined;
  const props = options.props;
  const ttl = (expiresAt: number) => Math.max(60, Math.min(3600, Math.floor((expiresAt - Date.now()) / 1000) - 120));
  // GrantType is a runtime enum in a Workers-only module, so compare with its value.
  if (options.grantType !== ('refresh_token' as GrantType)) return { accessTokenTTL: ttl(props.expiresAt) };
  const session = await refreshSignIn(env, 'https://api.openmedia.site', { refresh_token: props.refreshToken }, fetchImpl);
  const next: AccountGrantProps = { ...props, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: Date.now() + session.expires_in * 1000 };
  return { newProps: next, accessTokenTTL: ttl(next.expiresAt) };
}

/** /account/mcp, once OAuth has checked the host's token: the account server, as the person. */
export function accountMcpRequest(request: Request, props: AccountGrantProps): Request {
  const url = new URL(request.url);
  url.pathname = '/me/mcp';
  const forwarded = new Request(url, request);
  forwarded.headers.set('authorization', `Bearer ${props.accessToken}`);
  return forwarded;
}

async function allowAttempt(request: Request, env: AccountOAuthEnv): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const bucket = Math.floor(Date.now() / 900_000);
  const key = `account-auth-attempts:${await sha256Hex(`${ip}:${bucket}`)}`;
  const count = Number((await env.OAUTH_KV.get(key)) ?? '0');
  if (count >= attemptLimit) return false;
  await env.OAUTH_KV.put(key, String(count + 1), { expirationTtl: 960 });
  return true;
}

function emailForm(id: string, challenge: Challenge, error?: string): string {
  return `${intro(challenge)}
<form method="post" action="/authorize/account/email">
  <input type="hidden" name="challenge" value="${id}">
  <label for="email">Your email</label>
  <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required autofocus placeholder="you@example.com" value="${escapeHtml(challenge.email ?? '')}">
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <button type="submit">Email me a code</button>
</form>
<p class="fine">New to Open Media? The same code creates your account.</p>`;
}

function codeForm(id: string, challenge: Challenge, error?: string): string {
  return `${intro(challenge)}
<form method="post" action="/authorize/account/complete">
  <input type="hidden" name="challenge" value="${id}">
  <label for="code">Code sent to ${escapeHtml(challenge.email ?? 'your email')}</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,12}" required autofocus placeholder="123456">
  <div class="grants">
    <p><strong>${escapeHtml(challenge.clientName)}</strong> will be able to, as you:</p>
    <ul>
      <li>Read your Feed, inbox, email, chats and contacts</li>
      <li>Post, reply, message and change settings, after asking you each time</li>
      <li>Never see your password or your Open Media session</li>
    </ul>
  </div>
  <label class="check"><input type="checkbox" name="approve" value="yes" required> Allow ${escapeHtml(challenge.clientName)} to use my Open Media account</label>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <button type="submit">Connect</button>
</form>
<p class="fine">You'll return to ${escapeHtml(challenge.redirectHost)}. You can disconnect any time by signing out in the app.</p>`;
}

function intro(challenge: Challenge): string {
  return `<div class="brand"><span class="mark" aria-hidden="true"></span>Open Media</div>
<h1>Connect ${escapeHtml(challenge.clientName)}</h1>
<p class="lead">Sign in to let ${escapeHtml(challenge.clientName)} use Open Media for you.</p>`;
}

function page(status: number, title: string, body: string, headers: Record<string, string> = {}): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Open Media</title>
<style>
:root{--fg:#111;--fg2:#5c5c58;--line:#e4e4df;--bg:#fafaf8;--card:#fff;--danger:#b42318}
@media (prefers-color-scheme:dark){:root{--fg:#f6f6f2;--fg2:#a8a8a3;--line:#2a2a28;--bg:#0a0a0a;--card:#121211;--danger:#ff8a80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:400px;padding:28px 24px;border:1px solid var(--line);border-radius:20px;background:var(--card)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}.mark{width:18px;height:18px;border-radius:50%;background:var(--fg);position:relative}.mark:after{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--card)}
h1{margin:22px 0 4px;font-size:24px;letter-spacing:-.02em;line-height:1.2}.lead{margin:0 0 20px;color:var(--fg2)}
label{display:block;margin:14px 0 6px;font-size:13px;font-weight:600}
input[type=email],input[inputmode=numeric]{width:100%;min-height:46px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--fg);font:inherit;font-size:16px;outline:none}
input:focus{border-color:var(--fg2)}
button{width:100%;min-height:48px;margin-top:18px;border:0;border-radius:999px;background:var(--fg);color:var(--card);font:inherit;font-weight:700;cursor:pointer}
.grants{margin-top:18px;padding:14px;border-radius:14px;background:color-mix(in srgb,var(--fg) 5%,transparent)}.grants p{margin:0 0 6px;font-size:13px}.grants ul{margin:0;padding-left:18px;color:var(--fg2);font-size:13px}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:500}.check input{margin-top:3px}
.error{margin:10px 0 0;color:var(--danger);font-size:13px;font-weight:600}.fine{margin:16px 0 0;color:var(--fg2);font-size:12px}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'", 'referrer-policy': 'no-referrer', ...headers } });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function hostOf(uri: string): string { try { return new URL(uri).host || uri; } catch { return uri; } }

function randomHex(bytes: number): string { return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

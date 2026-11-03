import { OAuthProvider } from '@cloudflare/workers-oauth-provider';

import { handleAuthorization } from './events/auth.js';
import { ACCOUNT_SCOPE, accountMcpPath, accountMcpRequest, accountTokenExchange, handleAccountAuthorization, isAccountGrant } from './accountOAuth.js';
import { handleProtectedEventsRequest, handlePublicEventsRequest, runScheduledRefresh, type EventsEnv } from './events/http.js';
import { SUPPORTED_SCOPES } from './events/tools.js';
import { AgentAuthError, agentAuthMetadata, exchangeAssertion, jwtBearerGrant } from './agentAuth.js';
import { agentFriendlyNotFound } from './agentSite.js';
import { handleMailRequest, MailEnv } from './mailHandler.js';
import { handleOndcRequest, isOndcPath, OndcEnv } from './ondc/http.js';
import { handleWebAppRequest, WebAppEnv } from './webApp.js';
import { AuthEmailEnv, handleSendEmailHook } from './authEmail.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { PublicApiEnv, withinLimit } from './publicApi.js';
import { MarketplaceEnv, runMarketplaceJobs } from './marketplace.js';

type WorkerEnv = Env & MailEnv & EventsEnv & OndcEnv & WebAppEnv & AuthEmailEnv & PublicApiEnv & MarketplaceEnv;

/** Every minute: listing checks, statements of reasons and seller confirmations (ADR 0016). */
const marketplaceCron = '* * * * *';

/** Public routes: OAuth owner sign-in, the signed plan calendar, event API docs, then mail sync and the public API. */
const defaultHandler = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    // Account connections ("Sign in with Open Media", ADR 0027) first; the Events owner flow otherwise.
    const response = (await handleAccountAuthorization(request, env))
      ?? (await handleAuthorization(request, env))
      ?? (await handlePublicEventsRequest(request, env))
      ?? (await handleMailRequest(request, env));
    return agentFriendlyNotFound(request, response);
  },
};

/** OAuth-protected Open Media Events routes: MCP for agents and REST for apps. */
const eventsApiHandler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: unknown }).props;
    // The person's account over OAuth: the same account server as /me/mcp, as them.
    if (new URL(request.url).pathname.replace(/\/+$/, '') === accountMcpPath) {
      if (!isAccountGrant(props)) return Response.json({ error: 'insufficient_scope', error_description: 'This connection is for Open Media Events. Connect your Open Media account to use it here.' }, { status: 403 });
      return handleMailRequest(accountMcpRequest(request, props), env);
    }
    // An account connection is not an Events grant, whatever scopes it names.
    if (isAccountGrant(props)) return Response.json({ error: 'insufficient_scope', error_description: 'This connection is for your Open Media account, not Open Media Events.' }, { status: 403 });
    return handleProtectedEventsRequest(request, env, props);
  },
};

/** The token callback gets no env; the Worker's bindings are the same for every request, so the first one keeps them. */
let signInEnv: WorkerEnv | undefined;

const oauth = new OAuthProvider<WorkerEnv>({
  apiRoute: ['/mcp', '/v1/events/tools/', accountMcpPath],
  apiHandler: eventsApiHandler as never,
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [...SUPPORTED_SCOPES, ACCOUNT_SCOPE],
  // RFC 9728 metadata names the scopes agents can ask for. `resource` stays unset so existing grants keep working.
  resourceMetadata: { scopes_supported: [...SUPPORTED_SCOPES, ACCOUNT_SCOPE], bearer_methods_supported: ['header'], resource_name: 'Open Media' },
  tokenExchangeCallback: (options) => (signInEnv ? accountTokenExchange(options, signInEnv) : undefined),
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 60 * 60 * 24 * 90,
  allowPlainPKCE: false,
  clientRegistrationCallback: ({ clientMetadata }) => {
    const name = clientMetadata.client_name;
    if (typeof name !== 'string' || !name.trim() || name.length > 120) {
      return { code: 'invalid_client_metadata', description: 'A concise client_name is required.', status: 400 };
    }
  },
  onError: ({ code, status }) => {
    console.error(JSON.stringify({ event: 'oauth_error', code, status }));
  },
});

/**
 * Agent self-registration (auth.md) sits beside the OAuth provider: the JWT-bearer grant is
 * answered here, and the provider's metadata gains the agent_auth block. Everything else is the
 * provider's own.
 */
async function handleRequest(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const webApp = await handleWebAppRequest(request, env);
  if (webApp) return withSecurityHeaders(webApp, { webApp: true });
  // Supabase Auth hands every sign-in email to this signed hook (authEmail.ts).
  if (request.method === 'POST' && url.pathname === '/auth/hooks/send-email') return handleSendEmailHook(request, env);
  // ONDC buyer apps and the registry call these directly; they never go through OAuth.
  if (isOndcPath(url.pathname)) {
    // Each signed ONDC request can trigger a registry lookup; cap them per IP.
    if (request.method === 'POST' && !(await withinLimit(env.PUBLIC_API_RATE_LIMITER, `ondc:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`))) {
      return new Response(JSON.stringify({ message: { ack: { status: 'NACK' } }, error: { type: 'CORE-ERROR', code: '31001', message: 'Too many requests.' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } });
    }
    const response = await handleOndcRequest(request, env, { waitUntil: (work) => ctx.waitUntil(work) });
    if (response) return response;
  }
  if (request.method === 'POST' && url.pathname === '/oauth/token') {
    const form = new URLSearchParams(await request.clone().text().catch(() => ''));
    if (form.get('grant_type') === jwtBearerGrant) {
      const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
      if (!(await withinLimit(env.REGISTRATION_RATE_LIMITER, `ip:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`))) {
        return new Response(JSON.stringify({ error: 'slow_down', error_description: 'Too many token requests. Wait a minute.' }), { status: 429, headers: { ...headers, 'retry-after': '60' } });
      }
      try { return new Response(JSON.stringify(await exchangeAssertion(env, url.origin, form)), { headers }); }
      catch (error) {
        if (!(error instanceof AgentAuthError)) throw error;
        return new Response(JSON.stringify({ error: error.code, error_description: error.message }), { status: error.status, headers });
      }
    }
  }
  const response = await oauth.fetch(request, env, ctx);
  if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server' && response.ok) {
    const metadata = await response.json() as Record<string, unknown>;
    const grants = Array.isArray(metadata.grant_types_supported) ? metadata.grant_types_supported as string[] : [];
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify({ ...metadata, grant_types_supported: [...grants, jwtBearerGrant], agent_auth: agentAuthMetadata(url.origin) }), { headers });
  }
  return response;
}

export default {
  fetch: async (request: Request, env: WorkerEnv, ctx: ExecutionContext) => {
    signInEnv ??= env;
    const response = await handleRequest(request, env, ctx);
    // The web app's own responses already carry their policy; everything else gets the common set.
    return response.headers.has('content-security-policy') ? response : withSecurityHeaders(response);
  },
  scheduled: async (controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) => {
    if (controller.cron === marketplaceCron) {
      ctx.waitUntil(runMarketplaceJobs(env).then((done) => {
        if (done.checked || done.notices || done.confirmed || done.sellers) console.log(JSON.stringify({ event: 'marketplace_jobs', ...done }));
      }).catch((error) => console.error(JSON.stringify({ event: 'marketplace_jobs_failed', message: error instanceof Error ? error.message : 'unknown' }))));
      return;
    }
    ctx.waitUntil(runScheduledRefresh(env));
  },
} satisfies ExportedHandler<WorkerEnv>;

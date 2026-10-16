import { OAuthProvider } from '@cloudflare/workers-oauth-provider';

import { handleAuthorization } from './events/auth.js';
import { handleProtectedEventsRequest, handlePublicEventsRequest, runScheduledRefresh, type EventsEnv } from './events/http.js';
import { SUPPORTED_SCOPES } from './events/tools.js';
import { handleMailRequest, MailEnv } from './mailHandler.js';

type WorkerEnv = Env & MailEnv & EventsEnv;

/** Public routes: OAuth owner sign-in, the signed plan calendar, event API docs, then mail sync and the public API. */
const defaultHandler = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return (await handleAuthorization(request, env))
      ?? (await handlePublicEventsRequest(request, env))
      ?? handleMailRequest(request, env);
  },
};

/** OAuth-protected Open Media Events routes: MCP for agents and REST for apps. */
const eventsApiHandler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return handleProtectedEventsRequest(request, env, (ctx as ExecutionContext & { props?: unknown }).props);
  },
};

const oauth = new OAuthProvider<WorkerEnv>({
  apiRoute: ['/mcp', '/v1/events/tools/'],
  apiHandler: eventsApiHandler as never,
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [...SUPPORTED_SCOPES],
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

export default {
  fetch: (request: Request, env: WorkerEnv, ctx: ExecutionContext) => oauth.fetch(request, env, ctx),
  scheduled: async (_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduledRefresh(env));
  },
} satisfies ExportedHandler<WorkerEnv>;

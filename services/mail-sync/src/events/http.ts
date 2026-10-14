import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { isGrantProps, type AuthEnv, type GrantProps } from './auth.js';
import { CalendarCapability } from './calendar.js';
import { EventsEngine, UserError, type EmbeddingProvider } from './engine.js';
import { ProviderRouter } from './providers.js';
import { EventStore } from './store.js';
import { SERVER_INSTRUCTIONS, TOOLS, type ToolDefinition } from './tools.js';

export interface EventsEnv extends AuthEnv {
  EVENTS_DB: D1Database;
  AI?: { run(model: string, input: { text: string[] }): Promise<{ data?: number[][] }> };
  EVENTS_FEED_SIGNING_KEY?: string;
  CALCOM_API_KEY?: string;
}

const VERSION = '0.1.0';
const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';

export function createEngine(env: EventsEnv, origin: string): EventsEngine {
  const store = new EventStore(env.EVENTS_DB);
  const calendar = new CalendarCapability({ calcomApiKey: env.CALCOM_API_KEY, feedSigningKey: env.EVENTS_FEED_SIGNING_KEY, publicOrigin: env.EVENTS_PUBLIC_ORIGIN ?? origin });
  const embeddings: EmbeddingProvider | undefined = env.AI
    ? { embed: async (texts) => (await env.AI!.run(EMBEDDING_MODEL, { text: texts })).data ?? [] }
    : undefined;
  return new EventsEngine(store, new ProviderRouter(store), calendar, embeddings);
}

/** Handles OAuth-protected API routes: `/mcp` and `/v1/events/tools/<name>`. */
export async function handleProtectedEventsRequest(request: Request, env: EventsEnv, props: unknown): Promise<Response> {
  if (!isGrantProps(props)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const engine = createEngine(env, url.origin);
  if (url.pathname === '/mcp') return mcpHandler(engine, props, url.origin).fetch(request, { authInfo: authInfo(props) });
  const match = /^\/v1\/events\/tools\/([a-z_]+)$/.exec(url.pathname);
  if (match && request.method === 'POST') {
    const tool = TOOLS.find((item) => item.name === match[1]);
    if (!tool) return Response.json({ error: 'unknown_tool' }, { status: 404 });
    const body = await request.text();
    if (body.length > 32_768) return Response.json({ error: 'request_too_large' }, { status: 413 });
    return Response.json(await invoke(tool, engine, props, body ? JSON.parse(body) : {}), { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/** Public, unauthenticated events routes: the signed plan calendar and API docs. */
export async function handlePublicEventsRequest(request: Request, env: EventsEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  const feed = /^\/v1\/events\/calendar\/([^/]+)\/(\d+)\/([0-9a-f]{40})\.ics$/.exec(url.pathname);
  if (feed && request.method === 'GET') {
    const body = await createEngine(env, url.origin).renderFeed(decodeURIComponent(feed[1]!), Number(feed[2]), feed[3]!);
    if (!body) return new Response('Not found', { status: 404 });
    return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex' } });
  }
  if (url.pathname === '/v1/events/openapi.json' && request.method === 'GET') {
    return Response.json(openApi(env.EVENTS_PUBLIC_ORIGIN ?? url.origin), { headers: { 'access-control-allow-origin': '*' } });
  }
  if ((url.pathname === '/events' || url.pathname === '/events/') && request.method === 'GET') {
    return new Response(landingPage(env.EVENTS_PUBLIC_ORIGIN ?? url.origin), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return undefined;
}

export async function runScheduledRefresh(env: EventsEnv): Promise<void> {
  const result = await createEngine(env, env.EVENTS_PUBLIC_ORIGIN ?? 'https://localhost').refreshPlannedEvents();
  console.log(JSON.stringify({ event: 'events_refresh', ...result }));
}

function mcpHandler(engine: EventsEngine, props: GrantProps, origin: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'open-media-events', title: 'Open Media Events', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          annotations: tool.annotations,
          _meta: {
            securitySchemes: [{ type: 'oauth2', scopes: [tool.scope] }],
            'openai/toolInvocation/invoking': 'Checking events…',
            'openai/toolInvocation/invoked': 'Done',
          },
        },
        (async (args: unknown) => toolResult(await invoke(tool, engine, props, args, origin))) as never,
      );
    }
    return server;
  }, { legacy: 'stateless', responseMode: 'json' });
}

async function invoke(tool: ToolDefinition, engine: EventsEngine, props: GrantProps, args: unknown, origin?: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string; message: string; required_scope?: string }> {
  void origin;
  if (!props.scopes.includes(tool.scope)) {
    return { ok: false, error: 'insufficient_scope', message: `Reconnect Open Media Events and grant ${tool.scope}.`, required_scope: tool.scope };
  }
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: 'invalid_arguments', message: z.prettifyError(parsed.error) };
  try {
    return { ok: true, result: await tool.run(engine, props.userId, parsed.data) };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: 'cannot_do_that', message: error.message };
    console.error(JSON.stringify({ event: 'events_tool_failed', tool: tool.name, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
    return { ok: false, error: 'internal_error', message: 'The events service hit an error. Try again, or narrow the request.' };
  }
}

function toolResult(outcome: Awaited<ReturnType<typeof invoke>>) {
  const payload = outcome.ok ? outcome.result : { error: outcome.error, message: outcome.message, required_scope: outcome.required_scope };
  const text = JSON.stringify(payload);
  return {
    ...(outcome.ok ? {} : { isError: true }),
    content: [{ type: 'text' as const, text: text.length > 60_000 ? `${text.slice(0, 60_000)}…` : text }],
    structuredContent: (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { result: payload }) as Record<string, unknown>,
  };
}

function authInfo(props: GrantProps): AuthInfo {
  return { token: 'oauth-provider-verified', clientId: 'open-media-events', scopes: props.scopes, extra: { userId: props.userId } };
}

function openApi(origin: string) {
  const paths: Record<string, unknown> = {};
  for (const tool of TOOLS) {
    paths[`/v1/events/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.title,
        description: tool.description,
        security: [{ oauth2: [tool.scope] }],
        requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(tool.input) } } },
        responses: { 200: { description: '`{ ok: true, result }` or `{ ok: false, error, message }`' }, 401: { description: 'Missing or invalid access token' } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Open Media Events API', version: VERSION, description: 'Agent-agnostic event discovery and planning. The same operations are exposed as MCP tools at /mcp.' },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: { authorizationCode: { authorizationUrl: `${origin}/authorize`, tokenUrl: `${origin}/oauth/token`, scopes: { 'events:read': 'Read events and your plans', 'events:write': 'Change plans and preferences you approve' } } },
        },
      },
    },
    paths,
  };
}

function landingPage(origin: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Media Events</title>
<style>:root{color-scheme:light dark}body{font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:640px;margin:8vh auto;padding:0 16px}code{font-size:14px}</style></head>
<body><h1>Open Media Events</h1><p>An agent-agnostic event discovery and planning service. Connect an MCP client to <code>${origin}/mcp</code> (OAuth 2.1). REST operations are documented at <a href="/v1/events/openapi.json">/v1/events/openapi.json</a>.</p>
<p>Source: <a href="https://github.com/mihirkavi/open-media/tree/main/docs/events">github.com/mihirkavi/open-media</a>.</p></body></html>`;
}

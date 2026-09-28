/**
 * Open Media public read API (v1).
 *
 * Read-only, unauthenticated, and intended for people, scrapers, and AI agents.
 * It only relays the explicit public projection returned by the
 * `open_media_public_*` database functions: public posts and public profiles.
 * Messages, email, contacts, blocks, and reports are never reachable here.
 */

export interface PublicApiEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Optional Cloudflare rate-limit binding keyed by client IP. */
  PUBLIC_API_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

interface UpstreamPost {
  id: string;
  body: string;
  createdAt: string;
  author: { handle: string; displayName: string; avatarUrl: string | null };
}

interface UpstreamProfile {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  joinedAt: string;
  postCount: number;
}

export interface Cursor { createdAt: string; id: string }

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const apiVersion = '1.0.0';
const defaultLimit = 20;
const maxLimit = 50;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const handlePattern = /^[a-z0-9_]{3,24}$/i;

const baseHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'link',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'all',
};

export async function handlePublicApiRequest(request: Request, env: PublicApiEnv, fetchImpl: Fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...baseHeaders, 'access-control-max-age': '86400' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(405, 'method_not_allowed', 'The Open Media public API is read-only. Use GET.', { allow: 'GET, HEAD, OPTIONS' });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/robots.txt') return textResponse('User-agent: *\nAllow: /\n');
  if (path === '/health') return jsonResponse({ ok: true }, 0);

  if (env.PUBLIC_API_RATE_LIMITER) {
    const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.PUBLIC_API_RATE_LIMITER.limit({ key });
    if (!success) return errorResponse(429, 'rate_limited', 'Too many requests. Wait a minute and try again.', { 'retry-after': '60' });
  }

  try {
    if (path === '/' || path === '/v1') return jsonResponse(describeApi(url.origin), 300);
    if (path === '/v1/openapi.json') return jsonResponse(openApiDocument(url.origin), 300);

    if (path === '/v1/posts') return await listPosts(url, env, fetchImpl);

    const postMatch = path.match(/^\/v1\/posts\/([^/]+)$/);
    if (postMatch) {
      const id = decodeURIComponent(postMatch[1]);
      if (!uuidPattern.test(id)) return errorResponse(404, 'not_found', 'Post not found.');
      const post = await callRpc<UpstreamPost | null>(env, fetchImpl, 'open_media_public_post', { p_post_id: id });
      if (!post) return errorResponse(404, 'not_found', 'Post not found.');
      return jsonResponse({ data: formatPost(post, url.origin) }, 30);
    }

    const profileMatch = path.match(/^\/v1\/profiles\/([^/]+)(\/posts)?$/);
    if (profileMatch) {
      const handle = decodeURIComponent(profileMatch[1]).replace(/^@/, '').toLowerCase();
      if (!handlePattern.test(handle)) return errorResponse(404, 'not_found', 'Profile not found.');
      if (profileMatch[2]) return await listPosts(url, env, fetchImpl, handle);
      const profile = await callRpc<UpstreamProfile | null>(env, fetchImpl, 'open_media_public_profile', { p_handle: handle });
      if (!profile) return errorResponse(404, 'not_found', 'Profile not found.');
      return jsonResponse({ data: formatProfile(profile, url.origin) }, 60);
    }

    return errorResponse(404, 'not_found', 'No such endpoint. See / for the list of endpoints.');
  } catch (error) {
    if (error instanceof BadRequest) return errorResponse(400, 'bad_request', error.message);
    return errorResponse(502, 'upstream_unavailable', 'Open Media data is temporarily unavailable. Try again shortly.');
  }
}

async function listPosts(url: URL, env: PublicApiEnv, fetchImpl: Fetch, authorHandle?: string): Promise<Response> {
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursorParam = url.searchParams.get('cursor');
  const cursor = cursorParam ? decodeCursor(cursorParam) : undefined;
  if (cursorParam && !cursor) throw new BadRequest('The cursor is invalid. Use the value from a previous response.');

  if (authorHandle) {
    const profile = await callRpc<UpstreamProfile | null>(env, fetchImpl, 'open_media_public_profile', { p_handle: authorHandle });
    if (!profile) return errorResponse(404, 'not_found', 'Profile not found.');
  }

  const posts = await callRpc<UpstreamPost[]>(env, fetchImpl, 'open_media_public_posts', {
    p_limit: limit,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_author_handle: authorHandle ?? null,
  });
  const items = Array.isArray(posts) ? posts : [];
  const last = items[items.length - 1];
  const nextCursor = items.length === limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  const next = nextCursor ? withParams(url, { cursor: nextCursor, limit: String(limit) }) : null;
  return jsonResponse(
    { data: items.map((post) => formatPost(post, url.origin)), pagination: { limit, nextCursor, next } },
    30,
    next ? { link: `<${next}>; rel="next"` } : {},
  );
}

function formatPost(post: UpstreamPost, origin: string) {
  return {
    id: post.id,
    type: 'post',
    text: post.body,
    createdAt: post.createdAt,
    url: `${origin}/v1/posts/${post.id}`,
    author: {
      handle: post.author.handle,
      displayName: post.author.displayName,
      avatarUrl: post.author.avatarUrl,
      url: `${origin}/v1/profiles/${post.author.handle}`,
    },
  };
}

function formatProfile(profile: UpstreamProfile, origin: string) {
  return {
    type: 'profile',
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    joinedAt: profile.joinedAt,
    postCount: profile.postCount,
    url: `${origin}/v1/profiles/${profile.handle}`,
    postsUrl: `${origin}/v1/profiles/${profile.handle}/posts`,
  };
}

async function callRpc<T>(env: PublicApiEnv, fetchImpl: Fetch, name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`Upstream ${name} failed with ${response.status}`);
  return await response.json() as T;
}

export function encodeCursor(cursor: Cursor): string {
  return base64UrlEncode(JSON.stringify([cursor.createdAt, cursor.id]));
}

export function decodeCursor(value: string): Cursor | undefined {
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return undefined;
    if (typeof id !== 'string' || !uuidPattern.test(id)) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

function parseLimit(value: string | null): number {
  if (value === null || value === '') return defaultLimit;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new BadRequest(`limit must be an integer from 1 to ${maxLimit}.`);
  return limit;
}

function withParams(url: URL, params: Record<string, string>): string {
  const next = new URL(url.toString());
  for (const [key, value] of Object.entries(params)) next.searchParams.set(key, value);
  return next.toString();
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

class BadRequest extends Error {}

function jsonResponse(body: unknown, maxAgeSeconds: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      ...baseHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAgeSeconds > 0 ? `public, max-age=${maxAgeSeconds}` : 'no-store',
      ...extraHeaders,
    },
  });
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

function errorResponse(status: number, code: string, message: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...baseHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function describeApi(origin: string) {
  return {
    name: 'Open Media public API',
    version: apiVersion,
    description: 'Read-only access to public Open Media posts and profiles. No account or API key is needed. People, scrapers, and AI agents are welcome.',
    documentation: `${origin}/v1/openapi.json`,
    endpoints: {
      posts: `${origin}/v1/posts`,
      post: `${origin}/v1/posts/{id}`,
      profile: `${origin}/v1/profiles/{handle}`,
      profilePosts: `${origin}/v1/profiles/{handle}/posts`,
    },
    pagination: 'Newest first. Follow pagination.next (or the Link rel="next" header) until it is null. limit is 1–50, default 20.',
    rateLimit: 'Requests are rate limited per client IP. On HTTP 429, wait for Retry-After seconds.',
    scope: 'Only public posts and profiles are available. Private messages, email, and contacts are never exposed. Removed or reported-and-hidden posts disappear from the API.',
  };
}

export function openApiDocument(origin: string) {
  const postSchema = {
    type: 'object',
    required: ['id', 'type', 'text', 'createdAt', 'url', 'author'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['post'] },
      text: { type: 'string', maxLength: 2000 },
      createdAt: { type: 'string', format: 'date-time' },
      url: { type: 'string', format: 'uri' },
      author: {
        type: 'object',
        required: ['handle', 'displayName', 'url'],
        properties: {
          handle: { type: 'string' },
          displayName: { type: 'string' },
          avatarUrl: { type: ['string', 'null'], format: 'uri' },
          url: { type: 'string', format: 'uri' },
        },
      },
    },
  };
  const profileSchema = {
    type: 'object',
    required: ['type', 'handle', 'displayName', 'bio', 'joinedAt', 'postCount', 'url', 'postsUrl'],
    properties: {
      type: { type: 'string', enum: ['profile'] },
      handle: { type: 'string' },
      displayName: { type: 'string' },
      bio: { type: 'string' },
      avatarUrl: { type: ['string', 'null'], format: 'uri' },
      joinedAt: { type: 'string', format: 'date-time' },
      postCount: { type: 'integer' },
      url: { type: 'string', format: 'uri' },
      postsUrl: { type: 'string', format: 'uri' },
    },
  };
  const page = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
      pagination: {
        type: 'object',
        properties: { limit: { type: 'integer' }, nextCursor: { type: ['string', 'null'] }, next: { type: ['string', 'null'], format: 'uri' } },
      },
    },
  };
  const pageParams = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: maxLimit, default: defaultLimit } },
    { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Opaque cursor from pagination.nextCursor.' },
  ];
  const error = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  return {
    openapi: '3.1.0',
    info: { title: 'Open Media public API', version: apiVersion, description: describeApi(origin).description },
    servers: [{ url: origin }],
    paths: {
      '/v1/posts': { get: { summary: 'List public posts, newest first', parameters: pageParams, responses: { 200: { description: 'A page of posts', content: { 'application/json': { schema: page } } }, 400: error, 429: error } } },
      '/v1/posts/{id}': { get: { summary: 'Get one public post', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'A post', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Post' } } } } } }, 404: error } } },
      '/v1/profiles/{handle}': { get: { summary: 'Get a public profile', parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'A profile', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Profile' } } } } } }, 404: error } } },
      '/v1/profiles/{handle}/posts': { get: { summary: "List a profile's public posts, newest first", parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }, ...pageParams], responses: { 200: { description: 'A page of posts', content: { 'application/json': { schema: page } } }, 404: error } } },
    },
    components: {
      schemas: {
        Post: postSchema,
        Profile: profileSchema,
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
      },
    },
  };
}

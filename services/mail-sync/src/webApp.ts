/**
 * The Open Media web app on its own domain (https://openmedia.site), served by this Worker from
 * static files so the project keeps one production Worker.
 *
 * On a web-app host, a browser opening `/` or the sign-in callback `/auth` gets the app; the app's
 * own files (`/_expo/…`, `/assets/…`, the favicon) come from the build. Everything else, and every
 * request on other hosts (api.openmedia.site, workers.dev), reaches the API and agent site as
 * before. Agents asking for Markdown or `?mode=agent` still get the agent site at `/`. The
 * homepage's HTML also carries the agent site's text, metadata and JSON-LD for crawlers that
 * don't run JavaScript, with RFC 8288 Link headers to the discovery documents.
 */
import { homeLinkHeader, isSitePath, prefersMarkdown, withAgentHomepage } from './agentSite.js';

export interface WebAppEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  WEB_APP_HOSTS?: string;
}

const appPages = new Set(['/', '/index.html', '/auth', '/passkey']);
/** Single words that are pages or API roots, never profile shortcuts. */
const reservedPaths = new Set(['auth', 'passkey', 'v1', 'api', 'open', 'me', 'mcp', 'docs', 'policies', 'feeds', 'ask', 'agent', 'assets', 'brand', 'feed', 'mission', 'developers', 'settings', 'messages', 'clips', 'search', 'profile', 'login', 'signin', 'signup', 'about', 'jobs', 'work', 'health']);
const appFiles = /^\/(?:_expo\/|assets\/|brand\/|favicon\.ico$|metadata\.json$)/;
/**
 * Build files whose names carry a hash of their contents: the JavaScript under /_expo/static/ (`name-<32 hex>.js`) and
 * every /assets/ file Expo names `name.<32 hex>.ext`. A new build gives changed files new names, so
 * browsers and Cloudflare can keep these for a year without asking again. Everything else (the
 * page, /brand/, the favicon) keeps the default short revalidation.
 */
const contentHashedFile = /^\/(?:_expo\/static\/.+-[0-9a-f]{32}\.(?:js|css|map)|assets\/.+\.[0-9a-f]{32}\.[a-z0-9]+)$/i;
const immutable = 'public, max-age=31536000, immutable';

export async function handleWebAppRequest(request: Request, env: WebAppEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  const hosts = (env.WEB_APP_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (!env.ASSETS || !hosts.includes(url.hostname)) return undefined;
  if (url.hostname.startsWith('www.')) {
    return Response.redirect(`https://${url.hostname.slice(4)}${url.pathname}${url.search}`, 301);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  if (appFiles.test(url.pathname)) {
    const file = await env.ASSETS.fetch(request);
    if (!file.ok) return file;
    const headers = new Headers(file.headers);
    if (contentHashedFile.test(url.pathname)) headers.set('cache-control', immutable);
    return await withByteRange(request, file, headers);
  }
  const browser = /text\/html/i.test(request.headers.get('accept') ?? '');
  // Profile addresses (ADR 0019): /@handle is the app showing that profile; /handle is a shortcut to it.
  const profile = /^\/@[a-z0-9_]{3,24}\/?$/i.test(url.pathname);
  const shortcut = url.pathname.match(/^\/([a-z0-9_]{3,24})\/?$/i)?.[1];
  if (browser && shortcut && !appPages.has(url.pathname) && !isSitePath(url.pathname) && !reservedPaths.has(shortcut.toLowerCase())) {
    return Response.redirect(`https://${url.hostname}/@${shortcut.toLowerCase()}${url.search}`, 301);
  }
  if (!appPages.has(url.pathname) && !profile) return undefined;
  if (!browser || prefersMarkdown(request) || url.searchParams.has('mode')) return undefined;
  // The build's index.html is served at "/"; the app reads /auth's query and /passkey's fragment itself.
  const app = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  if (url.pathname === '/auth' || url.pathname === '/passkey' || profile || !app.ok || !(app.headers.get('content-type') ?? '').includes('text/html')) return app;
  const headers = new Headers(app.headers);
  for (const name of ['content-length', 'etag', 'last-modified']) headers.delete(name);
  headers.set('link', homeLinkHeader(url.origin));
  headers.set('vary', 'Accept, User-Agent');
  return new Response(request.method === 'HEAD' ? null : withAgentHomepage(await app.text(), url.origin), { status: app.status, headers });
}

/**
 * Answers a `Range: bytes=…` request with just those bytes (206), as video players expect: Safari
 * won't play the landing film without it, and every browser needs it to seek. The static-asset
 * service returns whole files, often without a length, so the Worker cuts the range out itself:
 * from the stream when the length is known, otherwise from the file read into memory (the largest
 * file, the film, is under 6 MB). Only single ranges of uncompressed files are served this way;
 * other requests get the whole file, which the HTTP spec allows.
 */
async function withByteRange(request: Request, file: Response, headers: Headers): Promise<Response> {
  const whole = () => new Response(file.body, { status: file.status, statusText: file.statusText, headers });
  if (file.status !== 200 || headers.has('content-encoding')) return whole();
  headers.set('accept-ranges', 'bytes');
  const rangeHeader = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (!rangeHeader || (ifRange && ifRange !== headers.get('etag'))) return whole();
  const length = Number(file.headers.get('content-length'));
  const known = file.headers.has('content-length') && Number.isSafeInteger(length) && length >= 0;
  const bytes = known ? undefined : new Uint8Array(await file.arrayBuffer());
  const size = bytes ? bytes.length : length;
  const range = parseByteRange(rangeHeader, size);
  if (!range) return bytes ? new Response(bytes, { status: 200, headers }) : whole();
  if (range === 'unsatisfiable') {
    file.body?.cancel().catch(() => undefined);
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, 'cache-control': 'no-store' } });
  }
  const [start, end] = range;
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  if (request.method === 'HEAD') { file.body?.cancel().catch(() => undefined); return new Response(null, { status: 206, headers }); }
  if (bytes) return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  return new Response(file.body ? sliceStream(file.body, start, end) : null, { status: 206, headers });
}

/** A single `bytes=a-b`, `bytes=a-` or `bytes=-n` range within a file of `size` bytes. */
export function parseByteRange(header: string | null, size: number): [number, number] | 'unsatisfiable' | undefined {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return undefined;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? [Math.max(0, size - suffix), size - 1] : 'unsatisfiable';
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || end < start) return 'unsatisfiable';
  return [start, end];
}

function sliceStream(body: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  let offset = 0;
  const sliced = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const from = Math.max(start - offset, 0);
      const to = Math.min(end + 1 - offset, chunk.length);
      if (from < to) controller.enqueue(chunk.subarray(from, to));
      offset += chunk.length;
      // Stop reading the file once the range is sent.
      if (offset > end) controller.terminate();
    },
  }));
  // Workers send a known length when the stream says so, rather than a chunked response.
  const Fixed = (globalThis as { FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
  return Fixed ? sliced.pipeThrough(new Fixed(end - start + 1)) : sliced;
}

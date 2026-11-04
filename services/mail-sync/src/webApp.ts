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

const appPages = new Set(['/', '/index.html', '/auth']);
/** Single words that are pages or API roots, never profile shortcuts. */
const reservedPaths = new Set(['auth', 'v1', 'api', 'open', 'me', 'mcp', 'docs', 'policies', 'feeds', 'ask', 'agent', 'assets', 'brand', 'feed', 'mission', 'developers', 'settings', 'messages', 'clips', 'search', 'profile', 'login', 'signin', 'signup', 'about', 'jobs', 'work', 'health']);
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
    if (!file.ok || !contentHashedFile.test(url.pathname)) return file;
    const headers = new Headers(file.headers);
    headers.set('cache-control', immutable);
    return new Response(file.body, { status: file.status, statusText: file.statusText, headers });
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
  // The build's index.html is served at "/"; the app reads /auth's query itself.
  const app = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  if (url.pathname === '/auth' || profile || !app.ok || !(app.headers.get('content-type') ?? '').includes('text/html')) return app;
  const headers = new Headers(app.headers);
  for (const name of ['content-length', 'etag', 'last-modified']) headers.delete(name);
  headers.set('link', homeLinkHeader(url.origin));
  headers.set('vary', 'Accept, User-Agent');
  return new Response(request.method === 'HEAD' ? null : withAgentHomepage(await app.text(), url.origin), { status: app.status, headers });
}

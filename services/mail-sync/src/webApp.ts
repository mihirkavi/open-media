/**
 * The Open Media web app on its own domain (https://openmedia.site), served by this Worker from
 * static files so the project keeps one production Worker.
 *
 * On a web-app host, a browser opening `/` or the sign-in callback `/auth` gets the app; the app's
 * own files (`/_expo/…`, `/assets/…`, the favicon) come from the build. Everything else, and every
 * request on other hosts (api.openmedia.site, workers.dev), reaches the API and agent site as
 * before. Agents asking for Markdown or `?mode=agent` still get the agent site at `/`.
 */
import { isSitePath, prefersMarkdown } from './agentSite.js';

export interface WebAppEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  WEB_APP_HOSTS?: string;
}

const appPages = new Set(['/', '/index.html', '/auth']);
/** Single words that are pages or API roots, never profile shortcuts. */
const reservedPaths = new Set(['auth', 'v1', 'api', 'open', 'me', 'mcp', 'docs', 'policies', 'feeds', 'ask', 'agent', 'assets', 'brand', 'feed', 'mission', 'developers', 'settings', 'messages', 'clips', 'search', 'profile', 'login', 'signin', 'signup', 'about', 'jobs', 'work', 'health']);
const appFiles = /^\/(?:_expo\/|assets\/|brand\/|favicon\.ico$|metadata\.json$)/;

export async function handleWebAppRequest(request: Request, env: WebAppEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  const hosts = (env.WEB_APP_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (!env.ASSETS || !hosts.includes(url.hostname)) return undefined;
  if (url.hostname.startsWith('www.')) {
    return Response.redirect(`https://${url.hostname.slice(4)}${url.pathname}${url.search}`, 301);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  if (appFiles.test(url.pathname)) return env.ASSETS.fetch(request);
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
  return env.ASSETS.fetch(new Request(new URL('/', url), request));
}

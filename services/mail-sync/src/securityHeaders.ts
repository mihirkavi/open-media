/**
 * Security headers for every response the Worker sends.
 *
 * Everything gets HSTS, nosniff, a referrer policy, a permissions policy and "never frame me".
 * HTML also gets a Content-Security-Policy:
 * - The web app (openmedia.site) runs only its own scripts. It needs inline styles (React Native
 *   Web injects them), images and media from the networks it shows, HTTPS and WSS connections to
 *   those networks, and DeSo's signing iframe.
 * - Other pages (the agent site, the OAuth consent page) run only scripts whose exact text they
 *   ship, allowed by SHA-256 hash, so an injected script cannot run.
 * Responses that are not HTML pass through as streams, so MCP and server-sent events are unaffected.
 */

const common: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};

const analytics = 'https://static.cloudflareinsights.com';

export const webAppPolicy = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${analytics}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  'frame-src https://identity.deso.org',
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

/** A policy for a server-rendered page: its own inline scripts by hash, nothing else inline. */
export async function pagePolicy(html: string): Promise<string> {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=["']application\/ld\+json["']/i.test(match[1])) continue;
    hashes.push(await sha256(match[2]));
  }
  return [
    "default-src 'self'",
    `script-src ${[...new Set(hashes), analytics].join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self' https://cloudflareinsights.com",
    "object-src 'none'",
    "base-uri 'none'",
    // The OAuth consent form redirects to the AI client's own callback after approval.
    "form-action 'self' https: http://localhost:* http://127.0.0.1:*",
    "frame-ancestors 'none'",
  ].join('; ');
}

export async function withSecurityHeaders(response: Response, options: { webApp?: boolean } = {}): Promise<Response> {
  // WebSocket upgrades and opaque responses cannot be rebuilt.
  if (response.status === 101 || (response as Response & { webSocket?: unknown }).webSocket) return response;
  const html = /^text\/html/i.test(response.headers.get('content-type') ?? '');
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(common)) if (!headers.has(name)) headers.set(name, value);
  if (!html) return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (options.webApp) {
    headers.set('content-security-policy', webAppPolicy);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const body = await response.text();
  headers.set('content-security-policy', await pagePolicy(body));
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

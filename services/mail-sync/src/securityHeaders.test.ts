import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { pagePolicy, webAppPolicy, withSecurityHeaders } from './securityHeaders.js';

test('every response gets HSTS, nosniff and no framing, without touching JSON or streams', async () => {
  const json = await withSecurityHeaders(new Response('{"a":1}', { status: 201, headers: { 'content-type': 'application/json' } }));
  assert.equal(json.status, 201);
  assert.equal(await json.text(), '{"a":1}');
  assert.match(json.headers.get('strict-transport-security')!, /max-age=31536000/);
  assert.equal(json.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(json.headers.get('x-frame-options'), 'DENY');
  assert.equal(json.headers.get('content-security-policy'), null);
  const redirect = await withSecurityHeaders(Response.redirect('https://openmedia.site/', 301));
  assert.equal(redirect.headers.get('location'), 'https://openmedia.site/');
});

test('server pages may run only the inline scripts they ship', async () => {
  const script = 'console.log("tools")';
  const page = await withSecurityHeaders(new Response(`<html><script type="application/ld+json">{"@type":"Thing"}</script><script>${script}</script></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const policy = page.headers.get('content-security-policy')!;
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(await pagePolicy('<p>no scripts</p>'), /script-src https:\/\/static\.cloudflareinsights\.com;/);
});

test('the web app runs only its own scripts and connects only over TLS', async () => {
  const app = await withSecurityHeaders(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }), { webApp: true });
  assert.equal(app.headers.get('content-security-policy'), webAppPolicy);
  assert.match(webAppPolicy, /script-src 'self' 'wasm-unsafe-eval' https:\/\/static\.cloudflareinsights\.com;/);
  assert.match(webAppPolicy, /connect-src 'self' https: wss:;/);
  assert.doesNotMatch(webAppPolicy, /'unsafe-eval'[^-]/);
});

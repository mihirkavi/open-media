import assert from 'node:assert/strict';
import test from 'node:test';

import { handleWebAppRequest, parseByteRange } from './webApp.js';

const served: string[] = [];
const env = { WEB_APP_HOSTS: 'openmedia.site,www.openmedia.site', ASSETS: { fetch: async (request: Request) => { served.push(new URL(request.url).pathname); return new Response('app'); } } };
const html = { accept: 'text/html,application/xhtml+xml' };
const ask = (url: string, headers: Record<string, string> = html) => handleWebAppRequest(new Request(url, { headers }), env);

test('browsers on openmedia.site get the web app at / and at the sign-in callback', async () => {
  served.length = 0;
  assert.equal(await (await ask('https://openmedia.site/'))!.text(), 'app');
  assert.equal(await (await ask('https://openmedia.site/auth?code=abc'))!.text(), 'app');
  // The phone app's passkey page (ADR 0034) is the app too, never a shortcut to a profile called "passkey".
  const passkey = await ask('https://openmedia.site/passkey');
  assert.equal(passkey!.status, 200);
  assert.equal(await passkey!.text(), 'app');
  await ask('https://openmedia.site/_expo/static/js/web/index.js', {});
  assert.deepEqual(served, ['/', '/', '/', '/_expo/static/js/web/index.js']);
});

test('content-hashed build files are cached for a year; the page and unhashed files are not', async () => {
  const cacheControl = async (path: string) => (await ask(`https://openmedia.site${path}`, {}))!.headers.get('cache-control');
  assert.equal(await cacheControl('/_expo/static/js/web/index-7bbf390c0e2070ae0b7468b5d83b780d.js'), 'public, max-age=31536000, immutable');
  assert.equal(await cacheControl('/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.b4eb097d35f44ed943676fd56f6bdc51.ttf'), 'public, max-age=31536000, immutable');
  assert.equal(await cacheControl('/assets/assets/landing/film.169c34a975cb1cd523f68f5da0eb56ee.mp4'), 'public, max-age=31536000, immutable');
  for (const path of ['/favicon.ico', '/brand/logo-light.png', '/metadata.json', '/_expo/static/js/web/index.js']) assert.equal(await cacheControl(path), null, path);
  const missing = await handleWebAppRequest(new Request('https://openmedia.site/_expo/static/js/web/index-7bbf390c0e2070ae0b7468b5d83b780d.js'), { ...env, ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } });
  assert.equal(missing!.headers.get('cache-control'), null, 'a missing file is never cached for a year');
  assert.equal(await (await ask('https://openmedia.site/', html))!.headers.get('cache-control'), null);
});

test('video and other files answer byte ranges, as Safari needs to play the landing film', async () => {
  const film = new Uint8Array(1000).map((_, index) => index % 251);
  const filmPath = 'https://openmedia.site/assets/assets/landing/film.169c34a975cb1cd523f68f5da0eb56ee.mp4';
  // The static-asset service returns whole files in chunks, as Cloudflare does.
  const site = { ...env, ASSETS: { fetch: async () => new Response(new ReadableStream({ start(controller) { for (let at = 0; at < film.length; at += 64) controller.enqueue(film.slice(at, at + 64)); controller.close(); } }), { headers: { 'content-type': 'video/mp4', 'content-length': String(film.length), etag: '"film"' } }) } };
  const get = (headers: Record<string, string>, method = 'GET') => handleWebAppRequest(new Request(filmPath, { method, headers }), site) as Promise<Response>;

  const part = await get({ range: 'bytes=100-299' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-299/1000');
  assert.equal(part.headers.get('content-length'), '200');
  assert.equal(part.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), film.slice(100, 300));

  const first = await get({ range: 'bytes=0-1' }); // Safari's first probe
  assert.equal(first.status, 206);
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), film.slice(0, 2));
  assert.deepEqual(new Uint8Array(await (await get({ range: 'bytes=990-' })).arrayBuffer()), film.slice(990));
  assert.deepEqual(new Uint8Array(await (await get({ range: 'bytes=-5' })).arrayBuffer()), film.slice(995));

  const whole = await get({});
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
  assert.equal((await get({ range: 'bytes=0-9', 'if-range': '"older"' })).status, 200, 'a changed file is sent whole');
  assert.equal((await get({ range: 'bytes=0-9,20-29' })).status, 200, 'several ranges get the whole file');
  const beyond = await get({ range: 'bytes=1000-' });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), 'bytes */1000');
  const head = await get({ range: 'bytes=0-9' }, 'HEAD');
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '10');

  // Cloudflare's static-asset service often leaves out the length; the range is still served.
  const unsized = { ...env, ASSETS: { fetch: async () => new Response(film, { headers: { 'content-type': 'video/mp4', etag: '"film"' } }) } };
  const fromUnsized = (await handleWebAppRequest(new Request(filmPath, { headers: { range: 'bytes=10-19' } }), unsized))!;
  assert.equal(fromUnsized.status, 206);
  assert.equal(fromUnsized.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual(new Uint8Array(await fromUnsized.arrayBuffer()), film.slice(10, 20));
  const unsizedBeyond = (await handleWebAppRequest(new Request(filmPath, { headers: { range: 'bytes=5000-' } }), unsized))!;
  assert.equal(unsizedBeyond.headers.get('content-range'), 'bytes */1000');

  // Compressed files are never cut: the length would be of the compressed bytes.
  const compressed = { ...env, ASSETS: { fetch: async () => new Response('x'.repeat(50), { headers: { 'content-length': '20', 'content-encoding': 'br' } }) } };
  assert.equal((await handleWebAppRequest(new Request('https://openmedia.site/_expo/static/js/web/index-7bbf390c0e2070ae0b7468b5d83b780d.js', { headers: { range: 'bytes=0-9' } }), compressed))!.status, 200);
});

test('byte ranges are parsed as the HTTP spec says', () => {
  assert.deepEqual(parseByteRange('bytes=0-0', 10), [0, 0]);
  assert.deepEqual(parseByteRange('bytes=5-100', 10), [5, 9], 'an end past the file is clamped');
  assert.deepEqual(parseByteRange('bytes=-100', 10), [0, 9]);
  assert.equal(parseByteRange('bytes=-0', 10), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=10-', 10), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=5-2', 10), 'unsatisfiable');
  for (const header of [null, '', 'bytes=-', 'items=0-5', 'bytes=0-1,3-4']) assert.equal(parseByteRange(header, 10), undefined, String(header));
});

test('www redirects to the apex; the API, agents and other hosts are left to the Worker', async () => {
  const redirect = await ask('https://www.openmedia.site/auth?code=1');
  assert.equal(redirect!.status, 301);
  assert.equal(redirect!.headers.get('location'), 'https://openmedia.site/auth?code=1');
  assert.equal(await ask('https://openmedia.site/v1/feed'), undefined);
  assert.equal(await ask('https://openmedia.site/llms.txt'), undefined);
  assert.equal(await ask('https://openmedia.site/', { accept: 'application/json' }), undefined, 'API clients keep the JSON index');
  assert.equal(await ask('https://openmedia.site/', { accept: 'text/markdown' }), undefined, 'agents keep the Markdown homepage');
  assert.equal(await ask('https://openmedia.site/?mode=agent'), undefined);
  assert.equal(await ask('https://api.openmedia.site/'), undefined);
  assert.equal(await ask('https://convo-mail-sync.convo-mail-sync.workers.dev/'), undefined);
  assert.equal(await handleWebAppRequest(new Request('https://openmedia.site/', { headers: html }), { WEB_APP_HOSTS: 'openmedia.site' }), undefined, 'no build, no web app');
});

test('openmedia.site/@handle opens the app on that profile, and /handle redirects there', async () => {
  served.length = 0;
  assert.equal(await (await ask('https://openmedia.site/@mihirkavishwar'))!.text(), 'app');
  assert.deepEqual(served, ['/']);
  const shortcut = await ask('https://openmedia.site/MihirKavishwar');
  assert.equal(shortcut!.status, 301);
  assert.equal(shortcut!.headers.get('location'), 'https://openmedia.site/@mihirkavishwar');
  // Pages, API roots and resume files are never taken as handles.
  for (const path of ['/docs', '/mission', '/v1', '/auth', '/llms.txt', '/@mihirkavishwar/resume']) assert.ok(!(await ask(`https://openmedia.site${path}`))?.headers.get('location')?.includes('/@'), path);
  assert.equal(await ask('https://openmedia.site/@mihirkavishwar/resume'), undefined, 'the resume page comes from the Worker');
  assert.equal(await ask('https://openmedia.site/mihirkavishwar', { accept: 'application/json' }), undefined, 'only browsers are redirected');
});

test('the homepage HTML carries readable text, JSON-LD and Link headers for agents that do not run JavaScript', async () => {
  const shell = '<!DOCTYPE html><html lang="en"><head><title>Open Media</title></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div><script src="/_expo/static/js/web/index.js" defer></script></body></html>';
  const site = { ...env, ASSETS: { fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html', etag: '"1"' } }) } };
  const response = (await handleWebAppRequest(new Request('https://openmedia.site/', { headers: html }), site))!;
  const page = await response.text();
  const link = response.headers.get('link') ?? '';
  for (const rel of ['sitemap', 'alternate', 'service-desc', 'api-catalog']) assert.ok(link.includes(`rel="${rel}"`), rel);
  assert.ok(link.includes('<https://openmedia.site/v1/openapi.json>'));
  assert.equal(response.headers.get('etag'), null, 'the changed page is not the build file');
  const jsonLd = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]) as { '@graph': { '@type': string; sameAs?: string[] }[] };
  const types = jsonLd['@graph'].map((item) => item['@type']);
  for (const type of ['Organization', 'WebSite', 'SoftwareApplication']) assert.ok(types.includes(type), type);
  assert.ok(jsonLd['@graph'].find((item) => item['@type'] === 'Organization')!.sameAs!.includes('https://github.com/mihirkavi/open-media'));
  // The readable text lives inside the app's root element, which React replaces when the app starts.
  const root = page.slice(page.indexOf('<div id="root">'), page.indexOf('<script src="/_expo'));
  const text = root.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(text.length > 500, `only ${text.length} characters`);
  const headings = [...root.matchAll(/<h([1-6])>/g)].map((match) => Number(match[1]));
  assert.equal(headings.filter((level) => level === 1).length, 1);
  headings.forEach((level, index) => assert.ok(index === 0 || level <= headings[index - 1] + 1, 'headings never skip a level'));
  assert.ok(page.includes('<link rel="canonical" href="https://openmedia.site/">') && page.includes('og:image'));
  assert.ok(page.includes('href="https://openmedia.site/docs"'), 'the homepage links the API docs');
  // The sign-in callback and profiles get the build file untouched.
  assert.equal(await (await handleWebAppRequest(new Request('https://openmedia.site/auth?code=1', { headers: html }), site))!.text(), shell);
  assert.equal((await handleWebAppRequest(new Request('https://openmedia.site/@someone', { headers: html }), site))!.headers.get('link'), null);
});

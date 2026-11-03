import assert from 'node:assert/strict';
import test from 'node:test';

import { handleWebAppRequest } from './webApp.js';

const served: string[] = [];
const env = { WEB_APP_HOSTS: 'openmedia.site,www.openmedia.site', ASSETS: { fetch: async (request: Request) => { served.push(new URL(request.url).pathname); return new Response('app'); } } };
const html = { accept: 'text/html,application/xhtml+xml' };
const ask = (url: string, headers: Record<string, string> = html) => handleWebAppRequest(new Request(url, { headers }), env);

test('browsers on openmedia.site get the web app at / and at the sign-in callback', async () => {
  served.length = 0;
  assert.equal(await (await ask('https://openmedia.site/'))!.text(), 'app');
  assert.equal(await (await ask('https://openmedia.site/auth?code=abc'))!.text(), 'app');
  await ask('https://openmedia.site/_expo/static/js/web/index.js', {});
  assert.deepEqual(served, ['/', '/', '/_expo/static/js/web/index.js']);
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

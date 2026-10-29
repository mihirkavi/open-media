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

import assert from 'node:assert/strict';
import test from 'node:test';

import { appReturnURL, authorizeURL, escapeLinkedIn, exchangeCode, parseState, publishSocial, socialStatus } from './socialOAuth.js';

const env = { CONVO_APP_ORIGIN: 'https://openmedia.site', X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret', THREADS_APP_ID: 'tid', THREADS_APP_SECRET: 'tsecret' };
const state = `omc_${'a'.repeat(32)}_w`;

test('status reports only networks whose app is configured', () => {
  assert.deepEqual(socialStatus(env), { x: true, threads: true, linkedin: false, instagram: false, facebook: false });
});

test('states must come from Open Media and say where to return', () => {
  assert.deepEqual(parseState(state), { client: 'web' });
  assert.deepEqual(parseState(`omc_${'b'.repeat(32)}_n`), { client: 'native' });
  assert.equal(parseState('omc_short_w'), undefined);
  assert.throws(() => authorizeURL('x', env, 'https://openmedia.site', { state: 'evil', challenge: 'c'.repeat(43) }));
});

test('authorize URLs use the server callback and PKCE for X', () => {
  const url = new URL(authorizeURL('x', env, 'https://openmedia.site', { state, challenge: 'c'.repeat(43) }));
  assert.equal(url.origin, 'https://x.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://openmedia.site/v1/social/x/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.throws(() => authorizeURL('linkedin', env, 'https://openmedia.site', { state }), /isn’t set up/);
});

test('the callback returns to the web app or the phone app, never elsewhere', () => {
  assert.equal(appReturnURL(env, 'https://openmedia.site', new URLSearchParams({ state, code: 'abc' })), `https://openmedia.site/auth?state=${state}&code=abc`);
  const native = `omc_${'c'.repeat(32)}_n`;
  assert.equal(appReturnURL(env, 'https://openmedia.site', new URLSearchParams({ state: native, error: 'access_denied' })), `openmedia://oauth?state=${native}&error=access_denied`);
  assert.throws(() => appReturnURL(env, 'https://openmedia.site', new URLSearchParams({ state: 'https://evil.example', code: 'x' })));
});

test('X code exchange returns the device session', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/oauth2/token')) {
      assert.match(String((init?.headers as Record<string, string>).authorization), /^Basic /);
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 7200 }));
    }
    return new Response(JSON.stringify({ data: { id: '42', username: 'alex' } }));
  }) as typeof fetch;
  const session = await exchangeCode('x', env, 'https://openmedia.site', { code: 'code', verifier: 'v'.repeat(43) }, fetcher);
  assert.equal(session.handle, '@alex');
  assert.equal(session.refreshToken, 'rt');
  assert.ok(session.expiresAt! > Date.now());
  assert.deepEqual(calls, ['POST https://api.x.com/2/oauth2/token', 'GET https://api.x.com/2/users/me']);
});

test('Threads publishes in two steps and returns the permalink', async () => {
  const fetcher = (async (url: string) => {
    if (url.endsWith('/me/threads')) return new Response(JSON.stringify({ id: 'container' }));
    if (url.endsWith('/threads_publish')) return new Response(JSON.stringify({ id: 'post1' }));
    return new Response(JSON.stringify({ permalink: 'https://www.threads.net/@alex/post/1' }));
  }) as typeof fetch;
  const result = await publishSocial('threads', { token: 't', accountId: '1', handle: '@alex' }, { text: 'Hello' }, fetcher);
  assert.deepEqual(result, { externalId: 'post1', url: 'https://www.threads.net/@alex/post/1' });
});

test('network errors become plain messages', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ detail: 'You are not permitted to perform this action.' }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(publishSocial('x', { token: 't', accountId: '1', handle: '@a' }, { text: 'hi' }, fetcher), /X: You are not permitted/);
});

test('LinkedIn commentary escapes its markup characters', () => {
  assert.equal(escapeLinkedIn('Hi (team) #launch @me'), 'Hi \\(team\\) \\#launch \\@me');
});

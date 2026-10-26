import assert from 'node:assert/strict';
import test from 'node:test';

import { run } from './cli';

async function capture(argv: string[], env: Record<string, string | undefined> = {}, fetchImpl?: typeof fetch) {
  const out: string[] = []; const err: string[] = [];
  const log = console.log; const error = console.error; const realFetch = globalThis.fetch;
  console.log = (...args: unknown[]) => { out.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { err.push(args.join(' ')); };
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try { return { code: await run(argv, env), out: out.join('\n'), err: err.join('\n') }; }
  finally { console.log = log; console.error = error; globalThis.fetch = realFetch; }
}

const page = { data: [{ id: 'p1', network: 'lens', author: { name: 'Ada', handle: '@ada', avatarUrl: null }, title: null, text: 'Hello', createdAt: '2026-10-25T00:00:00Z', url: 'https://lens.example/p1', media: [], engagement: null, why: { used: ['Newest first'], filters: [], notUsed: [] } }], unavailable: [], nextCursor: null, next: null };

test('feed prints posts for people and JSON for agents', async () => {
  const calls: string[] = [];
  const fake = (async (url: URL | string) => { calls.push(String(url)); return Response.json(page); }) as typeof fetch;
  const human = await capture(['feed', '--sources', 'lens', '--base-url', 'https://api.test'], {}, fake);
  assert.equal(human.code, 0);
  assert.match(human.out, /Ada \(@ada\) · lens/);
  assert.match(human.out, /Why this: Newest first/);
  assert.equal(calls[0], 'https://api.test/v1/feed?sources=lens&kind=feed');
  const json = await capture(['feed', '--json', '--base-url', 'https://api.test'], {}, fake);
  assert.equal(JSON.parse(json.out).data[0].id, 'p1');
});

test('wrong commands and missing tokens are usage errors, and posting needs --yes', async () => {
  assert.equal((await capture(['nope'])).code, 2);
  assert.equal((await capture(['feed', '--sources', 'myspace'])).code, 2);
  const noToken = await capture(['me']);
  assert.equal(noToken.code, 2);
  assert.match(noToken.err, /OPEN_MEDIA_TOKEN/);
  let called = false;
  const fake = (async () => { called = true; return Response.json({}); }) as typeof fetch;
  const unconfirmed = await capture(['post', 'hello', 'world'], { OPEN_MEDIA_TOKEN: 't' }, fake);
  assert.equal(unconfirmed.code, 2);
  assert.match(unconfirmed.err, /--yes/);
  assert.equal(called, false, 'nothing is published without --yes');
});

test('API refusals exit 1 with the server’s code', async () => {
  const fake = (async () => Response.json({ error: { code: 'unauthorized', message: 'Send your token.' } }, { status: 401 })) as typeof fetch;
  const result = await capture(['me', '--json'], { OPEN_MEDIA_TOKEN: 'bad' }, fake);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.err).error.code, 'unauthorized');
});

test('mcp-config prints working setups for Claude Code and Codex', async () => {
  assert.match((await capture(['mcp-config', 'codex'])).out, /bearer_token_env_var = "OPEN_MEDIA_TOKEN"/);
  assert.match((await capture(['mcp-config', 'claude'])).out, /"type": "http"/);
});

test('login saves a private session that account commands then use', async () => {
  const { mkdtempSync, statSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'open-media-cli-'));
  const calls: { url: string; auth?: string }[] = [];
  const fake = (async (url: URL | string, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ url: path, auth: (init.headers as Record<string, string>)?.authorization });
    if (path === '/v1/auth/email-code') return Response.json({ sent: true });
    if (path === '/v1/auth/verify') return Response.json({ access_token: 'at1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt1', user: { id: 'u1' } });
    if (path === '/v1/me') return Response.json({ handle: 'ada' });
    return Response.json({ signedOut: true });
  }) as typeof fetch;
  const env = { OPEN_MEDIA_CONFIG_DIR: dir, OPEN_MEDIA_BASE_URL: 'https://api.test' };
  const asked = await capture(['login', 'ada@example.test'], env, fake);
  assert.equal(asked.code, 0);
  assert.match(asked.out, /--code <code>/, 'without a terminal it explains the second step');
  const done = await capture(['login', 'ada@example.test', '--code', '12345678'], env, fake);
  assert.match(done.out, /Signed in as @ada/);
  const file = join(dir, 'session.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal((await capture(['token'], env, fake)).out, 'at1');
  await capture(['me', '--json'], env, fake);
  assert.equal(calls.at(-1)!.auth, 'Bearer at1');
  await capture(['logout'], env, fake);
  assert.equal(existsSync(file), false);
});

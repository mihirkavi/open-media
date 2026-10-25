import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenMedia, OpenMediaError } from './index';

function fake(responses: (Response | (() => Response))[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift()!;
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return { impl, calls };
}

test('public reads need no token and build the query', async () => {
  const net = fake([Response.json({ data: [], unavailable: [], nextCursor: null, next: null })]);
  const om = new OpenMedia({ baseUrl: 'https://api.test/', fetch: net.impl });
  await om.feed({ sources: ['farcaster', 'lens'], mode: 'raw' });
  assert.equal(net.calls[0].url, 'https://api.test/v1/feed?sources=farcaster%2Clens&mode=raw');
  assert.equal((net.calls[0].init.headers as Record<string, string>).authorization, undefined);
});

test('writes carry the token and one idempotency key across a 429 retry', async () => {
  const net = fake([new Response('{}', { status: 429, headers: { 'retry-after': '0' } }), Response.json({ id: 'p1' }, { status: 201 })]);
  const om = new OpenMedia({ baseUrl: 'https://api.test', token: 'tok', fetch: net.impl });
  assert.deepEqual(await om.publish('hello'), { id: 'p1' });
  const [first, second] = net.calls.map((call) => call.init.headers as Record<string, string>);
  assert.equal(first.authorization, 'Bearer tok');
  assert.match(first['idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.equal(first['idempotency-key'], second['idempotency-key']);
  assert.deepEqual(JSON.parse(String(net.calls[0].init.body)), { text: 'hello' });
});

test('errors keep the server’s code and message', async () => {
  const net = fake([Response.json({ error: { code: 'unauthorized', message: 'Send your token.' } }, { status: 401 })]);
  await assert.rejects(new OpenMedia({ baseUrl: 'https://api.test', fetch: net.impl }).me(), (error: unknown) => error instanceof OpenMediaError && error.status === 401 && error.code === 'unauthorized' && error.message === 'Send your token.');
});

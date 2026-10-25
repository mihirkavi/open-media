import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAgentRequest, isAgentPath } from './agentApi.js';
import { handleSiteRequest } from './agentSite.js';

const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
const origin = 'https://api.test';

/** Every network and the database are offline, so answers come from the docs alone. */
async function offline<T>(run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}

const ask = (body: unknown, accept = 'application/json') => handleAgentRequest(new Request(`${origin}/ask`, { method: 'POST', headers: { 'content-type': 'application/json', accept }, body: JSON.stringify(body) }), env);

test('NLWeb /ask answers from the docs with schema.org items and fails in the spec’s shape', async () => {
  assert.equal(isAgentPath('/ask', 'POST'), true);
  const answer = await offline(async () => (await ask({ query: { text: 'how do agents register for an access token' } })).json()) as { _meta: { response_type: string; version: string }; results: { '@type': string; url: string }[] };
  assert.equal(answer._meta.response_type, 'answer');
  assert.equal(answer._meta.version, '0.55');
  assert.ok(answer.results.some((item) => item['@type'] === 'TechArticle' && item.url.startsWith(origin)));
  const empty = await (await ask({ query: { text: '' } })).json() as { _meta: { response_type: string }; error: { code: string } };
  assert.equal(empty._meta.response_type, 'failure');
  assert.equal(empty.error.code, 'INVALID_QUERY');
  const nothing = await offline(async () => (await ask({ query: { text: 'zzqxv' } })).json()) as { error: { code: string } };
  assert.equal(nothing.error.code, 'NO_RESULTS');
});

test('NLWeb /ask streams start, result and complete events when asked', async () => {
  const response = await offline(() => ask({ query: { text: 'payments test mode' }, prefer: { streaming: true } }, 'text/event-stream'));
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = await response.text();
  assert.match(body, /^event: start\n/);
  assert.match(body, /event: result\ndata: \{"index":0,"item":/);
  assert.match(body, /event: complete\n[^]*$/);
});

test('the schema map lists every page and the posts feed, and robots.txt points to it', async () => {
  const map = await (await handleSiteRequest(new Request(`${origin}/schemamap.xml`)))!.text();
  assert.match(map, /<schemamap xmlns="http:\/\/www\.nlweb\.ai\/schemas\/schemamap\/0\.1">/);
  assert.match(map, /<loc>https:\/\/api\.test\/feeds\/posts\.jsonl<\/loc>\s*<schema>https:\/\/schema\.org\/SocialMediaPosting<\/schema>/);
  assert.match(map, /<loc>https:\/\/api\.test\/auth<\/loc>/);
  const robots = await (await handleSiteRequest(new Request(`${origin}/robots.txt`)))!.text();
  assert.match(robots, /^schemamap: https:\/\/api\.test\/schemamap\.xml$/m);
});

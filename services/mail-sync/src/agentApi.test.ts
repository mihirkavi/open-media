import assert from 'node:assert/strict';
import test from 'node:test';

import { agentInterfaces } from '../../../src/domain/about';
import { SocialPost } from '../../../src/domain/posts';
import { agentPost, apiIndex, fullOpenApi, handleAgentRequest, isAgentPath, llmsTxt, networksDescription, serverCard, settingsLookup } from './agentApi.js';

const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
const origin = 'https://api.test';

test('agent routes are matched before the read-only API, and only for their paths', () => {
  for (const path of ['/', '/v1', '/v1/openapi.json', '/llms.txt', '/.well-known/mcp.json', '/open/mcp', '/me/mcp', '/v1/feed', '/v1/search', '/v1/networks', '/v1/settings', '/v1/about', '/v1/me', '/v1/me/posts', '/v1/me/conversations/x/messages']) {
    assert.equal(isAgentPath(path, 'GET'), true, path);
  }
  assert.equal(isAgentPath('/v1/posts/abc/report', 'POST'), true);
  assert.equal(isAgentPath('/v1/posts', 'GET'), false);
  assert.equal(isAgentPath('/v1/profiles/ada', 'GET'), false);
  assert.equal(isAgentPath('/v1/mail-accounts', 'GET'), false);
});

test('every documented interface appears in llms.txt, the API index and the server card', () => {
  const text = llmsTxt(origin);
  const index = JSON.stringify(apiIndex(origin));
  for (const item of [...agentInterfaces.discovery, ...agentInterfaces.public, ...agentInterfaces.account, ...agentInterfaces.mcp]) {
    assert.ok(text.includes(item.path), `llms.txt lists ${item.path}`);
    assert.ok(index.includes(item.path), `/v1 lists ${item.path}`);
  }
  assert.deepEqual(serverCard(origin).servers.map((server) => server.url), [`${origin}/open/mcp`, `${origin}/me/mcp`, `${origin}/mcp`]);
});

test('the OpenAPI document covers the public, feed and account routes and marks account routes as bearer-only', () => {
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { security?: unknown }>> };
  for (const path of ['/v1/posts', '/v1/profiles/{handle}', '/v1/feed', '/v1/search', '/v1/networks', '/v1/settings', '/v1/about', '/v1/me', '/v1/me/posts', '/v1/me/conversations', '/v1/me/export']) {
    assert.ok(document.paths[path], path);
  }
  assert.ok(document.paths['/v1/me/posts'].post.security);
  assert.equal(document.paths['/v1/feed'].get.security, undefined);
});

test('posts from any network keep their source, link and “why” reasons', () => {
  const post: SocialPost = {
    id: 'lens-1', author: { id: 'a', displayName: 'Ada', handle: '@ada', initials: 'A' }, body: 'Hello', kind: 'video', createdAt: '2026-10-24T10:00:00Z', topics: [],
    media: [{ kind: 'video', url: 'https://cdn.test/v.mp4', aspectRatio: 1, altText: '' }, { kind: 'image', aspectRatio: 1, altText: 'no url' }],
    provenance: { connectorId: 'lens', canonicalURL: 'https://hey.xyz/posts/1' }, relevance: { followsAuthor: false, selectedInterestMatches: [] },
    eligibility: { selection: 'Newest public post on Lens', filters: ['Replies and reposts are hidden'] },
  };
  const result = agentPost(post, 'raw', origin);
  assert.equal(result.network, 'lens');
  assert.equal(result.url, 'https://hey.xyz/posts/1');
  assert.deepEqual(result.media.map((item) => item.type), ['video']);
  assert.ok(result.why.used.includes('Newest public post on Lens'));
  assert.deepEqual(result.why.filters, ['Replies and reposts are hidden']);
  assert.ok(result.why.notUsed.includes('Private messages'));
});

test('settings are searchable and say where they live', () => {
  const found = settingsLookup('dark mode').data;
  assert.equal(found[0].id, 'appearance');
  assert.equal(found[0].where, 'Settings → Appearance');
  assert.ok(settingsLookup(null).data.length > 5);
});

test('networks report bridges as running only when this server runs them', () => {
  const off = networksDescription(env);
  assert.ok(off.chatNetworks.every((network) => !network.runningOnThisServer));
  const on = networksDescription({ ...env, BRIDGES_HOMESERVER_URL: 'http://hs', BRIDGES_SERVER_NAME: 'x', BRIDGES_AS_TOKEN: 't', BRIDGES_PROVISIONING_SECRET: 's', BRIDGES_SIGNAL_URL: 'http://signal' });
  assert.deepEqual(on.chatNetworks.filter((network) => network.runningOnThisServer).map((network) => network.id), ['signal']);
  assert.deepEqual(off.openNetworks.map((network) => network.id), ['farcaster', 'lens', 'hive', 'deso']);
});

test('account routes and the account MCP server refuse requests without a valid token', async () => {
  for (const [method, path] of [['GET', '/v1/me'], ['POST', '/v1/me/posts'], ['GET', '/v1/me/conversations'], ['POST', '/me/mcp']]) {
    const response = await handleAgentRequest(new Request(`${origin}${path}`, { method, headers: { authorization: 'Bearer not-a-jwt', 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }), env);
    assert.equal(response.status, 401, path);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'unauthorized');
  }
});

test('bad feed parameters and cursors are explained, not guessed', async () => {
  const bad = async (query: string) => (await handleAgentRequest(new Request(`${origin}/v1/feed?${query}`), env)).status;
  assert.equal(await bad('sources=myspace'), 400);
  assert.equal(await bad('kind=reels'), 400);
  assert.equal(await bad('cursor=%%%'), 400);
  assert.equal((await handleAgentRequest(new Request(`${origin}/v1/search?q=`), env)).status, 400);
});

test('discovery documents are served with open CORS', async () => {
  const response = await handleAgentRequest(new Request(`${origin}/llms.txt`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(await response.text(), /^# Open Media/);
  const card = await handleAgentRequest(new Request(`${origin}/.well-known/mcp.json`), env);
  assert.equal(((await card.json()) as { name: string }).name, 'Open Media');
});

test('agent routes share the public per-client rate limit', async () => {
  const limited = { ...env, PUBLIC_API_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await handleAgentRequest(new Request(`${origin}/v1/about`), limited);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});

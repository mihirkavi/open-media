import assert from 'node:assert/strict';
import test from 'node:test';

import { agentInterfaces } from '../../../src/domain/about';
import { SocialPost } from '../../../src/domain/posts';
import { Account, accountMcp, agentPost, apiIndex, fullOpenApi, handleAgentRequest, isAgentPath, llmsTxt, networksDescription, serverCard, settingsLookup } from './agentApi.js';

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
  assert.equal(isAgentPath('/v1/people/farcaster/dwr', 'GET'), true);
  assert.equal(isAgentPath('/v1/people/farcaster/dwr', 'POST'), false);
});

test('person timelines name the networks they accept and refuse bad handles', async () => {
  const status = async (path: string) => (await handleAgentRequest(new Request(`${origin}${path}`), env)).status;
  assert.equal(await status('/v1/people/myspace/tom'), 400);
  assert.equal(await status('/v1/people/hive/bad%20name'), 404);
  assert.equal(await status('/v1/people/open-media/bad%20name'), 404);
});

test('contacts and linked accounts are account-only and documented', async () => {
  for (const [method, path] of [['GET', '/v1/me/contacts'], ['PUT', '/v1/me/contacts'], ['DELETE', '/v1/me/contacts/6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11'], ['PUT', '/v1/me/linked-accounts']]) {
    const response = await handleAgentRequest(new Request(`${origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '[]' }), env);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { security?: unknown }>> };
  assert.ok(document.paths['/v1/me/contacts'].get.security);
  assert.ok(document.paths['/v1/me/contacts'].put.security);
  assert.ok(document.paths['/v1/me/linked-accounts'].put.security);
  assert.equal(document.paths['/v1/people/{network}/{handle}'].get.security, undefined);
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

test('every documented public and account route is in the OpenAPI document', () => {
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, unknown>> };
  for (const item of [...agentInterfaces.public, ...agentInterfaces.account]) {
    const path = item.path.replace(/\?.*$/, '');
    assert.ok(document.paths[path], `${item.method} ${path} missing from OpenAPI`);
    assert.ok(document.paths[path][item.method.toLowerCase()], `${item.method} ${path} has no ${item.method} operation`);
  }
});

const personToken = 'person-access-token';
const person = '6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11';
const listingPost = '9a1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d22';

test('payment routes are account-only, bearer-only in OpenAPI, and the webhook stays closed until configured', async () => {
  for (const [method, path] of [['GET', '/v1/me/payments'], ['POST', '/v1/me/payments'], ['GET', '/v1/me/payments/setup'], ['POST', '/v1/me/wallets'], ['PUT', '/v1/me/payments/tips'], ['POST', '/v1/me/paid-posts'], ['GET', `/v1/me/posts/${listingPost}/paid`]]) {
    const response = await handleAgentRequest(new Request(`${origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { security?: unknown }>> };
  for (const [path, method] of [['/v1/me/payments', 'post'], ['/v1/me/payments', 'get'], ['/v1/me/wallets', 'post'], ['/v1/me/paid-posts', 'post'], ['/v1/me/payments/tips', 'put']]) {
    assert.ok(document.paths[path]?.[method]?.security, `${method} ${path} is bearer-only`);
  }
  assert.equal(isAgentPath('/v1/payments/stripe/webhook', 'POST'), true);
  const webhook = await handleAgentRequest(new Request(`${origin}/v1/payments/stripe/webhook`, { method: 'POST', body: '{}' }), env);
  assert.equal(webhook.status, 503);
});

/** Runs the real account MCP server for one person against a fake database. */
async function withAccount(database: (name: string, args: Record<string, unknown>) => unknown, run: (call: (method: string, params?: object) => Promise<any>, requests: { url: string; headers: Record<string, string>; body: any }[]) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, headers: init?.headers as Record<string, string>, body });
    const name = url.match(/\/rpc\/([a-z_]+)/)?.[1] ?? '';
    return Response.json(database(name, body ?? {}) ?? null);
  }) as typeof fetch;
  try {
    const paymentsEnv = { ...env, SUPABASE_SECRET_KEY: 'service-key', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PAYMENTS_WEBHOOK_SECRET: 'whsec_x' };
    const server = accountMcp(paymentsEnv, origin, new Account(paymentsEnv, personToken, person, origin));
    let id = 0;
    const call = async (method: string, params: object = {}) => {
      const response = await server.fetch(new Request(`${origin}/me/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }));
      const text = await response.text();
      // The MCP server may answer as JSON or as one server-sent event.
      const payload = text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6);
      return (JSON.parse(payload) as { result: any }).result;
    };
    await run(call, requests);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('money tools are marked as writes, removal as destructive, and reads as read-only', async () => {
  await withAccount(() => null, async (call) => {
    const tools = (await call('tools/list')).tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[];
    const byName = new Map(tools.map((item) => [item.name, item.annotations]));
    for (const name of ['start_payment', 'submit_payment_transaction', 'set_tips', 'publish_paid_post', 'start_payout_setup']) assert.equal(byName.get(name)?.readOnlyHint, false, name);
    for (const name of ['get_payment_setup', 'list_my_payments', 'get_payment', 'get_payment_options', 'get_paid_post']) assert.equal(byName.get(name)?.readOnlyHint, true, name);
    assert.equal(byName.get('remove_wallet')?.destructiveHint, true);
    assert.ok(!tools.some((item) => item.name === 'link_wallet'), 'agents cannot link a wallet without the person’s own signature');
  });
});

test('an agent cannot start a payment until the person confirmed that exact amount, and acts only with the person’s token', async () => {
  const options = { card: true, chains: [], priceMinor: 2500, currency: 'USD', available: true, platformFeeBps: 0 };
  const created = { id: '7b1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d33', rail: 'card', direction: 'sent', status: 'awaiting_payer' };
  const database = (name: string) => name === 'open_media_listing_payment_options' ? options
    : name === 'open_media_public_post' ? { author: { handle: 'seller' } }
    : name === 'open_media_create_payment_intent' ? created
    : name === 'open_media_card_payment_details' ? { ...created, payerId: person, amountMinor: 2500, currency: 'USD', platformFeeMinor: 0, providerReference: null, stripeAccountId: 'acct_test123', title: 'Desk' }
    : name === 'open_media_payment' ? created : null;
  await withAccount(database, async (call, requests) => {
    const ask = { contextType: 'listing', postId: listingPost, rail: 'card' };
    const preview = JSON.parse((await call('tools/call', { name: 'start_payment', arguments: ask })).content[0].text);
    assert.equal(preview.requiresConfirmation, true);
    assert.equal(preview.preview.amountMinor, 2500);
    assert.equal(preview.preview.recipient, 'seller');
    assert.ok(!requests.some((request) => request.url.includes('open_media_create_payment_intent')), 'nothing is created before confirmation');

    const mismatch = await call('tools/call', { name: 'start_payment', arguments: { ...ask, confirm: true, expectedAmountMinor: 100 } });
    assert.equal(mismatch.isError, true);
    assert.ok(!requests.some((request) => request.url.includes('open_media_create_payment_intent')), 'a different amount starts nothing');

    await call('tools/call', { name: 'start_payment', arguments: { ...ask, confirm: true, expectedAmountMinor: 2500 } });
    const create = requests.find((request) => request.url.includes('open_media_create_payment_intent'));
    assert.ok(create, 'the confirmed payment is created');
    assert.equal(create!.headers.authorization, `Bearer ${personToken}`, 'as the person, with their own token');
    assert.equal(create!.body.p_amount_minor, null, 'the amount is not sent for listings; the database takes it from the listing');
    const asPerson = requests.filter((request) => request.url.includes('/rest/v1/rpc/open_media_') && !/card_payment_details|record_payment_event/.test(request.url));
    assert.ok(asPerson.every((request) => request.headers.apikey !== 'service-key' && request.headers.authorization !== 'Bearer service-key'), 'the person’s calls never use the server key');
  });
});

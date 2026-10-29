import assert from 'node:assert/strict';
import test from 'node:test';

import { fullOpenApi, handleAgentRequest, isAgentPath, serverCard } from './agentApi.js';
import { lensFromRow, LensRow } from './feedLensApi.js';

const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
const origin = 'https://api.test';
const sharedId = '6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11';

const sharedRow: LensRow = {
  id: sharedId, key: 'calm-videos', name: 'Calm videos', visibility: 'public', forkedFrom: null, installs: 3,
  author: { handle: 'maker', displayName: 'Maker' }, createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z',
  manifest: { format: 'open-media.feed-lens/1', name: 'Calm videos', filters: { kinds: ['video'], mute: ['crypto'] }, order: 'newest' },
};

/** Answers the public lens functions from the database and leaves every network unreachable. */
async function withDatabase<T>(run: () => Promise<T>, rows: LensRow[] = [sharedRow]): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/rpc/open_media_public_feed_lenses')) return Response.json(rows);
    if (url.endsWith('/rpc/open_media_public_feed_lens')) return Response.json(rows[0] ?? null);
    if (url.endsWith('/rpc/open_media_public_posts')) return Response.json([]);
    throw new Error(`offline: ${url}`);
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

const get = (path: string) => handleAgentRequest(new Request(`${origin}${path}`), env);
const post = (path: string, body: unknown) => handleAgentRequest(new Request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);

test('lens routes are served here and documented, account routes bearer-only', () => {
  for (const path of ['/v1/lenses', '/v1/lenses/raw', '/v1/lenses/draft', '/v1/lenses/preview', '/v1/me/lenses', '/v1/me/feed']) assert.equal(isAgentPath(path, 'GET'), true, path);
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { security?: unknown }>> };
  assert.equal(document.paths['/v1/lenses'].get.security, undefined);
  assert.ok(document.paths['/v1/me/lenses'].post.security);
  assert.ok(document.paths['/v1/me/feed'].get.security);
  const tools = JSON.stringify(serverCard(origin));
  for (const name of ['list_feed_lenses', 'draft_feed_lens', 'preview_feed_lens', 'save_feed_lens', 'get_my_feed']) assert.ok(tools.includes(name), name);
});

test('the lens directory lists the built-ins and valid shared lenses with their rules', async () => {
  const broken = { ...sharedRow, id: '7f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d12', manifest: { name: 'Spy', filters: { privateMessages: true } } };
  const body = await withDatabase(async () => (await get('/v1/lenses')).json(), [sharedRow, broken]) as { builtIn: { id: string; rules: string[] }[]; shared: { id: string; installs: number; author: { handle: string }; shareUrl: string }[]; format: { neverReadable: string[] } };
  assert.deepEqual(body.builtIn.map((lens) => lens.id), ['relevant', 'raw', 'work']);
  assert.deepEqual(body.builtIn[1].rules, ['Newest first']);
  assert.equal(body.shared.length, 1, 'a manifest that no longer validates is not listed');
  assert.equal(body.shared[0].installs, 3);
  assert.equal(body.shared[0].author.handle, 'maker');
  assert.equal(body.shared[0].shareUrl, `https://openmedia.site/?lens=${sharedId}`);
  assert.ok(body.format.neverReadable.includes('Private messages'));
});

test('one lens by id; unknown ids are a 404 with a hint', async () => {
  const relevant = await (await get('/v1/lenses/relevant')).json() as { name: string; reads: string[] };
  assert.equal(relevant.name, 'Relevant');
  assert.deepEqual(relevant.reads, ['follows', 'interests']);
  assert.equal((await get('/v1/lenses/not-a-lens')).status, 404);
  const shared = await withDatabase(async () => (await get(`/v1/lenses/${sharedId}`)).json()) as { manifest: { author: string } };
  assert.equal(shared.manifest.author, '@maker');
});

test('plain words become a draft that says what it understood', async () => {
  const response = await post('/v1/lenses/draft', { request: 'only videos about cooking, no crypto' });
  assert.equal(response.status, 200);
  const draft = await response.json() as { manifest: { filters: Record<string, unknown> }; understood: string[]; summary: string };
  assert.deepEqual(draft.manifest.filters, { kinds: ['video'], about: ['cooking'], mute: ['crypto'] });
  assert.ok(draft.understood.includes('Only videos'));
  assert.match(draft.summary, /Only videos/);
  assert.equal((await post('/v1/lenses/draft', {})).status, 400);
});

test('previews validate manifests and refuse ones that reach for private data', async () => {
  const refused = await post('/v1/lenses/preview', { manifest: { name: 'Spy', permissions: ['private_messages'] } });
  assert.equal(refused.status, 400);
  assert.match((await refused.json() as { error: { message: string } }).error.message, /permissions can only contain/);
  const preview = await withDatabase(async () => (await post('/v1/lenses/preview', { request: 'newest first, only from open media' })).json()) as { lens: { name: string; manifest: { order: string } }; data: unknown[] };
  assert.equal(preview.lens.manifest.order, 'newest');
  assert.deepEqual(preview.data, []);
});

test('the feed accepts a lens id and reports which lens ordered it', async () => {
  const page = await withDatabase(async () => (await get('/v1/feed?sources=open-media&lens=relevant')).json()) as { lens: { id: string; summary: string } };
  assert.equal(page.lens.id, 'relevant');
  assert.match(page.lens.summary, /Ranked by newness 50%/);
  assert.equal((await get('/v1/feed?lens=nope')).status, 404);
});

test('saving lenses needs the person’s token', async () => {
  for (const [method, path] of [['GET', '/v1/me/lenses'], ['POST', '/v1/me/lenses'], ['POST', '/v1/me/lenses/install'], ['DELETE', '/v1/me/lenses/calm'], ['GET', '/v1/me/feed']]) {
    const response = await handleAgentRequest(new Request(`${origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('stored rows keep their key and never become built-ins', () => {
  assert.equal(lensFromRow({ ...sharedRow, manifest: { ...(sharedRow.manifest as object), builtIn: true, id: 'raw' } })?.id, 'calm-videos');
  assert.equal(lensFromRow({ ...sharedRow, key: 'raw' }), undefined);
});

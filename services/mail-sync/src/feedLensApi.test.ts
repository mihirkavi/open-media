import assert from 'node:assert/strict';
import test from 'node:test';

import { fullOpenApi, handleAgentRequest, isAgentPath, serverCard } from './agentApi.js';
import { lensFromRow, LensRow, myLensHistory, PersonRpc, revertMyLens, tuneMyLens } from './feedLensApi.js';

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
    if (url.endsWith('/rpc/open_media_public_feed_lens_history')) return Response.json([{ version: 2, name: 'Calm videos', manifest: { ...(rows[0]?.manifest as object), version: 2 }, changedBy: 'agent', createdAt: '2026-10-30T00:00:00Z' }]);
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
  for (const [method, path] of [['GET', '/v1/me/lenses'], ['POST', '/v1/me/lenses'], ['POST', '/v1/me/lenses/install'], ['DELETE', '/v1/me/lenses/calm'], ['GET', '/v1/me/feed'], ['POST', '/v1/me/lenses/relevant/tune'], ['GET', '/v1/me/lenses/calm/history'], ['POST', '/v1/me/lenses/calm/revert']]) {
    const response = await handleAgentRequest(new Request(`${origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }), env);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('stored rows keep their key and never become built-ins', () => {
  assert.equal(lensFromRow({ ...sharedRow, manifest: { ...(sharedRow.manifest as object), builtIn: true, id: 'raw' } })?.id, 'calm-videos');
  assert.equal(lensFromRow({ ...sharedRow, key: 'raw' }), undefined);
});

// ---------- Your own algorithm (ADR 0021) ----------

/** A person's database: their lenses and versions, answering the functions the Worker calls. */
function personDatabase() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rows: LensRow[] = [];
  const rpc: PersonRpc = async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'open_media_my_feed_lenses') return rows as T;
    if (name === 'open_media_save_feed_lens') {
      const existing = rows.find((row) => row.key === args.p_key);
      const version = (existing?.version ?? 0) + 1;
      const row: LensRow = { id: sharedId, key: String(args.p_key), name: String(args.p_name), manifest: { ...(args.p_manifest as object), version }, version, visibility: args.p_visibility as 'private', forkedFrom: null, installs: 0, createdAt: '', updatedAt: '' };
      rows.splice(0, rows.length, ...rows.filter((item) => item.key !== row.key), row);
      return row as T;
    }
    if (name === 'open_media_feed_lens_history') return [{ version: 1, name: 'My Relevant', manifest: { name: 'My Relevant', boosts: [{ source: 'hive', weight: -0.5 }] }, changedBy: 'app', createdAt: '2026-10-31T00:00:00Z' }, { version: 0, name: 'Broken', manifest: { name: 'Spy', privateMessages: true }, changedBy: 'agent', createdAt: '' }] as T;
    if (name === 'open_media_revert_feed_lens') return { ...rows[0], version: 3 } as T;
    throw new Error(`unexpected ${name}`);
  };
  return { rpc, calls, rows };
}

test('an agent tunes Relevant into the person’s own copy, and later tunes that copy', async () => {
  const database = personDatabase();
  const first = await tuneMyLens(database.rpc, origin, { key: 'relevant', request: 'less hive' }) as { key: string; name: string; version: number; changes: string[]; saved: boolean };
  assert.equal(first.key, 'my-relevant');
  assert.equal(first.name, 'My Relevant');
  assert.equal(first.version, 1);
  assert.deepEqual(first.changes, ['Now: Less Hive']);
  const save = database.calls.find((call) => call.name === 'open_media_save_feed_lens')!;
  assert.equal(save.args.p_changed_by, 'agent', 'changes through the agent API are labelled as made by an agent');
  assert.equal(save.args.p_visibility, 'private');
  // “relevant” now finds the person's copy, so the second change builds on the first.
  const second = await tuneMyLens(database.rpc, origin, { key: 'relevant', request: 'more videos' }) as { version: number; rules: string[] };
  assert.equal(second.version, 2);
  assert.ok(second.rules.includes('Less Hive') && second.rules.includes('More videos'));
});

test('tuning says when nothing would change, previews without saving, and keeps a shared lens shared', async () => {
  const database = personDatabase();
  await assert.rejects(tuneMyLens(database.rpc, origin, { key: 'relevant', request: 'tune it' }), /Nothing to change/);
  const preview = await tuneMyLens(database.rpc, origin, { key: 'relevant', request: 'mute crypto', save: false }) as { saved: boolean };
  assert.equal(preview.saved, false);
  assert.equal(database.calls.some((call) => call.name === 'open_media_save_feed_lens'), false);
  database.rows.push({ ...sharedRow, version: 4 });
  await tuneMyLens(database.rpc, origin, { key: 'calm-videos', request: 'less hive' });
  assert.equal(database.calls.find((call) => call.name === 'open_media_save_feed_lens')!.args.p_visibility, 'public');
  await assert.rejects(tuneMyLens(database.rpc, origin, { key: 'nope', request: 'less hive' }), /No saved lens/);
});

test('history lists valid versions with who made them, and revert says which version it became', async () => {
  const database = personDatabase();
  const history = await myLensHistory(database.rpc, 'my-relevant');
  assert.equal(history.data.length, 1, 'a version that no longer validates is left out');
  assert.equal(history.data[0].changedBy, 'app');
  assert.deepEqual(history.data[0].rules.slice(-1), ['Less Hive']);
  await tuneMyLens(database.rpc, origin, { key: 'relevant', request: 'less hive' });
  const reverted = await revertMyLens(database.rpc, origin, 'my-relevant', 1) as { restored: number; note: string };
  assert.equal(reverted.restored, 1);
  assert.match(reverted.note, /now version 3/);
  assert.equal(database.calls.at(-1)!.args.p_changed_by, 'agent');
  await assert.rejects(revertMyLens(database.rpc, origin, 'my-relevant', 0), /version number/);
});

test('drafts can change a base lens, and shared lenses can be audited', async () => {
  const tuned = await (await post('/v1/lenses/draft', { base: 'relevant', request: 'a lot more videos, no hive' })).json() as { key: string; changes: string[]; manifest: { format: string; boosts: unknown[] } };
  assert.equal(tuned.key, 'my-relevant');
  assert.equal(tuned.manifest.format, 'open-media.feed-lens/2');
  assert.deepEqual(tuned.changes, ['Now: Nothing from Hive', 'Now: Much more videos']);
  const history = await withDatabase(async () => (await get(`/v1/lenses/${sharedId}/history`)).json()) as { data: { version: number; changedBy: string }[] };
  assert.deepEqual(history.data.map((item) => [item.version, item.changedBy]), [[2, 'agent']]);
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { security?: unknown }>> };
  assert.equal(document.paths['/v1/lenses/{id}/history'].get.security, undefined);
  assert.ok(document.paths['/v1/me/lenses/{key}/tune'].post.security);
  const tools = JSON.stringify(serverCard(origin));
  for (const name of ['tune_feed_lens', 'get_my_feed_lens_history', 'revert_feed_lens', 'get_feed_lens_history']) assert.ok(tools.includes(name), name);
});

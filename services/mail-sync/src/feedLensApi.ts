/**
 * Feed lenses for agents and programs (ADR 0017). The manifests, validator and runner are the app's
 * own (src/domain/feedLenses.ts), so an agent previewing a lens sees exactly what the person's Feed
 * will show. Shared lenses come from the database through two public functions; saving goes through
 * the person's own token, and every manifest is validated here before it is stored.
 */
import {
  boostLimits, builtInLenses, describeLensRules, FeedLens, forbiddenSignals, lensFormat, lensFormatV2, lensFromRequest, LensError, lensKinds, lensPermissions, lensShareUrl, lensSources, lensSummary, ownCopyId, parseLens, tuneLens,
} from '../../../src/domain/feedLenses';
import { callRpc, PublicApiEnv } from './publicApi.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lensKey = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export class LensApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** A stored lens as the database functions return it. */
export interface LensRow {
  id: string;
  key: string;
  name: string;
  manifest: unknown;
  version?: number;
  visibility: 'private' | 'public';
  forkedFrom: string | null;
  installs: number;
  author?: { handle: string; displayName: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** What agents get for any lens: the manifest, its rules in words, and where to read or share it. */
export function lensView(lens: FeedLens, origin: string, row?: LensRow) {
  const id = row?.visibility === 'public' ? row.id : lens.id;
  return {
    id,
    key: lens.id,
    name: lens.name,
    version: lens.version,
    builtIn: Boolean(lens.builtIn),
    summary: lensSummary(lens),
    rules: describeLensRules(lens),
    reads: lens.permissions,
    neverReads: [...forbiddenSignals],
    ...(row ? { visibility: row.visibility, installs: row.installs, author: row.author ?? null, forkedFrom: row.forkedFrom, updatedAt: row.updatedAt } : { author: lens.author ? { handle: null, displayName: lens.author } : null }),
    manifest: lens,
    ...(lens.builtIn || row?.visibility === 'public' ? { url: `${origin}/v1/lenses/${id}`, feedUrl: `${origin}/v1/feed?lens=${id}`, shareUrl: lensShareUrl(id) } : {}),
  };
}

/** A stored row as a lens; rows that no longer validate are skipped rather than run. */
export function lensFromRow(row: LensRow): FeedLens | undefined {
  try {
    const lens = parseLens({ ...(row.manifest as Record<string, unknown>), id: row.key, builtIn: false, ...(row.version ? { version: row.version } : {}) });
    return row.author?.handle ? { ...lens, author: `@${row.author.handle}` } : lens;
  } catch { return undefined; }
}

export async function listLenses(env: PublicApiEnv, origin: string, query?: string | null) {
  const rows = await callRpc<LensRow[]>(env, fetch, 'open_media_public_feed_lenses', { p_query: query?.trim().slice(0, 80) || null, p_limit: 50 }).catch(() => [] as LensRow[]);
  const needle = query?.trim().toLocaleLowerCase();
  const builtIn = builtInLenses.filter((lens) => !needle || `${lens.name} ${lens.description}`.toLocaleLowerCase().includes(needle));
  const shared = (Array.isArray(rows) ? rows : []).flatMap((row) => { const lens = lensFromRow(row); return lens ? [lensView(lens, origin, row)] : []; });
  return {
    format: lensFormatDescription(origin),
    builtIn: builtIn.map((lens) => lensView(lens, origin)),
    shared,
    note: 'Raw, Relevant and Work are built in. Shared lenses were written by people and are run by Open Media’s own runner over public posts; none can read private data.',
  };
}

/** A lens by id: raw, relevant, work, or a shared lens's id. */
export async function findLens(env: PublicApiEnv, id: string): Promise<{ lens: FeedLens; row?: LensRow }> {
  const builtIn = builtInLenses.find((lens) => lens.id === id);
  if (builtIn) return { lens: builtIn };
  if (!uuid.test(id)) throw new LensApiError(404, 'No lens with that id. Use raw, relevant, work, or the id of a shared lens from GET /v1/lenses.');
  const row = await callRpc<LensRow | null>(env, fetch, 'open_media_public_feed_lens', { p_id: id });
  const lens = row ? lensFromRow(row) : undefined;
  if (!row || !lens) throw new LensApiError(404, 'That lens isn’t shared, or no longer exists.');
  return { lens, row };
}

/** A manifest from an agent, checked with the app's validator. */
export function checkManifest(value: unknown): FeedLens {
  try { return parseLens(typeof value === 'string' ? JSON.parse(value) : value); }
  catch (error) { throw new LensApiError(400, error instanceof LensError ? error.message : 'The lens must be a JSON manifest. See GET /v1/lenses for the format.'); }
}

/** Plain words → a lens, with what was understood and what was not. */
export function draftLens(request: unknown, origin: string) {
  const text = typeof request === 'string' ? request.trim() : '';
  if (!text) throw new LensError('Describe the feed you want, e.g. “only videos about cooking, no crypto”.');
  const draft = lensFromRequest(text);
  return {
    ...lensView(draft.lens, origin),
    understood: draft.understood,
    notUnderstood: draft.unused,
    next: 'Show the person the summary and rules. Preview it with preview_feed_lens, then save it with save_feed_lens (their account) once they agree. You may also edit the manifest yourself; it is validated again when saved.',
  };
}

/** The lens to run for a request: an id, an inline manifest, or plain words, in that order. */
export async function resolveLens(env: PublicApiEnv, input: { lens?: unknown; manifest?: unknown; request?: unknown }): Promise<FeedLens> {
  if (input.manifest !== undefined && input.manifest !== null && input.manifest !== '') return checkManifest(input.manifest);
  if (typeof input.request === 'string' && input.request.trim()) return lensFromRequest(input.request).lens;
  if (typeof input.lens === 'string' && input.lens.trim()) return (await findLens(env, input.lens.trim())).lens;
  if (input.lens && typeof input.lens === 'object') return checkManifest(input.lens);
  return builtInLenses[0];
}

/** Calls the person's own database functions. */
export type PersonRpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

export async function myLenses(rpc: PersonRpc, origin: string) {
  const rows = await rpc<LensRow[]>('open_media_my_feed_lenses', {});
  return {
    data: (rows ?? []).flatMap((row) => { const lens = lensFromRow(row); return lens ? [lensView(lens, origin, row)] : []; }),
    builtIn: builtInLenses.map((lens) => ({ id: lens.id, name: lens.name, summary: lensSummary(lens) })),
  };
}

export async function saveLens(rpc: PersonRpc, origin: string, input: { lens?: unknown; request?: unknown; visibility?: unknown; forkedFrom?: unknown }) {
  const visibility = input.visibility === undefined ? 'private' : input.visibility;
  if (visibility !== 'private' && visibility !== 'public') throw new LensApiError(400, 'visibility must be private or public.');
  const lens = input.lens !== undefined ? checkManifest(input.lens) : typeof input.request === 'string' && input.request.trim() ? lensFromRequest(input.request).lens : undefined;
  if (!lens) throw new LensApiError(400, 'Send lens (a manifest) or request (plain words).');
  if (lens.builtIn) throw new LensApiError(400, 'Raw, Relevant and Work are built in. Save a copy with another id instead.');
  const forkedFrom = typeof input.forkedFrom === 'string' && uuid.test(input.forkedFrom) ? input.forkedFrom : null;
  const row = await storeLens(rpc, lens, visibility, forkedFrom);
  return { ...lensView(lensFromRow(row) ?? lens, origin, row), saved: true, note: visibility === 'public' ? 'Shared publicly: anyone can read, install and fork it at shareUrl.' : 'Saved to the person’s account. It shows up in their Feed’s lens picker on every device.' };
}

/** Saves through the person's own token. Every change made here is recorded as made by an agent (ADR 0021). */
async function storeLens(rpc: PersonRpc, lens: FeedLens, visibility: 'private' | 'public', forkedFrom: string | null) {
  const { builtIn: _builtIn, author: _author, ...manifest } = lens;
  return rpc<LensRow>('open_media_save_feed_lens', { p_key: lens.id, p_name: lens.name, p_manifest: manifest, p_visibility: visibility, p_forked_from: forkedFrom, p_changed_by: 'agent' });
}

/**
 * Plain words that change a lens (ADR 0021), without saving: “less hive, more videos”. The base is a
 * lens id or manifest; a built-in base becomes “My …”, the person's own copy.
 */
export async function tuneDraft(env: PublicApiEnv, origin: string, base: unknown, request: unknown) {
  const text = typeof request === 'string' ? request.trim() : '';
  if (!text) throw new LensError('Say how to change the lens, e.g. “less hive, more videos”.');
  const lens = typeof base === 'string' ? (await findLens(env, base.trim())).lens : checkManifest(base);
  return tuningView(lens, text, origin);
}

function tuningView(base: FeedLens, request: string, origin: string) {
  const tuning = tuneLens(base, request);
  return {
    ...lensView(tuning.lens, origin),
    understood: tuning.understood,
    notUnderstood: tuning.unused,
    changes: tuning.changes,
    tunedFrom: { id: base.id, name: base.name, version: base.version },
    next: tuning.changes.length ? 'Show the person the changes. Save them with tune_feed_lens (their account), or preview the result with preview_feed_lens.' : 'Nothing would change. Try words like “less hive”, “more videos”, “a bit more from people I follow”, “mute crypto” or “show hive again”.',
  };
}

/** The person's lens a change starts from: their own copy of a built-in (“my-relevant”) when they have one. */
async function myBase(rpc: PersonRpc, key: string): Promise<{ lens: FeedLens; row?: LensRow }> {
  const rows = await rpc<LensRow[]>('open_media_my_feed_lenses', {});
  const builtIn = builtInLenses.find((lens) => lens.id === key);
  const wanted = builtIn ? ownCopyId(builtIn) : key;
  const row = (rows ?? []).find((item) => item.key === wanted);
  const lens = row ? lensFromRow(row) : builtIn;
  if (!lens) throw new LensApiError(404, 'No saved lens with that key. See list_my_feed_lenses, or use relevant, raw or work.');
  return { lens, row };
}

export async function tuneMyLens(rpc: PersonRpc, origin: string, input: { key?: unknown; request?: unknown; save?: unknown }) {
  if (typeof input.key !== 'string' || !lensKey.test(input.key)) throw new LensApiError(400, 'Send the lens key (relevant, raw, work, or one of the person’s lenses).');
  const request = typeof input.request === 'string' ? input.request.trim().slice(0, 400) : '';
  if (!request) throw new LensApiError(400, 'Say how to change the lens, e.g. “less hive, more videos”.');
  const { lens: base, row: baseRow } = await myBase(rpc, input.key);
  const view = tuningView(base, request, origin);
  if (!view.changes.length) throw new LensApiError(400, `Nothing to change. ${view.notUnderstood.length ? `Not understood: ${view.notUnderstood.join(', ')}. ` : ''}${view.next}`);
  if (input.save === false) return { ...view, saved: false };
  // A shared lens stays shared, so its change is public: the tool asks agents to confirm that first.
  const tuned = tuneLens(base, request).lens;
  const row = await storeLens(rpc, tuned, baseRow?.visibility ?? 'private', null);
  const saved = lensFromRow(row) ?? tuned;
  return { ...lensView(saved, origin, row), understood: view.understood, notUnderstood: view.notUnderstood, changes: view.changes, tunedFrom: view.tunedFrom, saved: true, note: `Saved as version ${row.version ?? saved.version}. It shows in the person’s Feed picker; revert_feed_lens goes back.` };
}

interface VersionRow { version: number; name: string; manifest: unknown; changedBy: 'app' | 'agent'; createdAt: string }

function versionView(key: string, row: VersionRow) {
  try {
    const lens = parseLens({ ...(row.manifest as Record<string, unknown>), id: key, version: row.version });
    return [{ version: row.version, name: row.name, summary: lensSummary(lens), rules: describeLensRules(lens), changedBy: row.changedBy, createdAt: row.createdAt, manifest: lens }];
  } catch { return []; }
}

export async function myLensHistory(rpc: PersonRpc, key: unknown) {
  if (typeof key !== 'string' || !lensKey.test(key)) throw new LensApiError(400, 'Send the lens key (its manifest id).');
  const rows = await rpc<VersionRow[]>('open_media_feed_lens_history', { p_key: key });
  return { key, data: (rows ?? []).flatMap((row) => versionView(key, row)), note: 'Newest first. changedBy is app (the person in Open Media) or agent. At most 50 versions are kept.' };
}

export async function revertMyLens(rpc: PersonRpc, origin: string, key: unknown, version: unknown) {
  if (typeof key !== 'string' || !lensKey.test(key)) throw new LensApiError(400, 'Send the lens key (its manifest id).');
  const number = Number(version);
  if (!Number.isInteger(number) || number < 1) throw new LensApiError(400, 'Send the version number from get_my_feed_lens_history.');
  const row = await rpc<LensRow>('open_media_revert_feed_lens', { p_key: key, p_version: number, p_changed_by: 'agent' });
  const lens = lensFromRow(row);
  if (!lens) throw new LensApiError(400, 'That version no longer validates, so it can’t be used.');
  return { ...lensView(lens, origin, row), restored: number, note: `Version ${number} is now version ${row.version}. Going back is itself in the history.` };
}

/** How a shared lens changed while it was shared, for anyone auditing it. */
export async function publicLensHistory(env: PublicApiEnv, id: string) {
  if (builtInLenses.some((lens) => lens.id === id)) return { id, data: [], note: 'Built-in lenses change only with an Open Media release; see /docs/feed-lenses.' };
  const { row } = await findLens(env, id);
  const rows = await callRpc<VersionRow[]>(env, fetch, 'open_media_public_feed_lens_history', { p_id: id });
  return { id, name: row?.name, data: (Array.isArray(rows) ? rows : []).flatMap((item) => versionView(row?.key ?? id, item)), note: 'Versions made while the lens was shared, newest first. Copies people installed don’t change when the author changes the original.' };
}

export async function installLens(env: PublicApiEnv, rpc: PersonRpc, origin: string, id: unknown) {
  if (typeof id !== 'string' || !uuid.test(id)) throw new LensApiError(400, 'Send the id of a shared lens.');
  const { lens } = await findLens(env, id);
  return saveLens(rpc, origin, { lens: { ...lens, author: undefined }, forkedFrom: id });
}

export async function deleteLens(rpc: PersonRpc, key: unknown) {
  if (typeof key !== 'string' || !lensKey.test(key)) throw new LensApiError(400, 'Send the lens key (its manifest id).');
  return rpc<{ deleted: boolean }>('open_media_delete_feed_lens', { p_key: key });
}

/** The manifest format, for agents writing a lens by hand. */
export function lensFormatDescription(origin: string) {
  return {
    format: lensFormatV2,
    docs: `${origin}/docs/feed-lenses`,
    fields: {
      name: 'Up to 40 characters.',
      description: 'Up to 280 characters.',
      permissions: `Viewer data the lens may read: ${lensPermissions.join(', ')}. Anything else cannot be read by any lens.`,
      'filters.sources / hideSources': lensSources.join(', '),
      'filters.kinds / hideKinds': lensKinds.join(', '),
      'filters.about / mute': 'Up to 20 words or hashtags, matched as whole words.',
      'filters.muteAuthors': 'Up to 20 handles.',
      'filters.followedOnly': 'true keeps only people the viewer follows on Open Media (needs follows).',
      'filters.maxAgeHours': '1 to 2160.',
      order: 'newest (chronological) or ranked.',
      objectives: 'recency, follows, interests, engagement, discovery (each 0–1, normalized) and diversity (0–1, spreads authors out). follows and discovery (lifts authors the viewer does not follow yet) need the follows permission, interests needs interests, engagement needs public_engagement.',
      interests: 'Up to 20 topics the lens lifts.',
      boosts: `Format 2. Up to 24 of { source | kind | topic | author, weight }: weight −1 to 1 leans a ranked lens away from or toward it, multiplying a matching post's score by 1 + weight/2. All of a post's boosts together stay between ×${boostLimits.min} and ×${boostLimits.max}. Boosts read only the post.`,
      version: 'Assigned by the person’s account on each change; history and revert are on /me/mcp.',
    },
    formats: [lensFormat, lensFormatV2],
    tuning: 'Change a lens in plain words with draft_feed_lens (base + request, nothing saved) or tune_feed_lens (the person’s account): “less hive”, “a lot more videos”, “more about design”, “a bit less from @bot”, “more new voices”, “mute crypto”, “show hive again”, “chronological”. Tuning relevant, raw or work makes the person’s own copy (“My Relevant”).',
    neverReadable: [...forbiddenSignals],
  };
}

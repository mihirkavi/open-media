/**
 * Feed lenses for agents and programs (ADR 0017). The manifests, validator and runner are the app's
 * own (src/domain/feedLenses.ts), so an agent previewing a lens sees exactly what the person's Feed
 * will show. Shared lenses come from the database through two public functions; saving goes through
 * the person's own token, and every manifest is validated here before it is stored.
 */
import {
  builtInLenses, describeLensRules, FeedLens, forbiddenSignals, lensFormat, lensFromRequest, LensError, lensKinds, lensPermissions, lensShareUrl, lensSources, lensSummary, parseLens,
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
    const lens = parseLens({ ...(row.manifest as Record<string, unknown>), id: row.key, builtIn: false });
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
    note: 'Raw and Relevant are built in. Shared lenses were written by people and are run by Open Media’s own runner over public posts; none can read private data.',
  };
}

/** A lens by id: raw, relevant, or a shared lens's id. */
export async function findLens(env: PublicApiEnv, id: string): Promise<{ lens: FeedLens; row?: LensRow }> {
  const builtIn = builtInLenses.find((lens) => lens.id === id);
  if (builtIn) return { lens: builtIn };
  if (!uuid.test(id)) throw new LensApiError(404, 'No lens with that id. Use raw, relevant, or the id of a shared lens from GET /v1/lenses.');
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
  if (lens.builtIn) throw new LensApiError(400, 'Raw and Relevant are built in. Save a copy with another id instead.');
  const forkedFrom = typeof input.forkedFrom === 'string' && uuid.test(input.forkedFrom) ? input.forkedFrom : null;
  const { builtIn: _builtIn, author: _author, ...manifest } = lens;
  const row = await rpc<LensRow>('open_media_save_feed_lens', { p_key: lens.id, p_name: lens.name, p_manifest: manifest, p_visibility: visibility, p_forked_from: forkedFrom });
  return { ...lensView(lens, origin, row), saved: true, note: visibility === 'public' ? 'Shared publicly: anyone can read, install and fork it at shareUrl.' : 'Saved to the person’s account. It shows up in their Feed’s lens picker on every device.' };
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
    format: lensFormat,
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
      objectives: 'recency, follows, interests, engagement (each 0–1, normalized) and diversity (0–1, spreads authors out). follows needs the follows permission, interests needs interests, engagement needs public_engagement.',
      interests: 'Up to 20 topics the lens lifts.',
    },
    neverReadable: [...forbiddenSignals],
  };
}

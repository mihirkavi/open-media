import { getSupabaseClient } from '../auth/supabase';
import { FeedLens, parseLens } from '../domain/feedLenses';

/** A lens as the database keeps it (ADR 0017). Manifests are validated again whenever they are read. */
interface LensRow {
  id: string;
  key: string;
  name: string;
  manifest: unknown;
  visibility: 'private' | 'public';
  forkedFrom: string | null;
  installs?: number;
  author?: { handle: string; displayName: string } | null;
}

export interface StoredLens { lens: FeedLens; rowId: string; visibility: 'private' | 'public'; installs: number }

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Open Media is not connected.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function fromRow(row: LensRow): StoredLens | undefined {
  try {
    const lens = parseLens({ ...(row.manifest as Record<string, unknown>), id: row.key, builtIn: false });
    return { lens: row.author?.handle ? { ...lens, author: `@${row.author.handle}` } : lens, rowId: row.id, visibility: row.visibility, installs: row.installs ?? 0 };
  } catch { return undefined; }
}

/** The signed-in person's lenses, newest first; ones that no longer validate are left out. */
export async function loadMyLenses(): Promise<StoredLens[]> {
  const rows = await rpc<LensRow[]>('open_media_my_feed_lenses', {});
  return (rows ?? []).flatMap((row) => fromRow(row) ?? []);
}

export async function saveMyLens(lens: FeedLens, visibility: 'private' | 'public' = 'private', forkedFrom?: string): Promise<StoredLens> {
  const { builtIn: _builtIn, author: _author, ...manifest } = lens;
  const row = await rpc<LensRow>('open_media_save_feed_lens', { p_key: lens.id, p_name: lens.name, p_manifest: manifest, p_visibility: visibility, p_forked_from: forkedFrom ?? null });
  return fromRow(row) ?? { lens, rowId: row.id, visibility, installs: 0 };
}

export async function deleteMyLens(key: string): Promise<void> {
  await rpc('open_media_delete_feed_lens', { p_key: key });
}

/** A publicly shared lens by id; anyone can read these without an account. */
export async function loadSharedLens(id: string): Promise<StoredLens | undefined> {
  const row = await rpc<LensRow | null>('open_media_public_feed_lens', { p_id: id });
  return row ? fromRow(row) : undefined;
}

/** Shared lenses whose name or rules mention the words, for Search. */
export async function searchSharedLenses(query: string): Promise<StoredLens[]> {
  const rows = await rpc<LensRow[]>('open_media_public_feed_lenses', { p_query: query.slice(0, 80), p_limit: 5 });
  return (rows ?? []).flatMap((row) => fromRow(row) ?? []);
}

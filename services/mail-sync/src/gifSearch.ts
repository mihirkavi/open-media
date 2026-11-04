/**
 * GIF search for the message media picker (ADR 0029), through GIPHY. The API key is a Worker
 * secret (GIPHY_API_KEY), so it never ships in the app. The app gets GIF ids only and builds the
 * media.giphy.com URLs itself (src/domain/messageMedia.ts), so this route returns nothing it
 * could be tricked into loading from elsewhere. No account data is sent to GIPHY: only the words
 * typed into the GIF search, from this server's address.
 */
import { UserFacingError } from './errors.js';

export interface GifSearchEnv { GIPHY_API_KEY?: string }

export interface GifResult { id: string; title: string; width: number; height: number }

const giphyId = /^[A-Za-z0-9]{4,40}$/;
const pageSize = 30;

interface GiphyImage { width?: string; height?: string }
interface GiphyGif { id?: string; title?: string; images?: { fixed_width?: GiphyImage } }

export function parseGifQuery(url: URL): { query: string; offset: number; kind: 'gifs' | 'stickers' } {
  const query = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
  if (query.length > 60) throw new UserFacingError('Search for GIFs with 60 characters or fewer.');
  const offset = Math.min(Math.max(Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), 450);
  return { query, offset, kind: url.searchParams.get('kind') === 'stickers' ? 'stickers' : 'gifs' };
}

/** Trending with no words, a search with them; GIFs or GIPHY's transparent animated stickers. */
export async function searchGifs(env: GifSearchEnv, query: string, offset = 0, kind: 'gifs' | 'stickers' = 'gifs', fetcher: typeof fetch = fetch): Promise<GifResult[]> {
  if (!env.GIPHY_API_KEY) throw new Error('GIF search isn’t set up on this server.');
  const params = new URLSearchParams({ api_key: env.GIPHY_API_KEY, limit: String(pageSize), offset: String(offset), rating: 'pg-13' });
  if (query) params.set('q', query);
  if (kind === 'gifs') params.set('bundle', 'messaging_non_clips');
  const response = await fetcher(`https://api.giphy.com/v1/${kind === 'stickers' ? 'stickers' : 'gifs'}/${query ? 'search' : 'trending'}?${params}`);
  if (!response.ok) throw new Error(`GIPHY answered ${response.status}.`);
  const body = await response.json() as { data?: GiphyGif[] };
  return (body.data ?? []).flatMap((gif) => {
    const size = gif.images?.fixed_width;
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (!gif.id || !giphyId.test(gif.id) || !(width > 0) || !(height > 0)) return [];
    return [{ id: gif.id, title: String(gif.title ?? '').replace(/\s+GIF(\s+by\s+.*)?$/i, '').slice(0, 120), width, height }];
  });
}

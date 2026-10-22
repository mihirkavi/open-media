import {
  DesoPostRecord, FarcasterSearchCast, HivePostRecord, LensPostRecord, livepeerPlaybackId, minimumLensAccountScore, NetworkId,
  socialPostFromDeso, socialPostFromFarcasterSearch, socialPostFromHive, socialPostFromLens, threeSpeakVideoId,
} from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { hiveTagFor, ParsedSearch, postMatchesSearch } from '../domain/searchQuery';
import { desoEndpoint, hiveEndpoint, lensEndpoint, lensPostsQuery, requestJSON, resolveLivepeer, resolveThreeSpeak } from './networkFeeds';

/**
 * Public post search on each network, read-only and keyless, with the same published filters as
 * Feed. Each network searches differently, and `method` says how, so results are never presented
 * as more complete than they are.
 */
export interface NetworkSearch {
  id: NetworkId;
  /** Shown next to the results, e.g. “by tag #ethereum”. */
  method(search: ParsedSearch): string;
  search(search: ParsedSearch): Promise<SocialPost[]>;
}

const lensSearchTimeoutMs = 35_000;

function withSelection(posts: SocialPost[], selection: string): SocialPost[] {
  return posts.map((post) => ({ ...post, eligibility: post.eligibility ? { ...post.eligibility, selection } : undefined }));
}

const farcaster: NetworkSearch = {
  id: 'farcaster',
  method: () => 'Farcaster search',
  async search(search) {
    const result = await requestJSON<{ result?: { casts?: FarcasterSearchCast[] } }>(`https://api.farcaster.xyz/v2/search-casts?q=${encodeURIComponent(search.text)}&limit=25`);
    return (result.result?.casts ?? []).map((cast) => socialPostFromFarcasterSearch(cast, search.text)).filter((post): post is SocialPost => Boolean(post));
  },
};

const lens: NetworkSearch = {
  id: 'lens',
  method: () => 'Lens search',
  async search(search) {
    const filter = { searchQuery: search.text, postTypes: ['ROOT'], accountScore: { atLeast: minimumLensAccountScore }, ...(search.media === 'video' ? { metadata: { mainContentFocus: ['SHORT_VIDEO', 'VIDEO'] } } : {}) };
    const result = await requestJSON<{ data?: { posts: { items: LensPostRecord[] } } }>(lensEndpoint, { method: 'POST', body: JSON.stringify({ query: lensPostsQuery, variables: { request: { pageSize: 'FIFTY', filter } } }) }, lensSearchTimeoutMs);
    const posts = (result.data?.posts.items ?? []).map(socialPostFromLens).filter((post): post is SocialPost => Boolean(post));
    return withSelection(posts, `Matches “${search.text}” in Lens’s public search`);
  },
};

const hive: NetworkSearch = {
  id: 'hive',
  method: (search) => { const tag = hiveTagFor(search); return tag ? `posts tagged #${tag}` : 'no tag to search'; },
  async search(search) {
    const tag = hiveTagFor(search);
    if (!tag) return [];
    const result = await requestJSON<{ result?: HivePostRecord[] }>(hiveEndpoint, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'bridge.get_ranked_posts', params: { sort: 'created', tag, limit: 20 }, id: 1 }) });
    const records = result.result ?? [];
    const videos = await resolveThreeSpeak(records.map(threeSpeakVideoId).filter((id): id is string => Boolean(id)));
    const posts = records.map((record) => socialPostFromHive(record, videos)).filter((post): post is SocialPost => Boolean(post));
    return withSelection(posts, `Tagged #${tag} on Hive (Hive searches by tag)`);
  },
};

const deso: NetworkSearch = {
  id: 'deso',
  method: () => 'newest 100 posts only; DeSo has no public search',
  async search(search) {
    const result = await requestJSON<{ PostsFound?: DesoPostRecord[] }>(`${desoEndpoint}/get-posts-stateless`, { method: 'POST', body: JSON.stringify({ NumToFetch: 100, ...(search.media ? { MediaRequired: true } : {}) }) });
    const records = result.PostsFound ?? [];
    const videos = await resolveLivepeer(records.flatMap((record) => (record.VideoURLs ?? []).slice(0, 1).map(livepeerPlaybackId)).filter((id): id is string => Boolean(id)));
    const posts = records.map((record) => socialPostFromDeso(record, videos)).filter((post): post is SocialPost => Boolean(post));
    return withSelection(posts.filter((post) => postMatchesSearch(post, { ...search, sinceMs: undefined })), `Matches “${search.text}” among DeSo’s newest posts (DeSo has no public search)`);
  },
};

export const networkSearches: NetworkSearch[] = [farcaster, lens, hive, deso];

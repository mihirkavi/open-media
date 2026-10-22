import {
  collapseRepeatedPosts, DesoPostRecord, livepeerPlaybackId, ResolvedVideo, threeSpeakVideoId, FarcasterCastMessage, FarcasterChannel, FarcasterProfile, farcasterProfileFromUserData, HivePostRecord,
  LensPostRecord, minimumLensAccountScore, NetworkId, networks, socialPostFromDeso, socialPostFromFarcaster, socialPostFromHive,
  socialPostFromLens,
} from '../domain/networkPosts';
import { clipPosts, SocialPost } from '../domain/posts';
import { CommunicationConnector, ConnectorDescriptor } from './types';

/**
 * Read-only clients for the public, keyless APIs of four blockchain-based social networks. They run
 * in the app (all four allow cross-origin reads), send no account data, and never sign anything.
 * Publishing would need a wallet or network signer per person, so it stays unavailable.
 */
export interface NetworkFeedPage { posts: SocialPost[]; cursor?: string }

/** Feed reads every kind of post; Clips reads short videos only. */
export type FeedKind = 'feed' | 'clips';

const requestTimeoutMs = 12_000;
const pageSize = 10;

export const farcasterChannels: FarcasterChannel[] = [
  { id: 'farcaster', parentUrl: 'chain://eip155:7777777/erc721:0x4f86113fc3e9783cf3ec9a552cbb566716a57628' },
  { id: 'ethereum', parentUrl: 'https://ethereum.org' },
  { id: 'dev', parentUrl: 'chain://eip155:1/erc721:0x7dd4e31f1530ac682c8ea4d8016e95773e08d8b0' },
  { id: 'design', parentUrl: 'chain://eip155:7777777/erc721:0x22be981fb87effbe6780b34a6fe1dfc14a00ec8e' },
];

/** Public Snapchain nodes, tried in order. */
const snapchainNodes = ['https://crackle.farcaster.xyz:3381', 'https://haatz.quilibrium.com'];
export const lensEndpoint = 'https://api.lens.xyz/graphql';
export const hiveEndpoint = 'https://api.hive.blog';
export const desoEndpoint = 'https://node.deso.org/api/v0';

export async function requestJSON<T>(url: string, init?: RequestInit, timeoutMs = requestTimeoutMs): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Farcaster ----------

const farcasterProfiles = new Map<number, Promise<FarcasterProfile>>();

async function snapchain<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (const node of snapchainNodes) {
    try { return await requestJSON<T>(`${node}${path}`); } catch (error) { lastError = error; }
  }
  throw lastError;
}

function farcasterProfile(fid: number) {
  let profile = farcasterProfiles.get(fid);
  if (!profile) {
    profile = snapchain<{ messages?: Parameters<typeof farcasterProfileFromUserData>[1] }>(`/v1/userDataByFid?fid=${fid}`)
      .then((result) => farcasterProfileFromUserData(fid, result.messages ?? []))
      .catch(() => { farcasterProfiles.delete(fid); return { fid }; });
    farcasterProfiles.set(fid, profile);
  }
  return profile;
}

/** Cursor: per-channel Snapchain page tokens; a channel missing from it has no more casts. */
export async function fetchFarcasterFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const tokens: Record<string, string> | undefined = cursor ? JSON.parse(cursor) : undefined;
  const channels = farcasterChannels.filter((channel) => !tokens || tokens[channel.id]);
  // Snapchain returns up to `pageSize` casts from each of its shards (two today), and some are filtered out.
  const perChannel = kind === 'clips' ? 25 : Math.ceil(pageSize / (channels.length * 2)) + 1;
  const pages = await Promise.all(channels.map(async (channel) => {
    const query = new URLSearchParams({ url: channel.parentUrl, pageSize: String(perChannel), reverse: 'true' });
    if (tokens?.[channel.id]) query.set('pageToken', tokens[channel.id]);
    const page = await snapchain<{ messages?: FarcasterCastMessage[]; nextPageToken?: string }>(`/v1/castsByParent?${query}`);
    return { channel, messages: page.messages ?? [], next: page.nextPageToken };
  }));
  const profiles = new Map<number, FarcasterProfile>();
  // Clips only need authors of casts with a video, so skip the other profile lookups.
  const hasVideo = (message: FarcasterCastMessage) => (message.data.castAddBody?.embeds ?? []).some((embed) => /\.m3u8(\?|$)|stream\.farcaster\.xyz\/v1\/video\//.test(embed.url ?? ''));
  const fids = [...new Set(pages.flatMap((page) => page.messages.filter((message) => kind === 'feed' || hasVideo(message)).map((message) => message.data.fid)))];
  await Promise.all(fids.map(async (fid) => profiles.set(fid, await farcasterProfile(fid))));
  const all = collapseRepeatedPosts(pages.flatMap(({ channel, messages }) => messages.map((message) => socialPostFromFarcaster(message, profiles.get(message.data.fid), channel))).filter((post): post is SocialPost => Boolean(post)));
  const posts = kind === 'clips' ? clipPosts(all) : all;
  const next = Object.fromEntries(pages.filter((page) => page.next).map((page) => [page.channel.id, page.next!]));
  return { posts, cursor: Object.keys(next).length ? JSON.stringify(next) : undefined };
}

// ---------- Lens ----------

export const lensPostsQuery = `query OpenMediaLensPosts($request: PostsRequest!) {
  posts(request: $request) {
    items { __typename ... on Post {
      id slug timestamp
      author { address score username { localName } metadata { name picture } }
      stats { comments reposts quotes reactions }
      metadata { __typename
        ... on TextOnlyMetadata { content contentWarning }
        ... on ImageMetadata { content contentWarning image { item altTag } }
        ... on ArticleMetadata { title content contentWarning }
        ... on LinkMetadata { content contentWarning sharingLink }
        ... on VideoMetadata { content contentWarning video { item cover duration altTag } }
      }
    } }
    pageInfo { next }
  }
}`;

export async function fetchLensFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const filter = { postTypes: ['ROOT'], accountScore: { atLeast: minimumLensAccountScore }, ...(kind === 'clips' ? { metadata: { mainContentFocus: ['SHORT_VIDEO', 'VIDEO'] } } : {}) };
  const request = { pageSize: 'TEN', cursor: cursor ?? null, filter };
  const result = await requestJSON<{ data?: { posts: { items: LensPostRecord[]; pageInfo: { next?: string | null } } }; errors?: { message: string }[] }>(lensEndpoint, { method: 'POST', body: JSON.stringify({ query: lensPostsQuery, variables: { request } }) });
  if (!result.data) throw new Error(result.errors?.[0]?.message ?? 'Lens returned no data.');
  return {
    posts: forKind(result.data.posts.items.map(socialPostFromLens).filter((post): post is SocialPost => Boolean(post)), kind),
    cursor: result.data.posts.pageInfo.next ?? undefined,
  };
}

// ---------- Hive ----------

/** Cursor: `author/permlink` of the last post read. */
export async function fetchHiveFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const [startAuthor, startPermlink] = cursor ? cursor.split('/') : [];
  // Clips read 3Speak, Hive's video community, where nearly every post is a video.
  const params = { sort: 'created', tag: kind === 'clips' ? threeSpeakCommunity : '', limit: kind === 'clips' ? 20 : pageSize, ...(startAuthor && startPermlink ? { start_author: startAuthor, start_permlink: startPermlink } : {}) };
  const result = await requestJSON<{ result?: HivePostRecord[]; error?: { message: string } }>(hiveEndpoint, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'bridge.get_ranked_posts', params, id: 1 }) });
  if (!result.result) throw new Error(result.error?.message ?? 'Hive returned no posts.');
  const records = result.result.filter((record) => !(record.author === startAuthor && record.permlink === startPermlink));
  const last = records[records.length - 1];
  const videos = await resolveThreeSpeak(records.map(threeSpeakVideoId).filter((id): id is string => Boolean(id)));
  return {
    posts: forKind(records.map((record) => socialPostFromHive(record, videos)).filter((post): post is SocialPost => Boolean(post)), kind),
    cursor: records.length && last ? `${last.author}/${last.permlink}` : undefined,
  };
}

// ---------- DeSo ----------

/** Cursor: hash of the last post read. */
export async function fetchDesoFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const body = kind === 'clips' ? { NumToFetch: 50, PostHashHex: cursor ?? '', MediaRequired: true } : { NumToFetch: pageSize, PostHashHex: cursor ?? '' };
  const result = await requestJSON<{ PostsFound?: DesoPostRecord[] }>(`${desoEndpoint}/get-posts-stateless`, { method: 'POST', body: JSON.stringify(body) });
  const records = (result.PostsFound ?? []).filter((record) => record.PostHashHex !== cursor);
  const last = records[records.length - 1];
  const playbackIds = records.flatMap((record) => (record.VideoURLs ?? []).slice(0, 1).map(livepeerPlaybackId)).filter((id): id is string => Boolean(id));
  const videos = await resolveLivepeer(playbackIds);
  return {
    posts: forKind(records.map((record) => socialPostFromDeso(record, videos)).filter((post): post is SocialPost => Boolean(post)), kind),
    cursor: records.length && last ? last.PostHashHex : undefined,
  };
}

// ---------- video lookups ----------

const threeSpeakCommunity = 'hive-181335';
const resolvedVideos = new Map<string, Promise<ResolvedVideo | undefined>>();

function cached(key: string, load: () => Promise<ResolvedVideo | undefined>) {
  let video = resolvedVideos.get(key);
  if (!video) {
    video = load().catch(() => undefined);
    resolvedVideos.set(key, video);
  }
  return video;
}

async function resolveAll(ids: string[], resolve: (id: string) => Promise<ResolvedVideo | undefined>): Promise<Map<string, ResolvedVideo>> {
  const entries = await Promise.all([...new Set(ids)].map(async (id) => [id, await resolve(id)] as const));
  return new Map(entries.filter((entry): entry is readonly [string, ResolvedVideo] => Boolean(entry[1])));
}

/** DeSo videos are hosted on Livepeer; its public playback API lists the playable files. */
export function resolveLivepeer(ids: string[]) {
  return resolveAll(ids, (id) => cached(`livepeer:${id}`, async () => {
    const info = await requestJSON<{ meta?: { source?: { type?: string; url?: string; width?: number; height?: number }[] } }>(`https://livepeer.studio/api/playback/${encodeURIComponent(id)}`);
    const sources = info.meta?.source ?? [];
    const mp4 = sources.filter((source) => source.type === 'html5/video/mp4' && source.url).sort((a, b) => Math.abs((a.height ?? 0) - 720) - Math.abs((b.height ?? 0) - 720))[0];
    const hls = sources.find((source) => source.type === 'html5/application/vnd.apple.mpegurl' && source.url);
    const chosen = mp4 ?? hls;
    if (!chosen?.url?.startsWith('https://')) return undefined;
    return { url: chosen.url, streaming: chosen === mp4 ? 'progressive' : 'hls', aspectRatio: chosen.width && chosen.height ? chosen.width / chosen.height : undefined };
  }));
}

/** Hive videos are hosted by 3Speak; its embed API (the one its own player uses) returns the stream. */
export function resolveThreeSpeak(ids: string[]) {
  return resolveAll(ids, (id) => cached(`3speak:${id}`, async () => {
    const info = await requestJSON<{ success?: boolean; videoUrl?: string; thumbnail?: string; duration?: number; isPlaceholder?: boolean }>(`https://play.3speak.tv/api/embed?v=${encodeURIComponent(id)}`);
    if (!info.success || info.isPlaceholder || !info.videoUrl?.startsWith('https://')) return undefined;
    return { url: info.videoUrl, streaming: 'hls', posterUrl: info.thumbnail?.startsWith('https://') ? info.thumbnail : undefined, durationSeconds: typeof info.duration === 'number' ? info.duration : undefined };
  }));
}

function forKind(posts: SocialPost[], kind: FeedKind) {
  return kind === 'clips' ? clipPosts(posts) : posts;
}

// ---------- connectors ----------

const fetchers: Record<NetworkId, (cursor?: string, kind?: FeedKind) => Promise<NetworkFeedPage>> = {
  farcaster: fetchFarcasterFeed, lens: fetchLensFeed, hive: fetchHiveFeed, deso: fetchDesoFeed,
};

export function networkDescriptor(id: NetworkId): ConnectorDescriptor {
  return {
    id, displayName: networks[id].displayName, kind: 'protocol', authentication: 'none', status: 'available',
    capabilities: [
      { operation: 'read-feed', available: true },
      { operation: 'publish-post', available: false, reason: `Publishing needs your own ${networks[id].displayName} account signer; Open Media only reads public posts today.` },
      { operation: 'read-messages', available: false, reason: 'Only public posts are read.' },
    ],
  };
}

export const networkConnectors: (CommunicationConnector & { id: NetworkId; fetchClips(cursor?: string): Promise<NetworkFeedPage> })[] = (Object.keys(fetchers) as NetworkId[]).map((id) => ({
  id,
  descriptor: () => networkDescriptor(id),
  fetchFeed: (cursor?: string) => fetchers[id](cursor, 'feed'),
  fetchClips: (cursor?: string) => fetchers[id](cursor, 'clips'),
}));

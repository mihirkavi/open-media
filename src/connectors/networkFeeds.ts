import {
  collapseRepeatedPosts, DesoPostRecord, livepeerPlaybackId, ResolvedVideo, threeSpeakVideoId, FarcasterCastMessage, FarcasterChannel, FarcasterProfile, farcasterProfileFromUserData, HivePostRecord,
  LensPostRecord, minimumLensAccountScore, NetworkId, networks, socialPostFromDeso, socialPostFromFarcaster, socialPostFromHive,
  socialPostFromLens, quotedPostFromFarcaster,
} from '../domain/networkPosts';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { mentionedFids, quotedCast } from '../domain/farcasterCasts';
import { clipPosts, QuotedPost, SocialPost } from '../domain/posts';
import { fetchBlueskyFeed, fetchMastodonFeed, fetchNostrFeed } from './openNetworkFeeds';
import { CommunicationConnector, ConnectorDescriptor } from './types';

/**
 * Read-only clients for the public, keyless APIs of the open social networks (four blockchain-based,
 * plus Bluesky, Mastodon and Nostr in `openNetworkFeeds.ts`). They run in the app (all allow
 * cross-origin reads), send no account data, and never sign anything. Publishing lives in
 * `publishing/`, through each person's own delegated key.
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

export async function snapchain<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (const node of snapchainNodes) {
    try { return await requestJSON<T>(`${node}${path}`); } catch (error) { lastError = error; }
  }
  throw lastError;
}

export function farcasterProfile(fid: number) {
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
/**
 * The casts a page of casts quotes (ADR 0039), read by id from a public Snapchain node, at most 20
 * per page. A quoted cast that was deleted or can't be read is left out; its quote cast still shows.
 */
export async function farcasterQuotes(messages: FarcasterCastMessage[]): Promise<Map<string, QuotedPost>> {
  const wanted = [...new Map(messages.map((message) => quotedCast(message.data.castAddBody ?? {})).filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => [item.hash, item])).values()].slice(0, 20);
  if (!wanted.length) return new Map();
  const quoted = (await Promise.all(wanted.map((item) => snapchain<FarcasterCastMessage>(`/v1/castById?fid=${item.fid}&hash=${item.hash}`).catch(() => undefined)))).filter((item): item is FarcasterCastMessage => Boolean(item?.data));
  const fids = [...new Set([...quoted.map((item) => item.data.fid), ...mentionedFids(quoted.map((item) => item.data.castAddBody))])];
  const profiles = new Map((await Promise.all(fids.map((fid) => farcasterProfile(fid)))).map((profile) => [profile.fid, profile]));
  const usernames = farcasterUsernames(profiles);
  const out = new Map<string, QuotedPost>();
  for (const item of quoted) {
    const post = quotedPostFromFarcaster(item, profiles.get(item.data.fid), usernames);
    if (post) out.set(item.hash.toLowerCase(), post);
  }
  return out;
}

/** Usernames by account, for putting mentions back into cast text. */
export function farcasterUsernames(profiles: ReadonlyMap<number, FarcasterProfile>): Map<number, string | undefined> {
  return new Map([...profiles].map(([fid, profile]) => [fid, profile.username]));
}

/** The connected Farcaster account's number, kept apart from its key so reading never touches the key. */
export const farcasterAccountFidKey = 'open-media.network.farcaster.fid';
let followedChannels: { fid: number; at: number; channels: Promise<FarcasterChannel[]> } | undefined;

/**
 * The channels the Farcaster feed reads (ADR 0039): with a connected account, up to eight channels
 * that account follows, from Farcaster's public channel API; otherwise the four default channels.
 * The list is kept for 30 minutes.
 */
export async function farcasterFeedChannels(): Promise<FarcasterChannel[]> {
  const fid = Number(await AsyncStorage.getItem(farcasterAccountFidKey).catch(() => null));
  if (!Number.isSafeInteger(fid) || fid <= 0) return farcasterChannels;
  if (!followedChannels || followedChannels.fid !== fid || Date.now() - followedChannels.at > 30 * 60_000) {
    const channels = requestJSON<{ result?: { channels?: { id?: string; url?: string }[] } }>(`https://api.farcaster.xyz/v1/user-following-channels?fid=${fid}&limit=8`)
      .then((body) => (body.result?.channels ?? []).filter((item): item is { id: string; url: string } => typeof item.id === 'string' && /^[a-z0-9-]{1,32}$/.test(item.id) && typeof item.url === 'string' && item.url.length <= 256).slice(0, 8).map((item) => ({ id: item.id, parentUrl: item.url, followed: true })));
    followedChannels = { fid, at: Date.now(), channels };
  }
  const followed = await followedChannels.channels.catch(() => []);
  if (!followed.length) followedChannels = undefined;
  return followed.length ? followed : farcasterChannels;
}

export async function fetchFarcasterFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const tokens: Record<string, string> | undefined = cursor ? JSON.parse(cursor) : undefined;
  const channels = (await farcasterFeedChannels()).filter((channel) => !tokens || tokens[channel.id]);
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
  const shown = pages.flatMap((page) => page.messages.filter((message) => kind === 'feed' || hasVideo(message)));
  // Authors, and the people their casts mention, whose names go back into the text (ADR 0039).
  const fids = [...new Set([...shown.map((message) => message.data.fid), ...mentionedFids(shown.map((message) => message.data.castAddBody))])];
  await Promise.all(fids.map(async (fid) => profiles.set(fid, await farcasterProfile(fid))));
  const usernames = farcasterUsernames(profiles);
  const quotes = await farcasterQuotes(shown).catch(() => new Map<string, QuotedPost>());
  const all = collapseRepeatedPosts(pages.flatMap(({ channel, messages }) => messages.map((message) => socialPostFromFarcaster(message, profiles.get(message.data.fid), channel, usernames, quotes))).filter((post): post is SocialPost => Boolean(post)));
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
  bluesky: fetchBlueskyFeed, mastodon: fetchMastodonFeed, nostr: fetchNostrFeed,
};

export function networkDescriptor(id: NetworkId): ConnectorDescriptor {
  return {
    id, displayName: networks[id].displayName, kind: 'protocol', authentication: 'none', status: 'available',
    capabilities: [
      { operation: 'read-feed', available: true },
      { operation: 'publish-post', available: true, reason: `Connect your ${networks[id].displayName} account in Settings → Cross-posting.` },
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

/**
 * How many accounts follow a Farcaster account, and how many it follows (ADR 0039), counted from
 * its follow links on a public Snapchain node, a page at a time up to 5,000. Beyond that the count
 * reads "5,000+".
 */
export async function farcasterFollowCounts(fid: number): Promise<{ followers: number; following: number; moreFollowers: boolean; moreFollowing: boolean }> {
  const count = async (path: string) => {
    let total = 0;
    let token: string | undefined;
    do {
      const page = await snapchain<{ messages?: unknown[]; nextPageToken?: string }>(`${path}&pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      total += page.messages?.length ?? 0;
      token = page.nextPageToken || undefined;
    } while (token && total < followCountCap);
    return token ? { total: followCountCap, more: true } : { total, more: false };
  };
  const [followers, following] = await Promise.all([
    count(`/v1/linksByTargetFid?target_fid=${fid}&link_type=follow`),
    count(`/v1/linksByFid?fid=${fid}&link_type=follow`),
  ]);
  return { followers: followers.total, following: following.total, moreFollowers: followers.more, moreFollowing: following.more };
}

const followCountCap = 5000;

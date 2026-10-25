import { PostMedia, SocialPost } from './posts';
import { initialsFor } from './publicPosts';

/**
 * Public posts from decentralized, blockchain-based social networks, normalized into the canonical
 * `SocialPost`. Everything here is pure: the network clients live in `src/connectors/networkFeeds.ts`.
 *
 * Open Media reads each network's newest public posts (never a network's engagement ranking), then
 * applies the small published filters below. Filtering only hides a post from this doorway; the post
 * stays on its network. Each post carries its selection and filters so “Why this?” can show them.
 */
export type NetworkId = 'farcaster' | 'lens' | 'hive' | 'deso';

export interface NetworkInfo {
  id: NetworkId;
  displayName: string;
  /** Plain-language description of what the network is and where its data lives. */
  about: string;
  /** Published eligibility filters, in the words shown to people. */
  filters: string[];
}

export const minimumLensAccountScore = 5000;

export const networks: Record<NetworkId, NetworkInfo> = {
  farcaster: {
    id: 'farcaster', displayName: 'Farcaster',
    about: 'Accounts are registered on Optimism (Ethereum); casts are stored on the Snapchain network.',
    filters: ['Accounts without a Farcaster username or profile photo are hidden (common for spam accounts)', 'Replies and empty casts are hidden'],
  },
  lens: {
    id: 'lens', displayName: 'Lens',
    about: 'Accounts and posts live on Lens Chain, an Ethereum layer 2.',
    filters: [`Accounts Lens scores below ${minimumLensAccountScore.toLocaleString('en-US')} of 10,000 are hidden (Lens’s published likely-human score)`, 'Posts the author marked with a content warning are hidden', 'Replies and reposts are hidden'],
  },
  hive: {
    id: 'hive', displayName: 'Hive',
    about: 'Accounts and posts are stored directly on the Hive blockchain.',
    filters: ['Posts Hive’s own community downvotes have hidden or grayed out are hidden', 'Posts tagged NSFW are hidden'],
  },
  deso: {
    id: 'deso', displayName: 'DeSo',
    about: 'Accounts and posts are stored directly on the DeSo blockchain.',
    filters: ['Posts hidden by their author or by DeSo are hidden', 'Accounts without a DeSo username are hidden', 'Replies and reposts without text are hidden'],
  },
};

const sourceNames: Record<string, string> = { 'open-media': 'Open Media', events: 'Events', ...Object.fromEntries(Object.values(networks).map((network) => [network.id, network.displayName])) };

/** Human name for a post's source connector, e.g. `farcaster` → `Farcaster`. */
export function sourceName(connectorId: string): string {
  return sourceNames[connectorId] ?? connectorId;
}

export const maxNetworkBodyLength = 1200;

/** A playable video, after any lookup a network needs (DeSo's Livepeer, Hive's 3Speak). */
export interface ResolvedVideo { url: string; streaming: 'hls' | 'progressive'; posterUrl?: string; durationSeconds?: number; aspectRatio?: number }

/** `lens://<hash>` content lives on Grove; https URLs pass through. */
export function lensMediaUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const lens = value.match(/^lens:\/\/([0-9a-f]{20,})$/i);
  return lens ? `https://api.grove.storage/${lens[1]}` : safeHttpsUrl(value);
}

export function videoStreaming(url: string): 'hls' | 'progressive' | undefined {
  if (/\.m3u8(\?|$)/i.test(url) || /^https:\/\/stream\.farcaster\.xyz\/v1\/video\//.test(url)) return 'hls';
  if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) return 'progressive';
  return undefined;
}

/** Livepeer playback ID from a DeSo video URL such as `https://lvpr.tv/?v=<id>`. */
export function livepeerPlaybackId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'lvpr.tv') return parsed.searchParams.get('v') ?? undefined;
    return parsed.pathname.match(/\/hls\/([a-z0-9]+)\//i)?.[1];
  } catch {
    return undefined;
  }
}

/** `author/permlink` of the 3Speak video attached to a Hive post, if any. */
export function threeSpeakVideoId(record: Pick<HivePostRecord, 'json_metadata'>): string | undefined {
  const video = (record.json_metadata as { video?: { info?: { author?: unknown; permlink?: unknown; platform?: unknown } } } | null | undefined)?.video;
  const author = video?.info?.author; const permlink = video?.info?.permlink;
  return typeof author === 'string' && typeof permlink === 'string' && /^[a-z0-9.-]+$/.test(author) && /^[a-z0-9-]+$/i.test(permlink) ? `${author}/${permlink}` : undefined;
}

// ---------- Farcaster (Snapchain HTTP API) ----------

export interface FarcasterCastMessage {
  hash: string;
  data: {
    type: string;
    fid: number;
    /** Seconds since the Farcaster epoch, 2021-01-01T00:00:00Z. */
    timestamp: number;
    castAddBody?: { text?: string; parentUrl?: string | null; parentCastId?: unknown; embeds?: { url?: string; castId?: unknown }[] };
  };
}

export interface FarcasterProfile { fid: number; username?: string; displayName?: string; pfpUrl?: string }

export interface FarcasterChannel { id: string; parentUrl: string }

const farcasterEpochMs = Date.UTC(2021, 0, 1);

export function farcasterTimestamp(seconds: number): string {
  return new Date(farcasterEpochMs + seconds * 1000).toISOString();
}

/** Collapses USER_DATA_ADD messages into one profile; later messages win. */
export function farcasterProfileFromUserData(fid: number, messages: { data?: { timestamp?: number; userDataBody?: { type?: string; value?: string } } }[]): FarcasterProfile {
  const profile: FarcasterProfile = { fid };
  const ordered = [...messages].sort((a, b) => (a.data?.timestamp ?? 0) - (b.data?.timestamp ?? 0));
  for (const message of ordered) {
    const { type, value } = message.data?.userDataBody ?? {};
    if (!value) continue;
    if (type === 'USER_DATA_TYPE_USERNAME') profile.username = value;
    else if (type === 'USER_DATA_TYPE_DISPLAY') profile.displayName = value;
    else if (type === 'USER_DATA_TYPE_PFP') profile.pfpUrl = value;
  }
  return profile;
}

export function socialPostFromFarcaster(message: FarcasterCastMessage, profile: FarcasterProfile | undefined, channel: FarcasterChannel): SocialPost | undefined {
  const body = message.data.castAddBody;
  if (message.data.type !== 'MESSAGE_TYPE_CAST_ADD' || !body || body.parentCastId) return undefined;
  const avatarUrl = safeHttpsUrl(profile?.pfpUrl);
  if (!profile?.username || !avatarUrl) return undefined;
  const urls = (body.embeds ?? []).map((embed) => safeHttpsUrl(embed.url)).filter((url): url is string => Boolean(url));
  const images = urls.filter(looksLikeImage);
  const videoUrl = urls.find((url) => videoStreaming(url));
  const links = urls.filter((url) => !images.includes(url) && url !== videoUrl && !(body.text ?? '').includes(url));
  const text = [body.text?.trim() ?? '', ...links].filter(Boolean).join('\n');
  if (!text && !images.length && !videoUrl) return undefined;
  return networkPost({
    network: 'farcaster',
    externalId: message.hash,
    canonicalURL: `https://farcaster.xyz/${encodeURIComponent(profile.username)}/${message.hash.slice(0, 10)}`,
    author: { id: `farcaster:${message.data.fid}`, displayName: profile.displayName || profile.username, handle: `@${profile.username}`, avatarUrl },
    body: text,
    createdAt: farcasterTimestamp(message.data.timestamp),
    images,
    video: videoUrl ? { url: videoUrl, streaming: videoStreaming(videoUrl)!, aspectRatio: 9 / 16 } : undefined,
    selection: `Newest public cast in the /${channel.id} channel on Farcaster`,
  });
}

/** A cast from Farcaster's public client search API (`/v2/search-casts`). */
export interface FarcasterSearchCast {
  hash: string;
  text?: string;
  timestamp: number;
  author: { fid: number; username?: string; displayName?: string; pfp?: { url?: string } };
  embeds?: { images?: { url?: string; alt?: string }[]; videos?: { url?: string; sourceUrl?: string }[]; urls?: { openGraph?: { url?: string } }[] };
  replies?: { count?: number };
  reactions?: { count?: number };
  combinedRecastCount?: number;
}

export function socialPostFromFarcasterSearch(cast: FarcasterSearchCast, query: string): SocialPost | undefined {
  const username = cast.author.username;
  const avatarUrl = safeHttpsUrl(cast.author.pfp?.url);
  if (!username || !avatarUrl || !cast.hash) return undefined;
  const images = (cast.embeds?.images ?? []).map((image) => safeHttpsUrl(image.url)).filter((url): url is string => Boolean(url));
  const videoUrl = (cast.embeds?.videos ?? []).map((video) => safeHttpsUrl(video.url ?? video.sourceUrl)).find((url): url is string => Boolean(url && videoStreaming(url)));
  const text = cast.text?.trim() ?? '';
  if (!text && !images.length && !videoUrl) return undefined;
  return networkPost({
    network: 'farcaster',
    externalId: cast.hash,
    canonicalURL: `https://farcaster.xyz/${encodeURIComponent(username)}/${cast.hash.slice(0, 10)}`,
    author: { id: `farcaster:${cast.author.fid}`, displayName: cast.author.displayName || username, handle: `@${username}`, avatarUrl },
    body: text,
    createdAt: new Date(cast.timestamp).toISOString(),
    images,
    imageAlt: cast.embeds?.images?.[0]?.alt,
    video: videoUrl ? { url: videoUrl, streaming: videoStreaming(videoUrl)!, aspectRatio: 9 / 16 } : undefined,
    engagement: { replies: cast.replies?.count ?? 0, reposts: cast.combinedRecastCount ?? 0, likes: cast.reactions?.count ?? 0 },
    selection: `Matches “${query}” in Farcaster’s public search`,
  });
}

// ---------- Lens (Lens API v3 GraphQL) ----------

export interface LensPostRecord {
  __typename?: string;
  id: string;
  slug: string;
  timestamp: string;
  author: { address: string; score?: number | null; username?: { localName: string } | null; metadata?: { name?: string | null; picture?: string | null } | null };
  stats?: { comments: number; reposts: number; quotes: number; reactions: number } | null;
  metadata?: { __typename?: string; title?: string | null; content?: string | null; contentWarning?: string | null; image?: { item?: string | null; altTag?: string | null } | null; sharingLink?: string | null; video?: { item?: string | null; cover?: string | null; duration?: number | null; altTag?: string | null } | null } | null;
}

export function socialPostFromLens(record: LensPostRecord): SocialPost | undefined {
  if (record.__typename && record.__typename !== 'Post') return undefined;
  const metadata = record.metadata;
  if (!metadata || metadata.contentWarning) return undefined;
  if ((record.author.score ?? 0) < minimumLensAccountScore) return undefined;
  const localName = record.author.username?.localName;
  const image = safeHttpsUrl(metadata.image?.item ?? undefined);
  const link = safeHttpsUrl(metadata.sharingLink ?? undefined);
  const content = metadata.content?.trim() ?? '';
  const text = link && !content.includes(link) ? [content, link].filter(Boolean).join('\n') : content;
  const videoUrl = lensMediaUrl(metadata.video?.item);
  const video: ResolvedVideo | undefined = videoUrl ? { url: videoUrl, streaming: videoStreaming(videoUrl) ?? 'progressive', posterUrl: lensMediaUrl(metadata.video?.cover), durationSeconds: metadata.video?.duration ?? undefined } : undefined;
  if (!text && !image && !video) return undefined;
  const handle = localName ? `@${localName}` : shortAddress(record.author.address);
  return networkPost({
    network: 'lens',
    externalId: record.id,
    canonicalURL: `https://hey.xyz/posts/${encodeURIComponent(record.slug)}`,
    author: { id: `lens:${record.author.address.toLowerCase()}`, displayName: record.author.metadata?.name?.trim() || localName || handle, handle, avatarUrl: safeHttpsUrl(record.author.metadata?.picture ?? undefined) },
    title: metadata.title?.trim() || undefined,
    body: text,
    createdAt: record.timestamp,
    images: image ? [image] : [],
    imageAlt: metadata.image?.altTag ?? metadata.video?.altTag ?? undefined,
    video,
    engagement: record.stats ? { replies: record.stats.comments, reposts: record.stats.reposts + record.stats.quotes, likes: record.stats.reactions } : undefined,
    selection: 'Newest public post on Lens',
  });
}

// ---------- Hive (bridge JSON-RPC API) ----------

export interface HivePostRecord {
  author: string;
  permlink: string;
  url: string;
  title: string;
  body: string;
  created: string;
  depth: number;
  children: number;
  reblogs?: number;
  stats?: { gray?: boolean; hide?: boolean; total_votes?: number };
  json_metadata?: { tags?: unknown; image?: unknown } | null;
  community_title?: string;
}

export function socialPostFromHive(record: HivePostRecord, videos?: Map<string, ResolvedVideo>): SocialPost | undefined {
  if (record.depth !== 0 || record.stats?.gray || record.stats?.hide) return undefined;
  const tags = Array.isArray(record.json_metadata?.tags) ? record.json_metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  if (tags.some((tag) => tag.toLowerCase() === 'nsfw')) return undefined;
  const firstImage = Array.isArray(record.json_metadata?.image) ? safeHttpsUrl(String(record.json_metadata.image[0] ?? '')) : undefined;
  const excerpt = plainTextExcerpt(record.body, 320);
  if (!record.title.trim() && !excerpt) return undefined;
  return networkPost({
    network: 'hive',
    externalId: `${record.author}/${record.permlink}`,
    canonicalURL: `https://peakd.com/@${encodeURIComponent(record.author)}/${encodeURIComponent(record.permlink)}`,
    author: { id: `hive:${record.author}`, displayName: record.author, handle: `@${record.author}`, avatarUrl: `https://images.hive.blog/u/${encodeURIComponent(record.author)}/avatar/small` },
    title: record.title.trim() || undefined,
    body: excerpt,
    createdAt: hiveTimestamp(record.created),
    images: firstImage ? [firstImage] : [],
    video: (() => { const id = threeSpeakVideoId(record); return id ? videos?.get(id) : undefined; })(),
    topics: tags.filter((tag) => !/^hive-\d+$/.test(tag)).slice(0, 5),
    engagement: { replies: record.children, reposts: record.reblogs ?? 0, likes: record.stats?.total_votes ?? 0 },
    selection: record.community_title ? `Newest public post on Hive, in ${record.community_title}` : 'Newest public post on Hive',
  });
}

/** Hive reports UTC without a zone suffix. */
export function hiveTimestamp(value: string): string {
  return /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
}

// ---------- DeSo (node API) ----------

export interface DesoPostRecord {
  PostHashHex: string;
  PosterPublicKeyBase58Check: string;
  ParentStakeID?: string;
  Body?: string;
  ImageURLs?: string[] | null;
  VideoURLs?: string[] | null;
  TimestampNanos: number;
  IsHidden?: boolean;
  RepostedPostEntryResponse?: unknown;
  CommentCount?: number;
  LikeCount?: number;
  RepostCount?: number;
  QuoteRepostCount?: number;
  ProfileEntryResponse?: { Username?: string; ExtraData?: Record<string, string> | null } | null;
}

export function socialPostFromDeso(record: DesoPostRecord, videos?: Map<string, ResolvedVideo>): SocialPost | undefined {
  if (record.IsHidden || record.ParentStakeID) return undefined;
  const username = record.ProfileEntryResponse?.Username;
  if (!username) return undefined;
  const body = record.Body?.trim() ?? '';
  const images = (record.ImageURLs ?? []).map((url) => safeHttpsUrl(url)).filter((url): url is string => Boolean(url));
  const video = desoVideo(record, videos);
  if (!body && !images.length && !video) return undefined;
  const key = record.PosterPublicKeyBase58Check;
  return networkPost({
    network: 'deso',
    externalId: record.PostHashHex,
    canonicalURL: `https://focus.xyz/post/${encodeURIComponent(record.PostHashHex)}`,
    author: { id: `deso:${key}`, displayName: record.ProfileEntryResponse?.ExtraData?.DisplayName?.trim() || username, handle: `@${username}`, avatarUrl: `https://node.deso.org/api/v0/get-single-profile-picture/${encodeURIComponent(key)}` },
    body,
    createdAt: new Date(Math.floor(record.TimestampNanos / 1e6)).toISOString(),
    images,
    video,
    engagement: { replies: record.CommentCount ?? 0, reposts: (record.RepostCount ?? 0) + (record.QuoteRepostCount ?? 0), likes: record.LikeCount ?? 0 },
    selection: 'Newest public post on DeSo',
  });
}

/**
 * The same account often casts identical text into several channels; keep only the newest copy.
 * This collapses duplicates rather than filtering anything out.
 */
export function collapseRepeatedPosts(posts: SocialPost[]): SocialPost[] {
  const seen = new Set<string>();
  return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).filter((post) => {
    const key = `${post.author.id}\n${post.title ?? ''}\n${post.body}\n${post.media?.[0]?.url ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function desoVideo(record: DesoPostRecord, videos?: Map<string, ResolvedVideo>): ResolvedVideo | undefined {
  const url = record.VideoURLs?.map((item) => safeHttpsUrl(item)).find((item): item is string => Boolean(item));
  if (!url) return undefined;
  const playbackId = livepeerPlaybackId(url);
  if (playbackId) return videos?.get(playbackId);
  const streaming = videoStreaming(url);
  return streaming ? { url, streaming } : undefined;
}

// ---------- shared helpers ----------

interface NetworkPostInput {
  network: NetworkId;
  externalId: string;
  canonicalURL: string;
  author: { id: string; displayName: string; handle: string; avatarUrl?: string };
  title?: string;
  body: string;
  createdAt: string;
  images: string[];
  imageAlt?: string;
  video?: ResolvedVideo;
  topics?: string[];
  engagement?: SocialPost['engagement'];
  selection: string;
}

function networkPost(input: NetworkPostInput): SocialPost {
  const name = networks[input.network].displayName;
  const media: PostMedia[] = input.video
    ? [{ kind: 'video', url: input.video.url, streaming: input.video.streaming, posterUrl: input.video.posterUrl ?? input.images[0], durationSeconds: input.video.durationSeconds, aspectRatio: input.video.aspectRatio ?? 9 / 16, altText: input.imageAlt?.trim() || `Video shared on ${name}` }]
    : input.images.slice(0, 1).map((url) => ({ kind: 'image', url, aspectRatio: 4 / 3, altText: input.imageAlt?.trim() || `Image shared on ${name}` }));
  return {
    id: `${input.network}:${input.externalId}`,
    author: { ...input.author, initials: initialsFor(input.author.displayName) },
    title: input.title,
    body: truncate(input.body, maxNetworkBodyLength),
    kind: input.video ? 'video' : media.length ? 'image' : 'text',
    createdAt: input.createdAt,
    media: media.length ? media : undefined,
    topics: input.topics ?? [],
    provenance: { connectorId: input.network, externalId: input.externalId, canonicalURL: input.canonicalURL },
    engagement: input.engagement,
    relevance: { followsAuthor: false, selectedInterestMatches: [] },
    eligibility: { selection: input.selection, filters: networks[input.network].filters },
  };
}

/** Only HTTPS URLs from network data are ever loaded or opened. */
export function safeHttpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeImage(url: string) {
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) || /^https:\/\/imagedelivery\.net\//.test(url);
}

function shortAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Readable excerpt of a Markdown/HTML article body: no images, tags, link syntax, or bare URLs. */
export function plainTextExcerpt(source: string, max: number): string {
  const text = source
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/^\s*\[\/\/\]:\s*#.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s|\d+\.\s)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')
    .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join(' ')
    .trim();
  return truncate(text, max);
}

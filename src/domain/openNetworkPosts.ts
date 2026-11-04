import { networkPost, plainTextExcerpt, safeHttpsUrl, videoStreaming } from './networkPosts';
import { SocialPost } from './posts';

/**
 * Public posts from the three open social protocols (ADR 0033): Bluesky (AT Protocol), Mastodon
 * (ActivityPub) and Nostr. Pure mapping into the canonical `SocialPost`, with each network's
 * published filters applied; clients live in `src/connectors/openNetworkFeeds.ts`.
 */

// ---------- Bluesky ----------

export interface BlueskyImageView { thumb?: string; fullsize?: string; alt?: string; aspectRatio?: { width: number; height: number } }
export interface BlueskyEmbedView {
  $type?: string;
  images?: BlueskyImageView[];
  playlist?: string;
  thumbnail?: string;
  alt?: string;
  aspectRatio?: { width: number; height: number };
  external?: { uri?: string; title?: string; thumb?: string };
  media?: BlueskyEmbedView;
}

export interface BlueskyPostView {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string; labels?: { val: string }[] };
  record: { text?: string; createdAt?: string; reply?: unknown; langs?: string[] };
  embed?: BlueskyEmbedView;
  labels?: { val: string }[];
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
  viewer?: { like?: string; repost?: string };
}

/** Bluesky's moderation and self-labels that Open Media hides from Feed. */
const hiddenBlueskyLabels = new Set(['spam', '!hide', '!warn', 'porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'nsfl']);

/** `at://did:plc:…/app.bsky.feed.post/<rkey>` → its parts, or undefined for anything else. */
export function parseBlueskyUri(uri: string): { did: string; rkey: string } | undefined {
  const match = uri.match(/^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]{1,512})$/);
  return match ? { did: match[1], rkey: match[2] } : undefined;
}

export function socialPostFromBluesky(view: BlueskyPostView, selection = 'Newest public post on Bluesky'): SocialPost | undefined {
  const parsed = parseBlueskyUri(view.uri);
  if (!parsed || view.record.reply) return undefined;
  const labels = [...(view.labels ?? []), ...(view.author.labels ?? [])].map((label) => label.val);
  if (labels.some((label) => hiddenBlueskyLabels.has(label))) return undefined;
  const displayName = view.author.displayName?.trim();
  if (!displayName || !view.author.avatar) return undefined;
  const body = view.record.text?.trim() ?? '';
  const media = view.embed?.media ?? view.embed;
  const images = (media?.images ?? []).map((image) => safeHttpsUrl(image.fullsize ?? image.thumb)).filter((url): url is string => Boolean(url));
  const playlist = safeHttpsUrl(media?.playlist);
  const video = playlist ? { url: playlist, streaming: 'hls' as const, posterUrl: safeHttpsUrl(media?.thumbnail), aspectRatio: media?.aspectRatio ? media.aspectRatio.width / media.aspectRatio.height : undefined } : undefined;
  if (!body && !images.length && !video) return undefined;
  return networkPost({
    network: 'bluesky',
    externalId: `${view.uri} ${view.cid}`,
    canonicalURL: `https://bsky.app/profile/${encodeURIComponent(view.author.handle)}/post/${encodeURIComponent(parsed.rkey)}`,
    author: { id: `bluesky:${view.author.did}`, displayName, handle: `@${view.author.handle}`, avatarUrl: safeHttpsUrl(view.author.avatar) },
    body,
    createdAt: validDate(view.record.createdAt ?? view.indexedAt),
    images,
    imageAlt: media?.images?.[0]?.alt ?? media?.alt,
    video,
    engagement: { replies: view.replyCount ?? 0, reposts: (view.repostCount ?? 0) + (view.quoteCount ?? 0), likes: view.likeCount ?? 0, liked: Boolean(view.viewer?.like), reshared: Boolean(view.viewer?.repost) },
    selection,
  });
}

/**
 * Bluesky facets for links and hashtags in a post, so they are clickable in every Bluesky app.
 * Byte offsets are UTF-8, as the AT Protocol requires.
 */
export function blueskyFacets(text: string): { index: { byteStart: number; byteEnd: number }; features: Record<string, string>[] }[] {
  const encoder = new TextEncoder();
  const facets: ReturnType<typeof blueskyFacets> = [];
  const byteOffset = (index: number) => encoder.encode(text.slice(0, index)).length;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g)) {
    facets.push({ index: { byteStart: byteOffset(match.index!), byteEnd: byteOffset(match.index! + match[0].length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }] });
  }
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const start = match.index! + match[1].length;
    facets.push({ index: { byteStart: byteOffset(start), byteEnd: byteOffset(start + match[2].length + 1) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[2] }] });
  }
  return facets;
}

/** Bluesky's limit is 300 graphemes; this counts user-perceived characters where Intl allows. */
export function graphemeLength(text: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<unknown> } }).Segmenter;
  if (Segmenter) { let count = 0; for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) count += 1; return count; }
  return [...text].length;
}

// ---------- Mastodon ----------

export interface MastodonAttachment { type: 'image' | 'video' | 'gifv' | 'audio' | 'unknown'; url?: string | null; preview_url?: string | null; description?: string | null; meta?: { original?: { width?: number; height?: number; duration?: number } } }

export interface MastodonStatus {
  id: string;
  uri: string;
  url?: string | null;
  created_at: string;
  account: { id: string; acct: string; username: string; display_name?: string; avatar?: string; bot?: boolean; url?: string };
  content: string;
  sensitive?: boolean;
  spoiler_text?: string;
  visibility?: string;
  in_reply_to_id?: string | null;
  reblog?: MastodonStatus | null;
  media_attachments?: MastodonAttachment[];
  replies_count?: number;
  reblogs_count?: number;
  favourites_count?: number;
  favourited?: boolean;
  reblogged?: boolean;
  tags?: { name: string }[];
}

/** `acct` is `user` on the reading server and `user@server` elsewhere; always show the full address. */
export function mastodonHandle(acct: string, readingServer: string): string {
  return `@${acct.includes('@') ? acct : `${acct}@${readingServer}`}`;
}

export function socialPostFromMastodon(status: MastodonStatus, readingServer: string, selection = 'Newest public post on Mastodon'): SocialPost | undefined {
  if (status.reblog || status.in_reply_to_id || status.sensitive || status.spoiler_text?.trim() || status.account.bot) return undefined;
  if (status.visibility && status.visibility !== 'public') return undefined;
  const body = plainTextExcerpt(status.content.replace(/<a [^>]*class="[^"]*mention[^"]*"[^>]*>[\s\S]*?<\/a>/gi, (link) => link.replace(/<[^>]+>/g, '')), 4000);
  const attachments = status.media_attachments ?? [];
  const images = attachments.filter((item) => item.type === 'image').map((item) => safeHttpsUrl(item.url)).filter((url): url is string => Boolean(url));
  const videoAttachment = attachments.find((item) => item.type === 'video' || item.type === 'gifv');
  const videoUrl = safeHttpsUrl(videoAttachment?.url);
  const original = videoAttachment?.meta?.original;
  const video = videoUrl && videoStreaming(videoUrl) ? { url: videoUrl, streaming: videoStreaming(videoUrl)!, posterUrl: safeHttpsUrl(videoAttachment?.preview_url), durationSeconds: original?.duration, aspectRatio: original?.width && original.height ? original.width / original.height : undefined } : undefined;
  if (!body && !images.length && !video) return undefined;
  const name = status.account.display_name?.replace(/:[a-z0-9_]+:/gi, '').trim() || status.account.username;
  const handle = mastodonHandle(status.account.acct, readingServer);
  return networkPost({
    network: 'mastodon',
    externalId: status.uri,
    canonicalURL: safeHttpsUrl(status.url) ?? safeHttpsUrl(status.uri) ?? `https://${readingServer}/`,
    author: { id: `mastodon:${handle.slice(1).toLowerCase()}`, displayName: name, handle, avatarUrl: safeHttpsUrl(status.account.avatar) },
    body,
    createdAt: validDate(status.created_at),
    images,
    imageAlt: (videoAttachment ?? attachments[0])?.description ?? undefined,
    video,
    topics: (status.tags ?? []).map((tag) => tag.name.toLowerCase()).slice(0, 8),
    engagement: { replies: status.replies_count ?? 0, reposts: status.reblogs_count ?? 0, likes: status.favourites_count ?? 0, liked: Boolean(status.favourited), reshared: Boolean(status.reblogged) },
    selection,
  });
}

/** A Mastodon server name as people type it (`mastodon.social`, `https://fosstodon.org/`, `@me@mas.to`). */
export function mastodonServer(input: string): string | undefined {
  const text = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const host = text.includes('@') ? text.split('@').filter(Boolean).pop()! : text;
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && !/^(localhost|.*\.local)$/.test(host) ? host : undefined;
}

// ---------- Nostr ----------

export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }
export interface NostrProfile { name?: string; display_name?: string; picture?: string; nip05?: string }

export function nostrProfileFromEvent(event: NostrEvent | undefined): NostrProfile | undefined {
  if (!event || event.kind !== 0) return undefined;
  try {
    const value = JSON.parse(event.content) as Record<string, unknown>;
    const text = (key: string) => typeof value[key] === 'string' ? (value[key] as string).trim().slice(0, 120) : undefined;
    return { name: text('name'), display_name: text('display_name') ?? text('displayName'), picture: text('picture'), nip05: text('nip05') };
  } catch { return undefined; }
}

const nostrImage = /https:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s]*)?/gi;
const nostrVideo = /https:\/\/[^\s]+\.(?:mp4|mov|m4v|webm|m3u8)(?:\?[^\s]*)?/i;

/** Text notes (kind 1) that start a conversation, from accounts with a published name and photo. */
export function socialPostFromNostr(event: NostrEvent, profile: NostrProfile | undefined, selection = 'Newest public note on Nostr relays'): SocialPost | undefined {
  if (event.kind !== 1 || !/^[0-9a-f]{64}$/.test(event.id) || !/^[0-9a-f]{64}$/.test(event.pubkey)) return undefined;
  if (event.tags.some((tag) => tag[0] === 'e' && tag[3] !== 'mention') || event.tags.some((tag) => tag[0] === 'content-warning')) return undefined;
  const name = (profile?.display_name || profile?.name)?.trim();
  const avatar = safeHttpsUrl(profile?.picture);
  if (!name || !avatar) return undefined;
  const images = [...event.content.matchAll(nostrImage)].map((match) => match[0]);
  const videoUrl = event.content.match(nostrVideo)?.[0];
  const body = event.content.replace(nostrImage, '').replace(nostrVideo, '').replace(/nostr:(npub|nprofile|note|nevent|naddr)1[02-9ac-hj-np-z]+/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const video = videoUrl && videoStreaming(videoUrl) ? { url: videoUrl, streaming: videoStreaming(videoUrl)! } : undefined;
  if (!body && !images.length && !video) return undefined;
  const npub = bech32Encode('npub', fromHexString(event.pubkey));
  const handle = profile?.nip05 && /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(profile.nip05) ? `@${profile.nip05.replace(/^_@/, '')}` : `${npub.slice(0, 14)}…`;
  return networkPost({
    network: 'nostr',
    externalId: `${event.id} ${event.pubkey}`,
    canonicalURL: `https://njump.me/${bech32Encode('note', fromHexString(event.id))}`,
    author: { id: `nostr:${event.pubkey}`, displayName: name, handle, avatarUrl: avatar },
    body,
    createdAt: new Date(event.created_at * 1000).toISOString(),
    images: images.map((url) => safeHttpsUrl(url)).filter((url): url is string => Boolean(url)),
    video,
    topics: event.tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1].toLowerCase()).slice(0, 8),
    selection,
  });
}

/** Hashtags in a note become `t` tags, which is how Nostr clients find them. */
export function nostrTags(text: string): string[][] {
  const tags = new Set<string>();
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) tags.add(match[2].toLowerCase());
  return [...tags].map((tag) => ['t', tag]);
}

// ---------- bech32 (NIP-19 npub / note) ----------

const bech32Alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit += 1) if ((top >> bit) & 1) checksum ^= generators[bit];
  }
  return checksum;
}

function convertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] {
  let accumulator = 0; let bits = 0; const result: number[] = []; const max = (1 << to) - 1;
  for (const value of data) {
    accumulator = (accumulator << from) | value; bits += from;
    while (bits >= to) { bits -= to; result.push((accumulator >> bits) & max); }
  }
  if (pad && bits > 0) result.push((accumulator << (to - bits)) & max);
  else if (!pad && (bits >= from || ((accumulator << (to - bits)) & max))) throw new Error('Invalid bech32 padding.');
  return result;
}

const expandPrefix = (prefix: string) => [...[...prefix].map((char) => char.charCodeAt(0) >> 5), 0, ...[...prefix].map((char) => char.charCodeAt(0) & 31)];

export function bech32Encode(prefix: string, bytes: Uint8Array): string {
  const words = convertBits(bytes, 8, 5, true);
  const checksum = polymod([...expandPrefix(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checkWords = Array.from({ length: 6 }, (_, index) => (checksum >> (5 * (5 - index))) & 31);
  return `${prefix}1${[...words, ...checkWords].map((word) => bech32Alphabet[word]).join('')}`;
}

export function bech32Decode(text: string): { prefix: string; bytes: Uint8Array } | undefined {
  const value = text.trim().toLowerCase();
  const split = value.lastIndexOf('1');
  if (split < 1 || value.length > 5000) return undefined;
  const prefix = value.slice(0, split);
  const words = [...value.slice(split + 1)].map((char) => bech32Alphabet.indexOf(char));
  if (words.length < 6 || words.some((word) => word < 0) || polymod([...expandPrefix(prefix), ...words]) !== 1) return undefined;
  try { return { prefix, bytes: Uint8Array.from(convertBits(words.slice(0, -6), 5, 8, false)) }; } catch { return undefined; }
}

/** `npub1…` or a 64-character hex key → hex public key. */
export function nostrPublicKey(input: string): string | undefined {
  const text = input.trim().replace(/^nostr:/, '').replace(/^@/, '');
  if (/^[0-9a-f]{64}$/i.test(text)) return text.toLowerCase();
  const decoded = bech32Decode(text);
  return decoded?.prefix === 'npub' && decoded.bytes.length === 32 ? toHexString(decoded.bytes) : undefined;
}

export function fromHexString(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
}

export function toHexString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validDate(value: string | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  // Some clients backdate or future-date posts; never let one sort above the present.
  return Number.isFinite(time) ? new Date(Math.min(time, Date.now())).toISOString() : new Date().toISOString();
}

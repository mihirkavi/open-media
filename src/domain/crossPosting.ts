import { NetworkId, networks } from './networkPosts';
import { graphemeLength } from './openNetworkPosts';
import { isPubliclyReachableUrl, VideoContentType } from './postVideo';

/**
 * Write once, publish everywhere. Pure rules for choosing destinations and fitting one Open Media
 * post to each network. Network clients live in `src/connectors/publishing`.
 *
 * Default: every network the person has connected receives every post, unless they turned that
 * network off in Settings → Cross-posting. They can still change destinations for a single post.
 */
/**
 * Closed networks Open Media posts to through their official OAuth APIs (ADR 0033). Their feeds
 * aren't read (none offers a free public read API), so they are destinations only, and each needs
 * Open Media's own developer app on that network, which the server reports through
 * `/v1/social/status`.
 */
export type OAuthNetworkId = 'x' | 'threads' | 'linkedin' | 'instagram' | 'facebook';
export const oauthNetworks: OAuthNetworkId[] = ['x', 'threads', 'linkedin', 'instagram', 'facebook'];
/** Anywhere a post can be cross-posted to. */
export type DestinationId = NetworkId | OAuthNetworkId;

export const destinationNames: Record<DestinationId, string> = {
  ...Object.fromEntries(Object.values(networks).map((network) => [network.id, network.displayName])) as Record<NetworkId, string>,
  x: 'X', threads: 'Threads', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook',
};

export function isOAuthNetwork(id: string): id is OAuthNetworkId {
  return (oauthNetworks as string[]).includes(id);
}

/** Every destination, in display order: open networks first, then the closed ones. */
export const crossPostNetworks: DestinationId[] = ['bluesky', 'mastodon', 'nostr', 'farcaster', 'lens', 'hive', 'deso', ...oauthNetworks];

export interface CrossPostPreferences {
  /** Connected networks the person chose not to include by default. Empty means “everywhere”. */
  excludedByDefault: DestinationId[];
}

export const defaultCrossPostPreferences: CrossPostPreferences = { excludedByDefault: [] };

export function defaultDestinations(connected: DestinationId[], preferences: CrossPostPreferences): DestinationId[] {
  return crossPostNetworks.filter((network) => connected.includes(network) && !preferences.excludedByDefault.includes(network));
}

/** Composer summary, e.g. “Open Media + 3”. */
export function destinationSummary(destinations: DestinationId[]): string {
  if (!destinations.length) return 'Open Media only';
  if (destinations.length === 1) return `Open Media + ${destinationNames[destinations[0]]}`;
  return `Open Media + ${destinations.length}`;
}

/** The post's video, as handed to each network. */
export interface CrossPostVideo {
  /** Where Open Media serves the video. Only usable by other networks when publicly reachable. */
  url: string;
  posterUrl?: string;
  contentType: VideoContentType;
  durationSeconds: number;
  width: number;
  height: number;
  /** The cleaned file (location metadata removed), for networks that store their own copy. */
  bytes?: Uint8Array;
  altText: string;
}

/** What one network receives. Hive needs a title; the others take the text as is. */
export interface CrossPostContent { text: string; title?: string; video?: CrossPostVideo }

/** `note` tells people how a network received the post when it differs from Open Media's. */
export type PreparedCrossPost = { ok: true; content: CrossPostContent; note?: string } | { ok: false; reason: string };

/**
 * Farcaster counts UTF-8 bytes, not characters. Up to 320 bytes is an ordinary cast; longer text
 * goes as a long cast (up to 1,024) or a "10k" cast (up to 10,000), open to every account since
 * protocol version 21 (October 2026, ADR 0039).
 */
export const farcasterMaxBytes = 10_000;
/** Above this, Farcaster apps show a cast as a long cast with "Show more". */
export const farcasterShortCastBytes = 320;
/** Farcaster embed URLs are limited to 256 bytes. */
export const farcasterMaxEmbedBytes = 256;
export const hiveMaxTitleLength = 255;
/** Bluesky counts graphemes (user-perceived characters). */
export const blueskyMaxGraphemes = 300;
/** Mastodon's default limit; some servers allow more. */
export const mastodonMaxCharacters = 500;
export const nostrMaxCharacters = 16_000;
export const xMaxWeightedLength = 280;
export const threadsMaxCharacters = 500;
export const linkedInMaxCharacters = 3000;
export const instagramMaxCaption = 2200;
export const facebookMaxCharacters = 63_206;

/**
 * X's character count: every link counts as 23, and characters outside Latin and common
 * punctuation (CJK, emoji) count as 2.
 */
export function xWeightedLength(text: string): number {
  let length = 0;
  const withoutLinks = text.replace(/https?:\/\/\S+/g, () => { length += 23; return ''; });
  for (const char of withoutLinks) {
    const code = char.codePointAt(0)!;
    length += code <= 0x10ff || (code >= 0x2000 && code <= 0x200d) || (code >= 0x2010 && code <= 0x201f) || (code >= 0x2032 && code <= 0x2037) ? 1 : 2;
  }
  return length;
}
const hiveTitleSoftLength = 80;

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

const localOnly = 'The video is stored on this computer’s local Open Media server, which other networks can’t reach. It will cross-post from Open Media’s hosted service.';

/**
 * Fits a post to one network, or explains (before publishing) why it can’t go there. Video per
 * network: Lens and DeSo store their own copy of the file; Farcaster embeds Open Media’s public
 * video URL; Hive has no native video, so it gets a link (with the poster image when there is one).
 */
export function prepareCrossPost(body: string, network: DestinationId, video?: CrossPostVideo): PreparedCrossPost {
  const text = body.trim();
  if (!text && !video) return { ok: false, reason: 'There is nothing to post.' };
  const reachable = Boolean(video && isPubliclyReachableUrl(video.url));
  switch (network) {
    case 'farcaster': {
      const bytes = utf8Length(text);
      if (bytes > farcasterMaxBytes) return { ok: false, reason: `Too long for Farcaster (${bytes.toLocaleString('en-US')} of ${farcasterMaxBytes.toLocaleString('en-US')} bytes).` };
      const long = bytes > farcasterShortCastBytes ? 'Goes to Farcaster as a long cast.' : undefined;
      if (!video) return { ok: true, content: { text }, ...(long ? { note: long } : {}) };
      if (!reachable) return { ok: false, reason: localOnly };
      if (utf8Length(video.url) > farcasterMaxEmbedBytes) return { ok: false, reason: 'The video link is too long for a Farcaster embed.' };
      return { ok: true, content: { text, video }, note: 'Farcaster apps play the video from Open Media’s link.' };
    }
    case 'hive': {
      if (!video) return { ok: true, content: { text, title: hiveTitle(text) } };
      if (!reachable) return { ok: false, reason: localOnly };
      const poster = video.posterUrl && isPubliclyReachableUrl(video.posterUrl) ? `[![${markdownText(video.altText)}](${video.posterUrl})](${video.url})

` : '';
      const markdown = `${text ? `${text}

` : ''}${poster}▶ [Watch the video](${video.url})`;
      return { ok: true, content: { text: markdown, title: text ? hiveTitle(text) : 'Video', video }, note: 'Hive has no native video, so it gets a link to the video.' };
    }
    case 'lens':
      if (video && !video.bytes && !reachable) return { ok: false, reason: 'The video file isn’t available on this device any more. Post it again from the device it was recorded on.' };
      return { ok: true, content: { text, video } };
    case 'deso':
      if (video && !video.bytes) return { ok: false, reason: 'DeSo needs the video file itself, which isn’t available on this device any more.' };
      return { ok: true, content: { text, video } };
    case 'bluesky':
    case 'mastodon':
    case 'nostr': {
      // These three get the video as a link to Open Media's copy (Nostr apps play it inline).
      if (video && !reachable) return { ok: false, reason: localOnly };
      const full = video ? `${text ? `${text}\n\n` : ''}${video.url}` : text;
      const name = destinationNames[network];
      if (network === 'bluesky' && graphemeLength(full) > blueskyMaxGraphemes) return { ok: false, reason: `Too long for Bluesky (${graphemeLength(full)} of ${blueskyMaxGraphemes} characters).` };
      if (network === 'mastodon' && [...full].length > mastodonMaxCharacters) return { ok: false, reason: `Too long for Mastodon (${[...full].length} of ${mastodonMaxCharacters} characters).` };
      if (network === 'nostr' && full.length > nostrMaxCharacters) return { ok: false, reason: 'Too long for Nostr relays.' };
      return { ok: true, content: { text: full, video }, note: video ? `${name} gets a link to the video.` : undefined };
    }
    case 'instagram': {
      if (!video) return { ok: false, reason: 'Instagram posts need a video (Instagram’s API doesn’t take text-only posts).' };
      if (!reachable) return { ok: false, reason: localOnly };
      if ([...text].length > instagramMaxCaption) return { ok: false, reason: `Too long for an Instagram caption (${[...text].length} of ${instagramMaxCaption} characters).` };
      return { ok: true, content: { text, video }, note: 'Instagram gets the video as a Reel.' };
    }
    case 'x':
    case 'threads':
    case 'linkedin':
    case 'facebook': {
      if (video && !reachable) return { ok: false, reason: localOnly };
      const full = video ? `${text ? `${text}\n\n` : ''}${video.url}` : text;
      const name = destinationNames[network];
      const length = network === 'x' ? xWeightedLength(full) : [...full].length;
      const limit = { x: xMaxWeightedLength, threads: threadsMaxCharacters, linkedin: linkedInMaxCharacters, facebook: facebookMaxCharacters }[network];
      if (length > limit) return { ok: false, reason: `Too long for ${name} (${length} of ${limit} characters).` };
      return { ok: true, content: { text: full, video }, note: video ? `${name} gets a link to the video.` : undefined };
    }
  }
}

function markdownText(value: string): string {
  return value.replace(/[[\]]/g, '').slice(0, 120);
}

/** First line (or sentence) of the post, shortened at a word boundary. */
export function hiveTitle(text: string): string {
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? text;
  const sentence = firstLine.match(/^(.{20,}?[.!?])\s/)?.[1] ?? firstLine;
  if (sentence.length <= hiveTitleSoftLength) return sentence;
  const cut = sentence.slice(0, hiveTitleSoftLength - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40));
  return `${atWord.trimEnd()}…`.slice(0, hiveMaxTitleLength);
}

/** Hive permlinks: lowercase letters, digits, and dashes, unique per author. */
export function hivePermlink(title: string, uniqueSuffix: string): string {
  const slug = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const suffix = uniqueSuffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'post';
  return slug ? `${slug}-${suffix}` : `open-media-${suffix}`;
}

export type CrossPostStatus = 'published' | 'failed' | 'skipped';

export interface CrossPostOutcome {
  network: DestinationId;
  status: CrossPostStatus;
  /** Public link to the copy on that network, when known. */
  url?: string;
  externalId?: string;
  /** Plain-language reason for failed or skipped destinations, or how a published copy differs. */
  message?: string;
}

/** One short line for the composer after publishing. */
export function outcomeSummary(outcomes: CrossPostOutcome[]): string {
  const name = (network: DestinationId) => destinationNames[network];
  const published = outcomes.filter((outcome) => outcome.status === 'published').map((outcome) => name(outcome.network));
  const missed = outcomes.filter((outcome) => outcome.status !== 'published').map((outcome) => name(outcome.network));
  const posted = `Posted to ${['Open Media', ...published].join(', ')}.`;
  return missed.length ? `${posted} Not posted to ${missed.join(', ')}.` : posted;
}

import { NetworkId, networks } from './networkPosts';
import { isPubliclyReachableUrl, VideoContentType } from './postVideo';

/**
 * Write once, publish everywhere. Pure rules for choosing destinations and fitting one Open Media
 * post to each network. Network clients live in `src/connectors/publishing`.
 *
 * Default: every network the person has connected receives every post, unless they turned that
 * network off in Settings → Cross-posting. They can still change destinations for a single post.
 */
export const crossPostNetworks: NetworkId[] = ['farcaster', 'lens', 'hive', 'deso'];

export interface CrossPostPreferences {
  /** Connected networks the person chose not to include by default. Empty means “everywhere”. */
  excludedByDefault: NetworkId[];
}

export const defaultCrossPostPreferences: CrossPostPreferences = { excludedByDefault: [] };

export function defaultDestinations(connected: NetworkId[], preferences: CrossPostPreferences): NetworkId[] {
  return crossPostNetworks.filter((network) => connected.includes(network) && !preferences.excludedByDefault.includes(network));
}

/** Composer summary, e.g. “Open Media + 3”. */
export function destinationSummary(destinations: NetworkId[]): string {
  if (!destinations.length) return 'Open Media only';
  if (destinations.length === 1) return `Open Media + ${networks[destinations[0]].displayName}`;
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

/** Farcaster counts UTF-8 bytes, not characters. */
export const farcasterMaxBytes = 320;
/** Farcaster embed URLs are limited to 256 bytes. */
export const farcasterMaxEmbedBytes = 256;
export const hiveMaxTitleLength = 255;
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
export function prepareCrossPost(body: string, network: NetworkId, video?: CrossPostVideo): PreparedCrossPost {
  const text = body.trim();
  if (!text && !video) return { ok: false, reason: 'There is nothing to post.' };
  const reachable = Boolean(video && isPubliclyReachableUrl(video.url));
  switch (network) {
    case 'farcaster': {
      const bytes = utf8Length(text);
      if (bytes > farcasterMaxBytes) return { ok: false, reason: `Too long for Farcaster (${bytes} of ${farcasterMaxBytes} bytes).` };
      if (!video) return { ok: true, content: { text } };
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
  network: NetworkId;
  status: CrossPostStatus;
  /** Public link to the copy on that network, when known. */
  url?: string;
  externalId?: string;
  /** Plain-language reason for failed or skipped destinations, or how a published copy differs. */
  message?: string;
}

/** One short line for the composer after publishing. */
export function outcomeSummary(outcomes: CrossPostOutcome[]): string {
  const name = (network: NetworkId) => networks[network].displayName;
  const published = outcomes.filter((outcome) => outcome.status === 'published').map((outcome) => name(outcome.network));
  const missed = outcomes.filter((outcome) => outcome.status !== 'published').map((outcome) => name(outcome.network));
  const posted = `Posted to ${['Open Media', ...published].join(', ')}.`;
  return missed.length ? `${posted} Not posted to ${missed.join(', ')}.` : posted;
}

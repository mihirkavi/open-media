import { NetworkId, networks } from './networkPosts';

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

/** What one network receives. Hive needs a title; the others take the text as is. */
export interface CrossPostContent { text: string; title?: string }

export type PreparedCrossPost = { ok: true; content: CrossPostContent } | { ok: false; reason: string };

/** Farcaster counts UTF-8 bytes, not characters. */
export const farcasterMaxBytes = 320;
export const hiveMaxTitleLength = 255;
const hiveTitleSoftLength = 80;

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Fits a post to one network, or explains (before publishing) why it can’t go there unchanged. */
export function prepareCrossPost(body: string, network: NetworkId): PreparedCrossPost {
  const text = body.trim();
  if (!text) return { ok: false, reason: 'There is nothing to post.' };
  switch (network) {
    case 'farcaster': {
      const bytes = utf8Length(text);
      return bytes <= farcasterMaxBytes
        ? { ok: true, content: { text } }
        : { ok: false, reason: `Too long for Farcaster (${bytes} of ${farcasterMaxBytes} bytes).` };
    }
    case 'hive':
      return { ok: true, content: { text, title: hiveTitle(text) } };
    case 'lens':
    case 'deso':
      return { ok: true, content: { text } };
  }
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
  /** Plain-language reason for failed or skipped destinations. */
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

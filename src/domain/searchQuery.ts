import { NetworkId, networks } from './networkPosts';
import { SocialPost } from './posts';

/**
 * Understands plain-language searches on the device, e.g. “videos about ethereum on lens today”:
 * media type, networks, and a time window are pulled out, and what remains is the search text.
 * Every interpretation is shown back to the person, so nothing is hidden.
 */
export interface ParsedSearch {
  /** What the person typed, trimmed. */
  raw: string;
  /** Search text sent to networks, without the understood parts. */
  text: string;
  keywords: string[];
  media?: 'video' | 'image';
  networks?: NetworkId[];
  sinceMs?: number;
  /** Products, services or events only (ADR 0013). */
  structured?: 'product' | 'service' | 'event';
  /** Plain-language summary of what was understood, e.g. ["Videos only", "On Lens", "Last 24 hours"]. */
  understood: string[];
}

const stopWords = new Set(['a', 'an', 'the', 'about', 'on', 'in', 'from', 'of', 'for', 'and', 'or', 'with', 'to', 'by', 'posts', 'post', 'show', 'me', 'find', 'search', 'what', 'are', 'is', 'people', 'saying', 'say', 'any', 'all', 'some', 'latest', 'recent', 'new', 'newest']);
const networkNames: [RegExp, NetworkId][] = [[/\bfarcaster|warpcast\b/i, 'farcaster'], [/\blens\b/i, 'lens'], [/\bhive\b/i, 'hive'], [/\bdeso\b/i, 'deso']];
const day = 24 * 60 * 60 * 1000;

export function parseSearchQuery(input: string, now = Date.now()): ParsedSearch {
  const raw = input.trim();
  let rest = ` ${raw} `;
  const understood: string[] = [];
  let media: ParsedSearch['media'];
  if (/\b(videos?|clips?|shorts?|reels?)\b/i.test(rest)) { media = 'video'; understood.push('Videos only'); rest = rest.replace(/\b(videos?|clips?|shorts?|reels?)\b/gi, ' '); }
  else if (/\b(photos?|images?|pictures?|pics?)\b/i.test(rest)) { media = 'image'; understood.push('Images only'); rest = rest.replace(/\b(photos?|images?|pictures?|pics?)\b/gi, ' '); }
  let structured: ParsedSearch['structured'];
  const kinds: [RegExp, NonNullable<ParsedSearch['structured']>, string][] = [
    [/\b(events?|meetups?|happenings?|things to do)\b/i, 'event', 'Events only'],
    [/\b(products?|for sale|selling|buy|marketplace)\b/i, 'product', 'Products only'],
    [/\b(services?|hire|freelancers?)\b/i, 'service', 'Services only'],
  ];
  for (const [pattern, kind, label] of kinds) {
    if (pattern.test(rest)) { structured = kind; understood.push(label); rest = rest.replace(new RegExp(pattern.source, 'gi'), ' '); break; }
  }
  // Events are about the future, so "this weekend" means upcoming rather than a past window.
  if (structured === 'event' && /\b(this weekend|this week|today|tonight|tomorrow)\b/i.test(rest)) { rest = rest.replace(/\b(this weekend|this week|today|tonight|tomorrow)\b/gi, ' '); understood.push('Upcoming'); }
  const found = networkNames.filter(([pattern]) => pattern.test(rest)).map(([, id]) => id);
  if (found.length) { understood.push(`On ${found.map((id) => networks[id].displayName).join(', ')}`); networkNames.forEach(([pattern]) => { rest = rest.replace(new RegExp(pattern.source, 'gi'), ' '); }); }
  let sinceMs: number | undefined;
  const windows: [RegExp, number, string][] = [[/\b(today|last 24 hours)\b/i, day, 'Last 24 hours'], [/\b(this week|past week|last week)\b/i, 7 * day, 'Last 7 days'], [/\b(this month|past month|last month)\b/i, 30 * day, 'Last 30 days']];
  for (const [pattern, span, label] of windows) {
    if (pattern.test(rest)) { sinceMs = now - span; understood.push(label); rest = rest.replace(pattern, ' '); break; }
  }
  const keywords = rest.toLocaleLowerCase().replace(/[^\p{L}\p{N}#@\s-]/gu, ' ').split(/\s+/).map((word) => word.replace(/^[-]+|[-]+$/g, '')).filter((word) => word && !stopWords.has(word));
  return { raw, text: keywords.join(' '), keywords, media, networks: found.length ? found : undefined, sinceMs, structured, understood };
}

/** Whether a post satisfies the understood filters and contains every keyword (author and text). */
export function postMatchesSearch(post: SocialPost, search: ParsedSearch): boolean {
  if (search.networks && !search.networks.includes(post.provenance.connectorId as NetworkId)) return false;
  if (search.media && !post.media?.some((item) => item.kind === search.media)) return false;
  if (search.sinceMs && Date.parse(post.createdAt) < search.sinceMs) return false;
  if (search.structured === 'event' && !post.event) return false;
  if ((search.structured === 'product' || search.structured === 'service') && post.listing?.kind !== search.structured) return false;
  const haystack = [post.author.displayName, post.author.handle, post.title ?? '', post.body, ...post.topics, post.listing?.title ?? '', post.listing?.location ?? '', post.event?.title ?? '', post.event?.place ?? '', post.event?.organizer ?? ''].join(' ').toLocaleLowerCase();
  return search.keywords.every((keyword) => haystack.includes(keyword.replace(/^#/, '')));
}

/** A Hive tag for the search (Hive's public API searches by tag only). */
export function hiveTagFor(search: ParsedSearch): string | undefined {
  const tag = search.keywords.map((word) => word.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '')).find((word) => word.length >= 2);
  return tag || undefined;
}

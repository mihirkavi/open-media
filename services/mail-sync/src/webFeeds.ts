/**
 * Web feeds in the Worker (ADR 0024): finding a site's feed, reading it politely, and the person's
 * subscriptions. Parsing is the app's own (src/domain/webFeeds.ts).
 *
 * - Every request goes through the same SSRF guard as profile import and listing checks: https on
 *   port 443 only, no credentials, every address public, checked again after each redirect.
 * - Conditional GET with the feed's ETag and Last-Modified; at most every 30 minutes (longer when
 *   the feed's ttl or Cache-Control asks), skipHours/skipDays honoured, Retry-After obeyed, and
 *   failures backed off from 30 minutes to a day.
 * - One fetch serves everyone who follows a feed: parsed feeds are cached by address (Cloudflare's
 *   Cache API, with a per-isolate map in front and alone in local development).
 * - robots.txt is obeyed for the home page read to find a feed; the feed a person chose is then read
 *   for them, as feed readers do.
 */
import { DiscoveredFeed, commonFeedPaths, discoverWebFeeds, formatNames, hostOf, maxItemAgeDays, ParsedWebFeed, parseOpml, parseWebFeed, socialPostFromFeedItem, toOpml, WebFeedError } from '../../../src/domain/webFeeds';
import { directoryFeedForSite, officialPublisher } from '../../../src/domain/webFeedDirectory';
import type { SocialPost } from '../../../src/domain/posts';
import { isPublicHost, MarketplaceDeps } from './marketplace.js';
import { robotsAllows } from './profileImport.js';

export const feedReaderAgent = 'OpenMediaFeedReader/1.0 (+https://openmedia.site/docs/web-feeds)';
/** The token robots.txt rules name, e.g. "User-agent: OpenMediaFeedReader". */
export const feedReaderToken = 'OpenMediaFeedReader';

const feedLimitBytes = 2_000_000;
const pageLimitBytes = 1_000_000;
const minute = 60_000;
export const minRefreshMinutes = 30;
export const maxRefreshMinutes = 24 * 60;
/** Feeds refreshed in one request; the rest are served from cache and refreshed next time. */
const refreshesPerRequest = 12;
export const maxSubscriptions = 300;
const feedAccept = 'application/feed+json, application/atom+xml, application/rss+xml;q=0.95, application/rdf+xml;q=0.9, application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, */*;q=0.1';

export class WebFeedApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// ---------- fetching ----------

export type WebFeedDeps = MarketplaceDeps & { cache?: FeedCache };

interface Fetched { url: string; status: number; headers: Headers; text: string; movedPermanently: boolean }

function charsetOf(contentType: string, bytes: Uint8Array): string {
  const declared = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (declared) return declared;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  return head.match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i)?.[1] ?? 'utf-8';
}

/** A checked https GET: public addresses only, at most four redirects, a size and time limit. */
export async function fetchChecked(url: string, deps: WebFeedDeps, maxBytes: number, headers: Record<string, string>): Promise<Fetched | undefined> {
  const fetchImpl = deps.fetch ?? fetch;
  let current = url;
  let movedPermanently = false;
  for (let hop = 0; hop < 5; hop += 1) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return undefined; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return undefined;
    if (!(await isPublicHost(parsed.hostname, deps.resolve))) return undefined;
    const response = await fetchImpl(parsed.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': feedReaderAgent, ...headers } }).catch(() => undefined);
    if (!response) return undefined;
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get('location');
      if (!location) return undefined;
      // Only a chain of permanent redirects moves the feed for good.
      movedPermanently = (hop === 0 || movedPermanently) && (response.status === 301 || response.status === 308);
      current = new URL(location, parsed).toString();
      continue;
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (size < maxBytes) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        size += value.byteLength;
      }
      await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(Math.min(size, maxBytes));
    let offset = 0;
    for (const chunk of chunks) { const part = chunk.subarray(0, Math.max(0, bytes.length - offset)); bytes.set(part, offset); offset += part.byteLength; }
    let text: string;
    try { text = new TextDecoder(charsetOf(response.headers.get('content-type') ?? '', bytes)).decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
    return { url: current, status: response.status, headers: response.headers, text, movedPermanently: movedPermanently && current !== url };
  }
  return undefined;
}

// ---------- the shared cache ----------

export interface FeedCacheEntry {
  url: string;
  fetchedAt: number;
  nextFetchAt: number;
  failures: number;
  etag?: string;
  lastModified?: string;
  /** The last HTTP status, or 0 when the feed could not be reached. */
  status: number;
  error?: string;
  gone?: boolean;
  /** Where a permanent redirect says the feed now lives. */
  movedTo?: string;
  feed?: ParsedWebFeed;
}

export interface FeedCache {
  get(url: string): Promise<FeedCacheEntry | undefined>;
  put(entry: FeedCacheEntry): Promise<void>;
}

/** A per-isolate map; on its own in local development and tests. */
export function memoryFeedCache(limit = 500): FeedCache {
  const entries = new Map<string, FeedCacheEntry>();
  return {
    async get(url) { return entries.get(url); },
    async put(entry) {
      entries.delete(entry.url);
      entries.set(entry.url, entry);
      if (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
  };
}

const isolateCache = memoryFeedCache();

/** Cloudflare's Cache API behind the isolate's map; just the map where the Cache API is missing. */
export function defaultFeedCache(): FeedCache {
  const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!edge) return isolateCache;
  const key = (url: string) => new Request(`https://web-feed-cache.openmedia.site/${encodeURIComponent(url)}`);
  return {
    async get(url) {
      const local = await isolateCache.get(url);
      if (local) return local;
      const hit = await edge.match(key(url)).catch(() => undefined);
      const entry = hit ? await hit.json().catch(() => undefined) as FeedCacheEntry | undefined : undefined;
      if (entry) await isolateCache.put(entry);
      return entry;
    },
    async put(entry) {
      await isolateCache.put(entry);
      await edge.put(key(entry.url), new Response(JSON.stringify(entry), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=604800' } })).catch(() => undefined);
    },
  };
}

// ---------- how often ----------

const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** When to read a feed next: its ttl or max-age (30 minutes to a day), then past any skipHours/skipDays. */
export function nextFetchTime(feed: ParsedWebFeed | undefined, headers: Headers | undefined, now: number): number {
  const maxAge = Number(headers?.get('cache-control')?.match(/max-age=(\d+)/)?.[1]);
  const wanted = Math.max(feed?.ttlMinutes ?? 0, Number.isFinite(maxAge) ? Math.round(maxAge / 60) : 0);
  let next = now + Math.min(maxRefreshMinutes, Math.max(minRefreshMinutes, wanted)) * minute;
  const skipHours = new Set(feed?.skipHours ?? []);
  const skipDays = new Set((feed?.skipDays ?? []).map((day) => day.toLowerCase()));
  for (let step = 0; step < 48 && (skipHours.has(new Date(next).getUTCHours()) || skipDays.has(dayNames[new Date(next).getUTCDay()])); step += 1) {
    next = Math.min(now + maxRefreshMinutes * minute, (Math.floor(next / (60 * minute)) + 1) * 60 * minute);
  }
  return next;
}

export function backoffTime(failures: number, now: number, retryAfter?: string | null): number {
  const seconds = Number(retryAfter);
  const retryAt = Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : retryAfter ? Date.parse(retryAfter) : NaN;
  const backoff = now + Math.min(maxRefreshMinutes, minRefreshMinutes * 2 ** Math.max(0, failures - 1)) * minute;
  return Number.isFinite(retryAt) ? Math.min(now + maxRefreshMinutes * minute, Math.max(backoff, retryAt)) : backoff;
}

// ---------- reading one feed ----------

/**
 * A feed from the cache, read again only when it is due. With `cachedOnly`, nothing is fetched.
 * A failed read keeps the last good copy, so a feed that is briefly down still shows its items.
 */
export async function readFeed(url: string, deps: WebFeedDeps & { at?: number; cachedOnly?: boolean; onPage?: (page: Fetched) => void } = {}): Promise<FeedCacheEntry> {
  const cache = deps.cache ?? defaultFeedCache();
  const now = deps.at ?? Date.now();
  const cached = await cache.get(url);
  if (cached && (now < cached.nextFetchAt || cached.gone || deps.cachedOnly)) return cached;
  if (!cached && deps.cachedOnly) return { url, fetchedAt: 0, nextFetchAt: 0, failures: 0, status: 0, error: 'Not read yet.' };
  const conditional: Record<string, string> = { accept: feedAccept };
  if (cached?.feed && cached.etag) conditional['if-none-match'] = cached.etag;
  if (cached?.feed && cached.lastModified) conditional['if-modified-since'] = cached.lastModified;
  const response = await fetchChecked(url, deps, feedLimitBytes, conditional);
  const failed = (status: number, error: string, retryAfter?: string | null): FeedCacheEntry => {
    const failures = (cached?.failures ?? 0) + 1;
    return { ...cached, url, fetchedAt: cached?.fetchedAt ?? now, nextFetchAt: backoffTime(failures, now, retryAfter), failures, status, error };
  };
  let entry: FeedCacheEntry;
  if (!response) entry = failed(0, 'The feed couldn’t be reached.');
  else if (response.status === 304 && cached?.feed) entry = { ...cached, fetchedAt: now, nextFetchAt: nextFetchTime(cached.feed, response.headers, now), failures: 0, status: 304, error: undefined };
  else if (response.status === 410) entry = { url, fetchedAt: now, nextFetchAt: now + maxRefreshMinutes * minute, failures: 0, status: 410, gone: true, error: 'The publisher has removed this feed.' };
  else if (response.status === 429 || response.status === 503) entry = failed(response.status, 'The publisher asked Open Media to wait before reading again.', response.headers.get('retry-after'));
  else if (response.status >= 400) entry = failed(response.status, `The feed answered ${response.status}.`);
  else {
    try {
      const feed = parseWebFeed(response.text, response.url);
      entry = {
        url, fetchedAt: now, nextFetchAt: nextFetchTime(feed, response.headers, now), failures: 0, status: response.status, feed,
        ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
        ...(response.headers.get('last-modified') ? { lastModified: response.headers.get('last-modified')! } : {}),
        ...(response.movedPermanently ? { movedTo: response.url } : {}),
      };
    } catch (error) {
      // A web page rather than a feed: handed back for autodiscovery, so it is not fetched twice.
      deps.onPage?.(response);
      entry = failed(response.status, error instanceof WebFeedError ? error.message : 'The feed couldn’t be read.');
    }
  }
  await cache.put(entry);
  return entry;
}

// ---------- finding a site's feed ----------

/** The address a person typed or pasted, as a clean https URL. */
export function feedInputUrl(raw: unknown): URL {
  let text = typeof raw === 'string' ? raw.trim() : '';
  text = text.replace(/^(feed|rss|webcal):\/\//i, 'https://').replace(/^feed:/i, '');
  if (!text || text.length > 2048) throw new WebFeedApiError(400, 'Give a site or feed address, like theverge.com or https://example.com/feed.xml.');
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); }
  catch { throw new WebFeedApiError(400, 'That isn’t a web address. Try something like theverge.com.'); }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new WebFeedApiError(400, 'Only https:// feeds can be followed.');
  if (url.username || url.password) throw new WebFeedApiError(400, 'Leave the user name and password out of the address.');
  if (url.port && url.port !== '443') throw new WebFeedApiError(400, 'Only feeds on the normal https port can be followed.');
  if (!url.hostname.includes('.')) throw new WebFeedApiError(400, 'Give a full site address, like theverge.com.');
  url.hash = '';
  return url;
}

export interface FoundFeed {
  url: string;
  title: string;
  siteUrl?: string;
  iconUrl?: string;
  entry: FeedCacheEntry & { feed: ParsedWebFeed };
  /** Other feeds the page named, for agents to offer. */
  alternatives: DiscoveredFeed[];
}

/**
 * The feed behind an address: the address itself when it is a feed, otherwise the feeds its page
 * names (autodiscovery), otherwise the usual feed paths. robots.txt is obeyed for the page.
 */
export async function findWebFeed(raw: unknown, deps: WebFeedDeps & { at?: number } = {}): Promise<FoundFeed> {
  const start = feedInputUrl(raw);
  const cache = deps.cache ?? defaultFeedCache();
  const now = deps.at ?? Date.now();
  const tryFeed = async (url: string) => {
    const entry = await readFeed(url, { ...deps, cache, at: now });
    return entry.feed ? entry as FeedCacheEntry & { feed: ParsedWebFeed } : undefined;
  };
  const finish = (url: string, entry: FeedCacheEntry & { feed: ParsedWebFeed }, page: { iconUrl?: string; siteUrl?: string; title?: string } = {}, alternatives: DiscoveredFeed[] = []): FoundFeed => {
    const siteUrl = entry.feed.siteUrl ?? page.siteUrl;
    const host = hostOf(siteUrl ?? url);
    return {
      url: entry.movedTo ?? url, title: officialPublisher(url)?.name ?? entry.feed.title ?? page.title ?? host ?? url, ...(siteUrl ? { siteUrl } : {}),
      // The site's own icon reads best at favicon size; a feed's logo is often a wide banner.
      iconUrl: page.iconUrl ?? (host ? `https://${new URL(siteUrl ?? url).hostname}/favicon.ico` : entry.feed.iconUrl),
      entry, alternatives,
    };
  };

  // A listed news outlet's home page that names no feed (bbc.co.uk among them), is unreachable or
  // asks programs not to read it still leads to the outlet's official feed.
  const listed = async (info: { iconUrl?: string; siteUrl?: string; title?: string } = {}) => {
    const feed = directoryFeedForSite(start.toString());
    const entry = feed ? await tryFeed(feed.url) : undefined;
    return feed && entry ? finish(feed.url, entry, { siteUrl: start.toString(), ...info }) : undefined;
  };

  // The address itself, read as a feed; when it is a page instead, that page is kept for discovery.
  let page: Fetched | undefined;
  const direct = await readFeed(start.toString(), { ...deps, cache, at: now, onPage: (fetched) => { page = fetched; } });
  if (direct.feed) return finish(start.toString(), direct as FeedCacheEntry & { feed: ParsedWebFeed });
  page ??= await fetchChecked(start.toString(), deps, pageLimitBytes, { accept: 'text/html,application/xhtml+xml' });
  if (!page || page.status >= 400) { const fallback = await listed(); if (fallback) return fallback; }
  if (!page) throw new WebFeedApiError(400, `${start.hostname} couldn’t be reached. Only public https sites can be followed.`);
  if (page.status >= 400) throw new WebFeedApiError(400, `${start.hostname} answered ${page.status}. Check the address.`);
  const robotsPage = await fetchChecked(new URL('/robots.txt', page.url).toString(), deps, 100_000, { accept: 'text/plain' });
  const robots = robotsPage && robotsPage.status === 200 && !/<html/i.test(robotsPage.text) ? robotsPage.text : '';
  const pageUrl = new URL(page.url);
  if (!robotsAllows(robots, feedReaderToken, pageUrl.pathname + pageUrl.search)) {
    const fallback = await listed();
    if (fallback) return fallback;
    throw new WebFeedApiError(403, `${pageUrl.hostname}’s robots.txt asks programs like Open Media’s not to read that page. If you know the feed’s own address, paste that instead.`);
  }
  const found = discoverWebFeeds(page.text, page.url);
  const info = { iconUrl: found.iconUrl, siteUrl: page.url, title: found.title };
  for (const candidate of found.feeds.slice(0, 3)) {
    const entry = await tryFeed(candidate.url);
    if (entry) return finish(candidate.url, entry, info, found.feeds.filter((feed) => feed.url !== candidate.url));
  }
  if (!found.feeds.length) {
    for (const candidate of commonFeedPaths(page.url)) {
      const candidatePath = new URL(candidate);
      if (!robotsAllows(robots, feedReaderToken, candidatePath.pathname)) continue;
      const entry = await tryFeed(candidate);
      if (entry) return finish(candidate, entry, info);
    }
  }
  const fallback = await listed(info);
  if (fallback) return fallback;
  throw new WebFeedApiError(404, `${pageUrl.hostname} doesn’t publish a web feed that Open Media could find. If the site has one, paste the feed’s own address.`);
}

/** What agents and Search see before following: the feed, its format and newest items. */
export function feedPreview(found: FoundFeed) {
  const { feed } = found.entry;
  const official = officialPublisher(found.url);
  return {
    feedUrl: found.url, title: found.title, siteUrl: found.siteUrl ?? null, iconUrl: found.iconUrl ?? null,
    format: formatNames[feed.format], description: feed.description ?? null, language: feed.language ?? null, rights: feed.rights ?? null,
    official: official ? { name: official.name, domain: official.domain } : null,
    websubHub: feed.hubUrl ?? null,
    readEveryMinutes: Math.round((found.entry.nextFetchAt - found.entry.fetchedAt) / minute),
    items: feed.items.slice(0, 5).map((item) => ({ title: item.title, url: item.url ?? null, publishedAt: item.publishedAt ?? null, excerpt: item.excerpt, ...(item.alert ? { alert: item.alert } : {}) })),
    otherFeeds: found.alternatives.slice(0, 5),
  };
}

// ---------- the person's subscriptions ----------

export interface SubscriptionRow { id: string; feed_url: string; title: string; site_url: string | null; icon_url: string | null; created_at: string }

export type Rest = <T>(method: string, path: string, body?: unknown, prefer?: string) => Promise<T>;

const table = '/rest/v1/web_feed_subscriptions';
const columns = 'id,feed_url,title,site_url,icon_url,created_at';

function subscriptionView(row: SubscriptionRow) {
  const official = officialPublisher(row.feed_url);
  return { id: row.id, url: row.feed_url, title: row.title, siteUrl: row.site_url, iconUrl: row.icon_url, official: official ? { name: official.name, domain: official.domain } : null, addedAt: row.created_at };
}

/** Web feeds for one signed-in person, read and written with their own token (RLS applies). */
export class WebFeedAccount {
  constructor(private readonly rest: Rest, private readonly deps: WebFeedDeps & { clock?: () => number } = {}) {}

  private rows() { return this.rest<SubscriptionRow[]>('GET', `${table}?select=${columns}&order=created_at.desc&limit=${maxSubscriptions}`); }

  async list() {
    const rows = await this.rows();
    return { feeds: rows.map(subscriptionView), limit: maxSubscriptions };
  }

  async follow(body: Record<string, unknown>) {
    const found = await findWebFeed(body.url, this.deps);
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : found.title.slice(0, 200);
    // Following twice keeps the first row: the address of a followed feed never changes (RLS grants no update of it).
    await this.rest('POST', `${table}?on_conflict=user_id,feed_url`, { feed_url: found.url, title, site_url: found.siteUrl ?? null, icon_url: found.iconUrl ?? null }, 'resolution=ignore-duplicates,return=minimal');
    const [row] = await this.rest<SubscriptionRow[]>('GET', `${table}?select=${columns}&feed_url=eq.${encodeURIComponent(found.url)}`);
    return { followed: subscriptionView(row), preview: feedPreview(found), note: 'Its newest items are in the person’s Feed now. Each card shows the headline, a short excerpt and a link to the publisher.' };
  }

  /** By id, feed address, or a site's host ("theverge.com"). */
  async unfollow(target: unknown) {
    const text = typeof target === 'string' ? target.trim() : '';
    if (!text) throw new WebFeedApiError(400, 'Say which feed: its address, its site (theverge.com) or its id from list_web_feeds.');
    const rows = await this.rows();
    const host = hostOf(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const matches = rows.filter((row) => row.id === text || row.feed_url === text || (host && [hostOf(row.feed_url), hostOf(row.site_url ?? undefined)].some((name) => name === host || name?.endsWith(`.${host}`))) || row.title.toLocaleLowerCase() === text.toLocaleLowerCase());
    if (!matches.length) throw new WebFeedApiError(404, `You don’t follow a web feed matching “${text}”.`);
    for (const row of matches) await this.rest('DELETE', `${table}?id=eq.${row.id}`);
    return { unfollowed: matches.map(subscriptionView) };
  }

  /** Newest items from every followed feed as posts; feeds that are due are read again first. */
  async items(options: { limit?: number } = {}) {
    const rows = await this.rows();
    const now = this.deps.clock?.() ?? Date.now();
    const cache = this.deps.cache ?? defaultFeedCache();
    const entries: FeedCacheEntry[] = new Array(rows.length);
    let refreshed = 0;
    // A few at a time, oldest-read first, so a person with many feeds never fans out at once.
    const queue = rows.map((row, index) => ({ row, index }));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const cached = await cache.get(next.row.feed_url);
        const due = !cached || now >= cached.nextFetchAt;
        const cachedOnly = due && refreshed >= refreshesPerRequest;
        if (due && !cachedOnly) refreshed += 1;
        entries[next.index] = await readFeed(next.row.feed_url, { ...this.deps, cache, at: now, cachedOnly });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const oldest = now - maxItemAgeDays * 24 * 60 * minute;
    const posts: SocialPost[] = [];
    rows.forEach((row, index) => {
      const entry = entries[index];
      if (!entry?.feed) return;
      const refreshMinutes = Math.max(minRefreshMinutes, Math.round((entry.nextFetchAt - entry.fetchedAt) / minute));
      for (const item of entry.feed.items) {
        const post = socialPostFromFeedItem({ url: row.feed_url, title: row.title, siteUrl: row.site_url ?? undefined, iconUrl: row.icon_url ?? undefined, parsed: entry.feed, refreshMinutes }, item, now);
        if (Date.parse(post.createdAt) >= oldest) posts.push(post);
      }
    });
    posts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const limit = Math.min(300, Math.max(1, options.limit ?? 150));
    return {
      posts: posts.slice(0, limit),
      feeds: rows.map((row, index) => ({ url: row.feed_url, title: row.title, status: entries[index]?.status ?? 0, error: entries[index]?.error ?? null, gone: Boolean(entries[index]?.gone), movedTo: entries[index]?.movedTo ?? null, readAt: entries[index]?.fetchedAt ? new Date(entries[index].fetchedAt).toISOString() : null })),
    };
  }

  /** Adds the feeds in an OPML file without reading them; each loads with the Feed. */
  async importOpml(body: Record<string, unknown>) {
    const text = typeof body.opml === 'string' ? body.opml : '';
    if (!text.trim()) throw new WebFeedApiError(400, 'Send opml: the text of an OPML file exported from a feed reader.');
    let outlines;
    try { outlines = parseOpml(text); } catch (error) { throw new WebFeedApiError(400, error instanceof WebFeedError ? error.message : 'That OPML file couldn’t be read.'); }
    const existing = new Set((await this.rows()).map((row) => row.feed_url));
    const added: string[] = []; const skipped: { url: string; reason: string }[] = [];
    let room = maxSubscriptions - existing.size;
    const fresh = [];
    for (const outline of outlines) {
      let url: string;
      try { url = feedInputUrl(outline.url).toString(); } catch (error) { skipped.push({ url: outline.url, reason: (error as Error).message }); continue; }
      if (existing.has(url)) { skipped.push({ url, reason: 'Already followed.' }); continue; }
      if (room <= 0) { skipped.push({ url, reason: `You can follow up to ${maxSubscriptions} feeds.` }); continue; }
      existing.add(url); room -= 1;
      const host = hostOf(outline.siteUrl ?? url);
      fresh.push({ feed_url: url, title: (outline.title ?? host ?? url).slice(0, 200), site_url: outline.siteUrl ?? null, icon_url: host ? `https://${new URL(outline.siteUrl ?? url).hostname}/favicon.ico` : null });
      added.push(url);
    }
    if (fresh.length) await this.rest('POST', `${table}?on_conflict=user_id,feed_url`, fresh, 'resolution=ignore-duplicates,return=minimal');
    return { added: added.length, skipped, note: added.length ? 'The new feeds load with the Feed; any that can’t be read are listed by list_web_feeds and get_web_feed_items.' : 'Nothing new to add.' };
  }

  async exportOpml(ownerName?: string) {
    const rows = await this.rows();
    return toOpml(rows.map((row) => ({ url: row.feed_url, title: row.title, ...(row.site_url ? { siteUrl: row.site_url } : {}) })), ownerName);
  }
}

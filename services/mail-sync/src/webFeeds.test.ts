import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { backoffTime, feedInputUrl, feedReaderAgent, findWebFeed, memoryFeedCache, nextFetchTime, readFeed, SubscriptionRow, WebFeedAccount, WebFeedApiError } from './webFeeds.js';
import { parseWebFeed } from '../../../src/domain/webFeeds';

const fixture = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'domain', 'fixtures', 'webFeeds', name), 'utf8');
const bbc = fixture('bbc.rss.xml');
const verge = fixture('verge.atom.xml');
const publicResolve = async () => ['93.184.216.34'];
const t0 = Date.parse('2026-11-03T06:00:00Z');
const minute = 60_000;

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function network(routes: Record<string, Handler>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value])) });
    const handler = routes[url];
    return handler ? handler(url, init) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls, resolve: publicResolve };
}

test('a feed is read with a clear user agent, then only conditionally, and only when due', async () => {
  const net = network({
    'https://feeds.bbci.co.uk/news/rss.xml': (_url, init) => {
      const headers = init.headers as Record<string, string>;
      return headers['if-none-match'] === '"v1"' ? new Response(null, { status: 304 }) : new Response(bbc, { headers: { etag: '"v1"', 'last-modified': 'Tue, 03 Nov 2026 05:00:00 GMT', 'content-type': 'text/xml; charset=utf-8' } });
    },
  });
  const cache = memoryFeedCache();
  const first = await readFeed('https://feeds.bbci.co.uk/news/rss.xml', { ...net, cache, at: t0 });
  assert.equal(first.feed?.title, 'BBC News');
  assert.equal(net.calls[0].headers['user-agent'], feedReaderAgent);
  assert.match(net.calls[0].headers.accept, /application\/feed\+json/);
  // BBC asks for a 15-minute ttl; Open Media never reads more often than every 30 minutes.
  assert.equal(first.nextFetchAt, t0 + 30 * minute);
  await readFeed('https://feeds.bbci.co.uk/news/rss.xml', { ...net, cache, at: t0 + 10 * minute });
  assert.equal(net.calls.length, 1, 'not due yet: served from the cache');
  const again = await readFeed('https://feeds.bbci.co.uk/news/rss.xml', { ...net, cache, at: t0 + 31 * minute });
  assert.equal(net.calls.length, 2);
  assert.equal(net.calls[1].headers['if-none-match'], '"v1"');
  assert.equal(net.calls[1].headers['if-modified-since'], 'Tue, 03 Nov 2026 05:00:00 GMT');
  assert.equal(again.status, 304);
  assert.equal(again.feed?.items.length, first.feed?.items.length, 'a 304 keeps the cached items');
});

test('failures back off, Retry-After is obeyed, and 410 marks a feed gone', async () => {
  let status = 503;
  const net = network({ 'https://example.com/feed': () => new Response('busy', { status, headers: { 'retry-after': '7200' } }) });
  const cache = memoryFeedCache();
  const busy = await readFeed('https://example.com/feed', { ...net, cache, at: t0 });
  assert.equal(busy.nextFetchAt, t0 + 120 * minute);
  assert.equal(busy.failures, 1);
  status = 410;
  const gone = await readFeed('https://example.com/feed', { ...net, cache, at: t0 + 121 * minute });
  assert.equal(gone.gone, true);
  assert.equal(backoffTime(1, t0), t0 + 30 * minute);
  assert.equal(backoffTime(3, t0), t0 + 120 * minute);
  assert.equal(backoffTime(20, t0), t0 + 24 * 60 * minute);
});

test('a feed that fails keeps its last good items', async () => {
  let up = true;
  const net = network({ 'https://www.theverge.com/rss/index.xml': () => up ? new Response(verge) : new Response('oops', { status: 500 }) });
  const cache = memoryFeedCache();
  await readFeed('https://www.theverge.com/rss/index.xml', { ...net, cache, at: t0 });
  up = false;
  const failed = await readFeed('https://www.theverge.com/rss/index.xml', { ...net, cache, at: t0 + 31 * minute });
  assert.equal(failed.status, 500);
  assert.equal(failed.feed?.items.length, 2);
});

test('ttl, max-age and skipHours set when a feed is read next', () => {
  const feed = parseWebFeed(bbc);
  assert.equal(nextFetchTime({ ...feed, ttlMinutes: 120 }, undefined, t0), t0 + 120 * minute);
  assert.equal(nextFetchTime(feed, new Headers({ 'cache-control': 'max-age=3600' }), t0), t0 + 60 * minute);
  assert.equal(nextFetchTime({ ...feed, ttlMinutes: 100_000 }, undefined, t0), t0 + 24 * 60 * minute);
  // 06:30 and 07:00 GMT are skipped, so the next read waits for 08:00.
  assert.equal(nextFetchTime({ ...feed, skipHours: [6, 7] }, undefined, t0), Date.parse('2026-11-03T08:00:00Z'));
});

test('addresses: https only, no credentials, no odd ports, feed: links accepted', () => {
  assert.equal(feedInputUrl('theverge.com').toString(), 'https://theverge.com/');
  assert.equal(feedInputUrl('feed://example.com/rss').toString(), 'https://example.com/rss');
  assert.equal(feedInputUrl('http://example.com/rss').protocol, 'https:');
  assert.throws(() => feedInputUrl('https://user:pw@example.com/feed'), WebFeedApiError);
  assert.throws(() => feedInputUrl('https://example.com:8443/feed'), WebFeedApiError);
  assert.throws(() => feedInputUrl('ftp://example.com/feed'), WebFeedApiError);
  assert.throws(() => feedInputUrl('localhost'), WebFeedApiError);
});

test('private addresses and unsafe redirects are never fetched', async () => {
  const net = network({ 'https://example.com/feed': () => new Response(null, { status: 302, headers: { location: 'https://internal.example/feed' } }) });
  const resolve = async (host: string) => (host === 'internal.example' ? ['10.0.0.5'] : ['93.184.216.34']);
  const entry = await readFeed('https://example.com/feed', { fetch: net.fetch, resolve, cache: memoryFeedCache(), at: t0 });
  assert.equal(entry.status, 0);
  assert.deepEqual(net.calls.map((call) => call.url), ['https://example.com/feed']);
  const local = await readFeed('https://router.local/feed', { fetch: net.fetch, resolve, cache: memoryFeedCache(), at: t0 });
  assert.equal(local.status, 0);
});

test('a permanent redirect moves the feed', async () => {
  const net = network({
    'https://old.example/feed': () => new Response(null, { status: 301, headers: { location: 'https://new.example/feed' } }),
    'https://new.example/feed': () => new Response(bbc),
  });
  const entry = await readFeed('https://old.example/feed', { ...net, cache: memoryFeedCache(), at: t0 });
  assert.equal(entry.movedTo, 'https://new.example/feed');
});

test('a site is followed through its autodiscovery link, after robots.txt allows it', async () => {
  const page = '<html><head><title>The Verge</title><link rel="alternate" type="application/atom+xml" href="/rss/index.xml"><link rel="apple-touch-icon" href="/icon.png"></head><body>hi</body></html>';
  const net = network({
    'https://www.theverge.com/': () => new Response(page, { headers: { 'content-type': 'text/html' } }),
    'https://www.theverge.com/robots.txt': () => new Response('User-agent: *\nDisallow: /search'),
    'https://www.theverge.com/rss/index.xml': () => new Response(verge),
  });
  const found = await findWebFeed('www.theverge.com', { ...net, cache: memoryFeedCache(), at: t0 });
  assert.equal(found.url, 'https://www.theverge.com/rss/index.xml');
  assert.equal(found.title, 'The Verge');
  assert.equal(found.iconUrl, 'https://www.theverge.com/icon.png');
  assert.equal(net.calls.filter((call) => call.url === 'https://www.theverge.com/').length, 1, 'the page is fetched once');
});

test('robots.txt that disallows the page stops discovery; a pasted feed address is read directly', async () => {
  const net = network({
    'https://blog.example/': () => new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head></html>'),
    'https://blog.example/robots.txt': () => new Response('User-agent: OpenMediaFeedReader\nDisallow: /'),
    'https://blog.example/feed': () => new Response(bbc),
  });
  await assert.rejects(findWebFeed('blog.example', { ...net, cache: memoryFeedCache(), at: t0 }), (error: WebFeedApiError) => error.status === 403);
  const direct = await findWebFeed('https://blog.example/feed', { ...net, cache: memoryFeedCache(), at: t0 });
  assert.equal(direct.title, 'BBC News');
});

test('a site without a feed says so plainly', async () => {
  const net = network({ 'https://nofeed.example/': () => new Response('<html><head><title>x</title></head></html>') });
  await assert.rejects(findWebFeed('nofeed.example', { ...net, cache: memoryFeedCache(), at: t0 }), /doesn’t publish a web feed/);
});

test('the person’s feeds: follow, items as posts, unfollow by site, OPML in and out', async () => {
  const rows: SubscriptionRow[] = [];
  const rest = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    if (method === 'GET') { const url = path.match(/feed_url=eq\.([^&]+)/)?.[1]; return (url ? rows.filter((row) => row.feed_url === decodeURIComponent(url)) : rows) as T; }
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]) as Omit<SubscriptionRow, 'id' | 'created_at'>[];
      const added = list.filter((item) => !rows.some((row) => row.feed_url === item.feed_url)).map((item, index) => ({ ...item, id: `id-${rows.length + index}`, created_at: new Date(t0).toISOString() }));
      rows.push(...added);
      return added as T;
    }
    if (method === 'DELETE') { const id = path.match(/id=eq\.(.+)$/)![1]; rows.splice(rows.findIndex((row) => row.id === id), 1); return null as T; }
    throw new Error(method);
  };
  const net = network({ 'https://feeds.bbci.co.uk/news/rss.xml': () => new Response(bbc) });
  const account = new WebFeedAccount(rest, { ...net, cache: memoryFeedCache(), clock: () => t0 });
  const followed = await account.follow({ url: 'https://feeds.bbci.co.uk/news/rss.xml' });
  assert.equal(followed.followed.title, 'BBC News');
  assert.deepEqual(followed.followed.official, { name: 'BBC News', domain: 'bbci.co.uk' });
  const items = await account.items();
  assert.ok(items.posts.length > 0);
  assert.equal(items.posts[0].provenance.connectorId, 'rss');
  assert.equal(items.posts[0].webFeed?.refreshMinutes, 30);
  assert.equal(items.feeds[0].status, 200);
  const opml = await account.exportOpml('Asha');
  assert.match(opml, /xmlUrl="https:\/\/feeds\.bbci\.co\.uk\/news\/rss\.xml"/);
  const imported = await account.importOpml({ opml: '<opml version="2.0"><body><outline type="rss" text="Verge" xmlUrl="https://www.theverge.com/rss/index.xml"/><outline type="rss" text="Old" xmlUrl="http://old.example/rss"/><outline type="rss" text="BBC" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml"/></body></opml>' });
  assert.equal(imported.added, 2, 'the http feed is upgraded to https; BBC was already followed');
  assert.equal(imported.skipped.length, 1);
  const removed = await account.unfollow('bbc.co.uk');
  assert.equal(removed.unfollowed[0].url, 'https://feeds.bbci.co.uk/news/rss.xml');
  await assert.rejects(account.unfollow('nothing.example'), /don’t follow/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { lensFromRequest, parseLens, runLens, tuneLens, relevantLens, explainLensPost } from './feedLenses';
import { directoryFeeds, officialPublisher, searchWebFeedDirectory } from './webFeedDirectory';
import { clip, discoverWebFeeds, feedDate, htmlToText, parseOpml, parseWebFeed, parseXml, socialPostFromFeedItem, toOpml, WebFeedError } from './webFeeds';

// Real feeds fetched on 2026-11-02, cut to their first two items.
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'webFeeds', name), 'utf8');

test('Atom: The Verge, with HTML titles, summaries and inline content images', () => {
  const feed = parseWebFeed(fixture('verge.atom.xml'), 'https://www.theverge.com/rss/index.xml');
  assert.equal(feed.format, 'atom');
  assert.equal(feed.title, 'The Verge');
  assert.equal(feed.siteUrl, 'https://www.theverge.com/');
  assert.match(feed.iconUrl!, /^https:\/\/platform\.theverge\.com\//);
  assert.equal(feed.items.length, 2);
  const [item] = feed.items;
  assert.equal(item.title, 'Apple is ‘not able to predict’ when it’ll have enough iPhone Duos to go around');
  assert.equal(item.url, 'https://www.theverge.com/tech/1024915/apple-iphone-duo-supply-chain-constraints');
  assert.equal(item.author, 'Emma Roth');
  assert.equal(item.publishedAt, '2026-11-02T22:56:11.000Z');
  assert.ok(item.excerpt.startsWith('Apple CEO John Ternus doesn\'t have a timeline'));
  assert.ok(item.excerpt.length <= 280 && !item.excerpt.includes('​') && !item.excerpt.includes('[…]'));
  assert.match(item.imageUrl!, /^https:\/\/platform\.theverge\.com\/.*iPhone_Duo/);
  assert.equal(item.imageAlt, 'The front of an iPhone Duo, partially folded.');
  assert.ok(item.categories.includes('Apple'));
});

test('RSS 2.0: BBC News with Media RSS thumbnails, ttl and a rights line', () => {
  const feed = parseWebFeed(fixture('bbc.rss.xml'), 'https://feeds.bbci.co.uk/news/rss.xml');
  assert.equal(feed.format, 'rss');
  assert.equal(feed.title, 'BBC News');
  assert.equal(feed.ttlMinutes, 15);
  assert.match(feed.rights!, /British Broadcasting Corporation/);
  assert.equal(feed.selfUrl, 'https://feeds.bbci.co.uk/news/rss.xml');
  const item = feed.items.find((entry) => entry.title.startsWith('UK and EU agree'))!;
  assert.equal(item.id, 'https://www.bbc.co.uk/news/articles/cmp3grwre9xdo#1');
  assert.match(item.url!, /^https:\/\/www\.bbc\.co\.uk\/news\/articles\/cmp3grwre9xdo/);
  assert.match(item.imageUrl!, /^https:\/\/ichef\.bbci\.co\.uk\//);
  assert.equal(item.publishedAt, '2026-11-03T02:11:13.000Z');
});

test('RSS 2.0: NPR’s content:encoded gives the image, and its tracking pixel is dropped', () => {
  const feed = parseWebFeed(fixture('npr.rss.xml'), 'https://feeds.npr.org/1001/rss.xml');
  assert.equal(feed.rights, 'Copyright 2024 NPR - For Personal Use Only');
  for (const item of feed.items) assert.ok(!item.imageUrl?.includes('npr-rss-pixel'));
  const item = feed.items.find((entry) => entry.title.startsWith('AI chatbots'))!;
  assert.match(item.imageUrl!, /^https:\/\/npr\.brightspotcdn\.com\//);
  assert.ok(item.excerpt.startsWith('Millions of Americans'));
});

test('RSS 1.0 (RDF): DW', () => {
  const feed = parseWebFeed(fixture('dw.rdf.xml'), 'https://rss.dw.com/rdf/rss-en-all');
  assert.equal(feed.format, 'rdf');
  assert.ok(feed.title.length > 0);
  assert.equal(feed.items.length, 2);
  assert.ok(feed.items.every((item) => item.url?.startsWith('https://') && item.publishedAt));
});

test('RSS with CDATA links and empty dates (The Hindu) still reads', () => {
  const feed = parseWebFeed(fixture('hindu.rss.xml'), 'https://www.thehindu.com/news/feeder/default.rss');
  assert.equal(feed.items[0].url?.startsWith('https://www.thehindu.com/'), true);
});

test('RSS from the Google blog: Media RSS images and an Atom-style author', () => {
  const feed = parseWebFeed(fixture('googleblog.rss.xml'));
  const item = feed.items.find((entry) => entry.title.startsWith('Working collaboratively'))!;
  assert.equal(item.author, 'Snigdha Bhardwaj');
  assert.match(item.imageUrl!, /^https:\/\/storage\.googleapis\.com\//);
  assert.match(item.imageAlt!, /smartphone/);
  assert.equal(item.excerpt, 'Google combines built-in protections with local partnerships and education to tackle scams in APAC.');
});

test('Weather: NWS alerts carry CAP severity, area and expiry', () => {
  const feed = parseWebFeed(fixture('nws.atom.xml'), 'https://api.weather.gov/alerts/active.atom?area=CA');
  const beach = feed.items.find((item) => item.alert?.event === 'Beach Hazards Statement')!;
  assert.deepEqual({ severity: beach.alert!.severity, expires: beach.alert!.expires }, { severity: 'moderate', expires: '2026-11-03T17:00:00.000Z' });
  assert.match(beach.alert!.area!, /Coastal Del Norte/);
  assert.match(beach.excerpt, /^What: Increased threat of sneaker waves expected\. Where: Coastal Del Norte/);
});

test('Weather: Met Office warnings read their colour level from the title', () => {
  const feed = parseWebFeed(fixture('metoffice.rss.xml'), 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK');
  const [warning] = feed.items;
  assert.deepEqual(warning.alert, { event: 'Yellow warning: Fog', level: 'yellow', severity: 'moderate', area: 'Northern Ireland' });
  assert.equal(warning.publishedAt, undefined);
  assert.equal(feed.updatedAt, '2026-11-03T03:48:11.000Z');
  assert.match(warning.imageUrl!, /yellow-fog\.png$/);
});

test('JSON Feed', () => {
  const feed = parseWebFeed(fixture('jsonfeed.json'), 'https://www.jsonfeed.org/feed.json');
  assert.equal(feed.format, 'json');
  assert.equal(feed.title, 'JSON Feed');
  assert.equal(feed.items[0].title, 'JSON Feed version 1.1');
  assert.match(feed.items[0].excerpt, /^We’ve updated the spec to version 1\.1/);
});

test('the XML reader never expands DTD entities and treats markup as text', () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss version="2.0"><channel><title>T &b; &xxe;</title><item><title>&lt;script&gt;alert(1)&lt;/script&gt;Hi</title><link>javascript:alert(1)</link><description>&lt;img src="https://example.com/1x1.gif" width="1" height="1"&gt;&lt;iframe src="https://evil.example"&gt;&lt;/iframe&gt;Safe text</description></item></channel></rss>`;
  const feed = parseWebFeed(bomb, 'https://example.com/feed');
  assert.equal(feed.title, 'T &b; &xxe;');
  const [item] = feed.items;
  assert.equal(item.title, 'Hi');
  assert.equal(item.url, undefined);
  assert.equal(item.imageUrl, undefined);
  assert.equal(item.excerpt, 'Safe text');
});

test('not a feed: HTML pages and other JSON are refused clearly', () => {
  assert.throws(() => parseWebFeed('<!doctype html><html><head></head></html>'), WebFeedError);
  assert.throws(() => parseWebFeed('{"hello":1}'), /JSON Feed/);
  assert.equal(parseXml('<a><b>1</a>').children.length, 1);
});

test('dates, excerpts and boilerplate', () => {
  assert.equal(feedDate('Mon, 02 Nov 2026 05:45:00 EST'), '2026-11-02T10:45:00.000Z');
  assert.equal(feedDate('nonsense'), undefined);
  assert.equal(clip('one two three four', 12), 'one two…');
  assert.equal(htmlToText('<p>A&nbsp;b</p><script>x()</script><p>c &amp; d</p>'), 'A b c & d');
  const feed = parseWebFeed('<rss version="2.0"><channel><title>Blog</title><item><title>Post</title><description>&lt;p&gt;Body.&lt;/p&gt;&lt;p&gt;The post Post appeared first on Blog.&lt;/p&gt;</description></item></channel></rss>');
  assert.equal(feed.items[0].excerpt, 'Body.');
});

test('autodiscovery finds feeds and the site icon in a page', () => {
  const html = `<html><head><title>Example &amp; Co</title><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"><link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed"><link rel="alternate" type="application/feed+json" href="https://example.com/feed.json"><link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/touch.png"></head></html>`;
  const found = discoverWebFeeds(html, 'https://example.com/blog/');
  assert.deepEqual(found.feeds.map((feed) => feed.url), ['https://example.com/feed.xml', 'https://example.com/feed.json']);
  assert.equal(found.iconUrl, 'https://example.com/touch.png');
  assert.equal(found.title, 'Example & Co');
});

test('OPML round trip, folders flattened', () => {
  const opml = `<?xml version="1.0"?><opml version="2.0"><head><title>x</title></head><body><outline text="News"><outline type="rss" text="BBC" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml" htmlUrl="https://www.bbc.co.uk/news"/></outline><outline type="rss" title="Verge" xmlUrl="https://www.theverge.com/rss/index.xml"/></body></opml>`;
  const feeds = parseOpml(opml);
  assert.deepEqual(feeds, [{ url: 'https://feeds.bbci.co.uk/news/rss.xml', title: 'BBC', siteUrl: 'https://www.bbc.co.uk/news' }, { url: 'https://www.theverge.com/rss/index.xml', title: 'Verge' }]);
  const written = toOpml(feeds.map((feed) => ({ ...feed, title: feed.title! })), 'Asha & Co');
  assert.deepEqual(parseOpml(written), feeds);
  assert.match(written, /Asha &amp; Co/);
  assert.throws(() => parseOpml('<html></html>'), /OPML/);
});

test('official publishers are matched by their own domains only', () => {
  assert.equal(officialPublisher('https://feeds.bbci.co.uk/news/rss.xml')?.name, 'BBC News');
  assert.equal(officialPublisher('https://feeds.bbci.co.uk/news/rss.xml')?.domain, 'bbci.co.uk');
  assert.equal(officialPublisher('https://api.weather.gov/alerts/active.atom?area=CA')?.name, 'National Weather Service');
  assert.equal(officialPublisher('https://notbbc.co.uk/feed'), undefined);
  assert.equal(officialPublisher('https://bbc.co.uk.evil.example/feed'), undefined);
  assert.equal(officialPublisher('http://feeds.bbci.co.uk/news/rss.xml'), undefined);
  assert.equal(officialPublisher('https://feeds.feedburner.com/ndtvnews-top-stories'), undefined);
  for (const feed of directoryFeeds) assert.ok(officialPublisher(feed.url)?.id === feed.publisher, feed.url);
});

test('the directory answers outlets, places and weather, and leaves ordinary searches alone', () => {
  assert.equal(searchWebFeedDirectory('bbc')[0].publisherName, 'BBC News');
  assert.equal(searchWebFeedDirectory('the hindu')[0].publisherName, 'The Hindu');
  assert.ok(searchWebFeedDirectory('news india').slice(0, 5).every((feed) => ['toi', 'hindu', 'ht', 'indian-express', 'mint'].includes(feed.publisher)));
  assert.equal(searchWebFeedDirectory('weather california')[0].url, 'https://api.weather.gov/alerts/active.atom?area=CA');
  assert.equal(searchWebFeedDirectory('weather uk')[0].publisher, 'metoffice');
  assert.ok(searchWebFeedDirectory('news').length > 0);
  assert.deepEqual(searchWebFeedDirectory('india'), []);
  assert.deepEqual(searchWebFeedDirectory('videos about cooking'), []);
});

test('feed items become posts that lenses can keep, hide and boost', () => {
  const parsed = parseWebFeed(fixture('bbc.rss.xml'), 'https://feeds.bbci.co.uk/news/rss.xml');
  const now = Date.parse('2026-11-03T06:00:00Z');
  const posts = parsed.items.map((item) => socialPostFromFeedItem({ url: 'https://feeds.bbci.co.uk/news/rss.xml', title: parsed.title, siteUrl: 'https://www.bbc.co.uk/news', parsed, refreshMinutes: 30 }, item, now));
  const [post] = posts;
  assert.equal(post.provenance.connectorId, 'rss');
  assert.equal(post.author.handle, 'bbc.co.uk');
  assert.deepEqual(post.webFeed?.official, { name: 'BBC News', domain: 'bbci.co.uk' });
  assert.equal(post.author.verified, undefined);
  assert.ok(post.id.startsWith('rss:'));
  assert.equal(posts[0].id, socialPostFromFeedItem({ url: 'https://feeds.bbci.co.uk/news/rss.xml', title: parsed.title, parsed, refreshMinutes: 30 }, parsed.items[0], now).id);

  const onlyFeeds = lensFromRequest('only web feeds').lens;
  assert.deepEqual(onlyFeeds.filters.sources, ['rss']);
  assert.equal(runLens(posts, onlyFeeds, { now }).length, posts.length);
  assert.equal(runLens(posts, lensFromRequest('no rss').lens, { now }).length, 0);
  const tuned = tuneLens(relevantLens, 'less from @bbc.co.uk');
  assert.equal(tuned.lens.boosts?.[0]?.author, 'bbc.co.uk');
  parseLens({ ...relevantLens, id: 'x', builtIn: false, filters: { sources: ['rss'] } });
  const why = explainLensPost(post, relevantLens, { now });
  assert.ok(why.used.includes('You follow this web feed'));
});

# ADR 0024: Web feeds (RSS, Atom, JSON Feed) in the Feed

- Status: **accepted, built and verified on the web locally** (2026-11-02). Not deployed. Migration `20261112120000_web_feed_subscriptions.sql` is applied only to the local database. iOS and Android are not yet tested.
- Builds on: [ADR 0001](0001-canonical-post-and-capability-connectors.md) (canonical post, connectors), [ADR 0010](0010-universal-search.md) (Search), [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents), [ADR 0017](0017-feed-lenses.md) and [ADR 0021](0021-your-own-feed-algorithm.md) (lenses), [ADR 0020](0020-profile-import-linkedin-and-portfolio.md) (polite, SSRF-safe fetching)
- Master builder prompt: 4.1 (everything together), 4.3 (not locked in), 12 (official protocols, never scraping), 15 (content first), 23–26 (your feed, lenses, "Why this?"). Owner rule: no new buttons or screens.

## Context

The owner asked for blogs, news sites, weather and similar sources to appear directly in the Feed, in the most standards-compliant way, with a beautiful design.

Web feeds are the web's own open publishing protocol: sites publish them on purpose so readers can follow them. Three formats are in use, and all three were seen on 2026-11-02 in feeds we fetched:

- **RSS 2.0** (RSS Advisory Board 2.0.11): BBC News, NPR, the Google blog, Met Office weather warnings. Extensions in use: `content:encoded`, Media RSS (`media:content`, `media:thumbnail`), Dublin Core, `enclosure`, and Apple's `itunes:` and Podcasting 2.0's `podcast:` namespaces for podcasts.
- **Atom 1.0** (RFC 4287): The Verge, Daring Fireball, Simon Willison's blog, and the US National Weather Service's alerts, which carry **CAP 1.2** (OASIS Common Alerting Protocol) fields: event, severity, urgency, certainty, area and expiry.
- **JSON Feed 1.1** (jsonfeed.org, `application/feed+json`).

The research summary (discovery, OPML, conditional GET, WebSub, SSRF, XML attacks, copyright and how Reeder, NetNewsWire, Feedly, Readwise Reader and Artifact present items) is condensed into the decisions below.

## Decision

### 1. One parser for all three formats, in the shared domain

`src/domain/webFeeds.ts` is pure TypeScript, used by the Worker and tested in the app's suite:

- A small XML reader that runs nothing and **never expands a DTD or custom entity** (no XXE, no "billion laughs"); it knows the five XML entities and numeric references only. Namespaces are matched by their URI, not by prefix.
- `parseWebFeed(text)` detects RSS 2.0/0.9x, RSS 1.0 (RDF), Atom and JSON Feed and returns one shape: feed title, home page, icon, language, rights line, `ttl`, `skipHours`, `skipDays`, WebSub hub, and items with id, link, title, excerpt, lead image, author, dates, categories, an audio enclosure, and CAP alert fields.
- **Feed HTML is never rendered.** It becomes a plain-text excerpt of at most 280 characters (the publisher's own summary first, the article only when there is no summary). At most one https lead image is kept, from Media RSS, an image enclosure, JSON Feed's `image`, Atom's enclosure link or the first real image in the article; 1×1 images and tracking pixels (NPR's `npr-rss-pixel.png`, for example) are dropped. Links must be http(s); `javascript:` and data URLs are dropped. Relative links resolve against `xml:base` and the feed's address.
- `discoverWebFeeds(html, pageUrl)` reads `<link rel="alternate">` autodiscovery links for the three MIME types; well-known paths (`/feed`, `/rss.xml`, `/atom.xml`, `/index.xml`, `/feed.json`, Blogger's `/feeds/posts/default`) are tried only when a page names none.
- `parseOpml` and `toOpml` read and write OPML 2.0 (`outline type="rss" xmlUrl htmlUrl`, folders flattened), so people bring their subscriptions from any reader and take them anywhere.
- `socialPostFromFeedItem` turns an item into the canonical `SocialPost` with `provenance.connectorId = 'rss'`, the site as author (`handle` is the site's host, so lenses can name it), and a `webFeed` block for the card.

### 2. Polite fetching in the Worker

`services/mail-sync/src/webFeeds.ts` fetches and caches:

- **SSRF**: `fetchPublicPage` (ADR 0016/0020): https on port 443 only, no credentials, every DNS answer public, checked again after each of at most four redirects, an 8-second limit, and 2 MB per feed. The Worker also runs with Cloudflare's `global_fetch_strictly_public`.
- **User agent** `OpenMediaFeedReader/1.0 (+https://openmedia.site/docs/web-feeds)` and an `Accept` header naming the three feed types.
- **Conditional GET** (RFC 9110): `ETag` and `Last-Modified` are kept and sent back as `If-None-Match` and `If-Modified-Since`; a `304` only renews the cached copy.
- **How often**: at most every 30 minutes by default, longer when the feed's `ttl` or `Cache-Control: max-age` asks for it, never longer than 24 hours, and not during the feed's `skipHours`/`skipDays`. **Backoff**: `429` and `503` wait for `Retry-After`; other failures wait 30 minutes doubling to 24 hours. A `410 Gone` feed is reported as gone.
- **One fetch for everyone**: parsed feeds are cached in Cloudflare's Cache API (an in-memory map in local development) keyed by feed address, so a feed is read once per interval however many people follow it. At most 12 feeds are refreshed per request; the rest are served from cache and refreshed on the next request.
- **robots.txt** (RFC 9309) is obeyed when Open Media reads a site's **home page to find its feed**, under the token `OpenMediaFeedReader`. Fetching a feed the person chose to follow is a user agent acting for them (as feed readers and Google's Feedfetcher do), so robots.txt does not apply there. Open Media never crawls beyond the page and its named feed.
- **WebSub** (W3C Recommendation): the hub a feed names is recorded and shown to agents, but not subscribed to yet. Push needs a public callback, intent verification and lease renewal per feed; polling politely is enough for the first version.

### 3. Subscriptions are the person's own

Migration `20261112120000_web_feed_subscriptions.sql` adds `public.web_feed_subscriptions` (person, feed address, title, home page, icon, when added), unique per person and address. Row-level security is forced: people read, add, rename and remove only their own rows; anonymous visitors have no access. A trigger caps each person at 300 feeds, and checks keep addresses https and titles short. The Worker reads and writes the table with the person's own token, so RLS applies to agents too. Cached feed content is not stored in the database.

### 4. A source that lenses can filter and boost

- `LensSource` gains `'rss'` ("web feeds"). Lenses can keep only web feeds, hide them, or boost them ("more web feeds", "less web feeds"), and a single site by its host ("less from @theverge.com", "mute @example.com"), with the existing runner. Plain-words lens drafting understands "rss", "atom", "web feeds" and "blogs and news sites".
- "Why this?" for a feed item says which feed it came from, that the person follows it, the feed's address and format, how often Open Media reads it, and the publisher's rights line (for example NPR's "For Personal Use Only"). Nothing about the person is sent to the publisher except the request itself.
- Web feeds load only for signed-in people who follow at least one feed, and live updates check them at most every five minutes.

### 5. A card built for reading

`src/ui/WebFeedCard.tsx`, in the black-and-white, content-first style: the site's icon in a small rounded square, site name and time on one quiet line, a lead image, the headline, a three-line excerpt, then "Read on theverge.com ↗" and "Why this?". Feeds that publish only small thumbnails (BBC's are 240 pixels wide) show them beside the headline instead of stretched across the card. Bylines are left out when the site's name already holds the author's. The excerpt and the link to the original are the point: **Open Media shows a headline and a short excerpt and sends readers to the publisher; it never republishes full articles.**

- Weather alerts (CAP) lead with the severity in words ("MODERATE", "YELLOW WARNING") and the event name beside a thin bar, then "Until Tue 9:00 AM" and the area. The bar and label use the theme's `danger` colour for Extreme and Severe alerts and the text colour otherwise, so no new colour is introduced. NWS's "* WHAT...", "* WHERE..." text reads as "What: … Where: …".
- Podcast episodes show "Episode · 42 min"; the audio opens on the publisher's page.

### 6. Official news and weather feeds, with the blue tick

At the owner's request, `src/domain/webFeedDirectory.ts` lists the official feeds of major news outlets and public weather services: 41 outlets (among them BBC News, The Guardian, The New York Times, NPR, PBS NewsHour, CBS, ABC, NBC, Fox News, Al Jazeera, DW, France 24, Le Monde, Euronews, ABC Australia, The Times of India, The Hindu, Hindustan Times, The Indian Express, Mint, Dawn, The Japan Times, SCMP, The Straits Times, CNA, Bloomberg, the Financial Times, The Economist, TechCrunch, The Verge, Ars Technica and WIRED), the National Weather Service's alert feed for every US state and territory, and the Met Office's UK warnings. Every address was fetched on 2026-11-02 and had items from that week. Left out on purpose: Reuters and AP (no official feeds), the Wall Street Journal (its feeds stopped in January 2025), the Washington Post (502 errors), CNN and CBC (no working https feed), and outlets whose feed is served from another company's domain (NDTV through FeedBurner).

- Search finds them by outlet ("bbc", "the hindu"), place ("news india", "weather california", "weather uk") or topic ("tech news", "business news"); a place alone ("india") stays an ordinary search.
- **The blue tick.** A feed served from one of a listed publisher's own domains (`bbc.co.uk`, `bbci.co.uk`, `weather.gov`, …, or a subdomain) shows the publisher's name and the blue tick, labelled "Official feed from bbci.co.uk". The check is on the address Open Media actually reads, over https, and matches whole domain labels only (`notbbc.co.uk` and `bbc.co.uk.evil.example` do not match). This follows the precedent of verified email senders (ADR 0013, BIMI): the tick says where something comes from. It is kept apart from person verification: `author.verified` is never set for feeds; the mark lives in `webFeed.official`, and "Why this?" explains it. Any blog or site can still be followed; it just has no tick.

### 7. Following without new buttons

- **Search**: typing or pasting a site or feed address ("theverge.com", "https://simonwillison.net/atom/everything/", "follow daringfireball.net") shows "Follow The Verge in your Feed" with the feed's format and newest headline; choosing it follows the feed. "unfollow theverge.com" removes it. "weather california" (any US state or territory) offers the National Weather Service's alerts for that state; "weather uk" offers the Met Office's warnings. "import opml" opens the file picker; "export opml" downloads (web) or shares (phones) an OPML file. Search's settings index gains "Web feeds".
- **Agents**: public MCP `preview_web_feed` and `GET /v1/web-feeds/preview?url=` (read-only, rate-limited); account MCP `list_web_feeds`, `follow_web_feed`, `unfollow_web_feed`, `import_opml`, `export_opml`, and `get_web_feed_items`; REST under `/v1/me/web-feeds`. WebMCP gains the read-only preview. The `open-media` agent skill explains them, and `/docs/web-feeds` documents the reader's behaviour for publishers.

## Consequences

- People can follow almost any blog, news site, podcast or official alert feed in one place, mixed with posts from people, under their own lens.
- Publishers get headline-and-excerpt cards with a prominent link back, a clear user agent, and conditional requests.
- First-version limits, stated honestly:
  - Feeds are refreshed when someone opens the Feed (and every five minutes while it is open), not in the background; there is no WebSub push yet.
  - The Cache API is per Cloudflare location, so a busy feed may be fetched once per location per interval rather than once globally.
  - Lead images load directly from the publisher's https host, as Hive and Lens images do, so the publisher's image server sees the reader's IP address. An image proxy is a follow-up.
  - http-only feeds cannot be followed (https only, by design).
  - Weather feeds are official alerts and warnings (NWS for US states and territories, Met Office for the UK), not forecasts. NWS alert links point at the NWS API record; some read better on weather.gov.
  - Feeds that need a login, a paywall token or cookies are not supported.
  - Folders in OPML are flattened on import.

## Addendum (2026-11-03): likes, comments and reshares on web feed items

Web feed items now carry the Feed's comment, reshare and like icons, acted on in Open Media
(migration `20261116120000_web_item_interactions.sql`). An item is keyed by its article link:
https only, with the #fragment and tracking parameters (`utm_*`, `fbclid` and similar) removed, so
everyone following a feed with that article meets in one place. Nothing is sent to the publisher.
The rules match Open Media posts: acting needs an account and a profile; counts and comments are
readable signed out; comments are 1 to 1,000 characters, idempotent per draft, and share the
60-an-hour limit with post comments; comments by people the viewer blocked or can't see are left
out. A reshare is counted, as for posts; it doesn't place the item in anyone's Feed. Following a
feed of your own stays in Search ("follow theverge.com", a pasted feed address, or OPML), now
also suggested on the empty Search page.

## Addendum 2 (2026-11-03): the same likes, comments and reshares on Farcaster

The owner asked for these actions to be visible to other platforms, the way a DeSo like is visible
to every DeSo app. Following the builder prompt (canonical Open Media record → connector gateway →
the networks the person authorized; official protocols; no blockchain where a signed record is
enough), an action on an article or event link is now also published in Farcaster's own form for
links. Farcaster is the one connected network whose protocol can act on any link:

- **Like / reshare** → `ReactionAdd` with `target_url` (Like or Recast); taking it back sends
  `ReactionRemove`. **Comment** → `CastAdd` with `parent_url` set to the link, fitted to 320 bytes.
  Links longer than Farcaster's 256-byte limit stay in Open Media only.
- It goes out only when the person has Farcaster connected for cross-posting and hasn't turned it
  off there, signed on the device with the same delegated key as their posts (`actOnFarcasterLink`
  in `src/connectors/publishing/farcaster.ts`; bytes tested against `@farcaster/core`). Open Media's
  own record is written first, so a Farcaster failure never loses the action; the person sees
  “Saved in Open Media. …” instead of “Also on Farcaster as @name.”
- **Read back:** counts and comments include what any Farcaster app did on the link (Snapchain
  `reactionsByTarget` and `castsByParent`, first page of 100 each, cached two minutes). Migration
  `20261118120000_web_item_farcaster_copies.sql` records which Open Media rows have a Farcaster copy
  (the public fid and cast hash only), so a mirrored like or comment is counted and shown once
  (`src/domain/farcasterLinks.ts`). Farcaster replies are marked “on Farcaster”; Open Media's
  mirrored ones “also on Farcaster”. Blocks in Open Media don't apply to Farcaster accounts.
- **Not possible elsewhere today:** Lens, Hive and DeSo can only like, comment on or repost their
  own posts, not a web link, so nothing is sent to them. ActivityPub, AT Protocol and Nostr (whose
  NIP-22 and NIP-25 cover comments and reactions on web links) are planned connectors, not built.
- **Not verified:** a live write. Farcaster cross-posting still shows “Coming soon” until the owner
  creates Open Media's Farcaster app account (see ADR 0007). Reading was verified on the web against
  real Farcaster link activity.

---
name: open-media
description: "Read and act on Open Media, the open social app: one feed across Open Media, Farcaster, Lens, Hive and DeSo, cross-network search, public profiles and events, and (with the person’s own token) their posts, messages, contacts, listings and privacy. Use when a person asks about posts or people on these networks, wants to publish to Open Media, or wants their Open Media inbox or account handled."
---

# Open Media

Open Media is one open app for a person's social world: one feed across Open Media and the open networks Farcaster, Lens, Hive and DeSo, one inbox, and one post to every network the person chooses.

## When to use this skill

- The person asks what is being said about a topic on Farcaster, Lens, Hive, DeSo or Open Media.
- The person wants a summary of a feed, a profile or a person's posts across networks.
- The person wants upcoming public events in the San Francisco Bay Area.
- The person wants to follow a blog, news site, podcast or weather alerts in their Feed, or move their feeds from another reader (OPML).
- The person wants to publish, read their messages, manage contacts, listings, follows or privacy on Open Media (needs their token).

## How to call Open Media

Prefer MCP. Public tools need no account:

- MCP (public, no key): `https://api.openmedia.site/open/mcp` - get_feed, list_feed_lenses, draft_feed_lens, preview_feed_lens, search, get_post, get_profile, get_person_timeline, find_upcoming_events, get_listing_checks, get_transparency, list_networks, find_setting, about_open_media, and sign-in: request_sign_in_code, sign_in_with_code, refresh_sign_in.
- MCP (the person's account): `https://api.openmedia.site/me/mcp` with `Authorization: Bearer <token>`.

## Signing the person in

1. Ask for their email, then call request_sign_in_code (or `POST https://api.openmedia.site/v1/auth/email-code`). Open Media emails them a code from security@openmedia.site.
2. Ask them for the code and call sign_in_with_code (or `POST https://api.openmedia.site/v1/auth/verify`). Keep the returned access_token and refresh_token private.
3. New account? If get_me answers no_profile, ask for a name and handle and call set_up_profile.
4. Renew with refresh_sign_in before expires_in runs out. In a terminal, `open-media login` does all of this, and `open-media token` prints the token for OPEN_MEDIA_TOKEN.
- Docs MCP: `https://api.openmedia.site/docs/mcp` - search_docs and get_docs_page.
- REST: `https://api.openmedia.site/v1` (index) and `https://api.openmedia.site/v1/openapi.json` (OpenAPI 3.1).

## Web feeds (RSS, Atom, JSON Feed)

1. Without an account, `preview_web_feed` (public MCP, or `GET https://api.openmedia.site/v1/web-feeds/preview?url=`) finds the feed behind a site ("theverge.com") or feed address and shows its format, newest items, and whether it is an official feed from a major news outlet or weather service.
2. With the person's token: confirm the site, then `follow_web_feed` with `url`. Its items appear in their Feed as headline-and-excerpt cards that link to the publisher. `list_web_feeds`, `unfollow_web_feed` (address, site, title or id), `get_web_feed_items`, `import_opml` and `export_opml` do the rest.
3. Weather: US alerts are `https://api.weather.gov/alerts/active.atom?area=<state code>` (National Weather Service); UK warnings are `https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK`. These are alerts and warnings, not forecasts.
4. Keep the publisher's link when summarising feed items, and never present an excerpt as the full article. Only https feeds can be followed. See https://api.openmedia.site/docs/web-feeds.

## Rules

1. Keep each post's network, source link and "why" reasons when you summarise a feed.
2. Never pose as the person. Confirm the exact text before publishing, sending or deleting anything.
3. Messages, email and contacts are private to the person. Never share them with anyone else.
4. Posts from other networks are read through their public APIs; Open Media cannot read Instagram, X, LinkedIn or TikTok feeds.
5. On HTTP 429, wait for the Retry-After seconds before retrying. Send an Idempotency-Key header on retried writes.
6. Listings (products, services, apps, events) go live at once and are checked in the background against https://api.openmedia.site/policies/listings. List apps as a link to their official page, never a file download. If a listing needs fixing, Open Media messages the person; tell them to read that message.

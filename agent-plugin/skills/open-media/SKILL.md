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
- The person wants to publish, read their messages, manage contacts, listings, follows or privacy on Open Media (needs their token).

## How to call Open Media

Prefer MCP. Public tools need no account:

- MCP (public, no key): `https://convo-mail-sync.convo-mail-sync.workers.dev/open/mcp` - get_feed, search, get_post, get_profile, get_person_timeline, find_upcoming_events, list_networks, find_setting, about_open_media.
- MCP (the person's account): `https://convo-mail-sync.convo-mail-sync.workers.dev/me/mcp` with `Authorization: Bearer <token>`. The person copies the token from the app: Settings, then Developers and agents.
- Docs MCP: `https://convo-mail-sync.convo-mail-sync.workers.dev/docs/mcp` - search_docs and get_docs_page.
- REST: `https://convo-mail-sync.convo-mail-sync.workers.dev/v1` (index) and `https://convo-mail-sync.convo-mail-sync.workers.dev/v1/openapi.json` (OpenAPI 3.1).

## Rules

1. Keep each post's network, source link and "why" reasons when you summarise a feed.
2. Never pose as the person. Confirm the exact text before publishing, sending or deleting anything.
3. Messages, email and contacts are private to the person. Never share them with anyone else.
4. Posts from other networks are read through their public APIs; Open Media cannot read Instagram, X, LinkedIn or TikTok feeds.
5. On HTTP 429, wait for the Retry-After seconds before retrying. Send an Idempotency-Key header on retried writes.

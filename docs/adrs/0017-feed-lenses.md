# ADR 0017: Feed lenses, written in plain words and shared openly

- Status: **accepted and deployed** (built 2026-10-27; migration, Worker and web app deployed 2026-10-28 as Worker `3d5e448c`; iOS build 15 sent to TestFlight).
- Supersedes the ranking in: [ADR 0003](0003-transparent-feed-baseline.md) (Raw and Relevant stay; their implementation changes)
- Builds on: [ADR 0010](0010-universal-search.md) (Search), [ADR 0012](0012-agent-interfaces-and-design-system.md) and [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents), [ADR 0013](0013-identity-contacts-commerce-payments.md) (follows)
- Master builder prompt sections: 4.2 (you control what you see), 23 (default feed), 24 (algorithm marketplace), 25 (algorithm sandbox), 26 (why am I seeing this), Phase 6 (RankingProvider, manifests, permissions, marketplace foundation, sandboxing)

## Context

The owner asked for people to be able to talk or write to an agent that creates feed filters and algorithms for them, use them, and share them publicly or in a marketplace, without new buttons or a crowded interface, and for the default Raw and Relevant feeds to work properly and be easy to inspect.

An audit of the code before this change found:

1. **Relevant did not work.** Every real post (Open Media, Farcaster, Lens, Hive, DeSo, events) was built with `relevance: { followsAuthor: false, selectedInterestMatches: [] }`. Follows existed in the database (ADR 0013) but never reached ranking, and nothing stored interests. Relevant's score was `recency × 0.5` with recency reaching 0 at 48 hours, so every post older than two days scored 0 and kept the order the networks happened to load in. Relevant was "recent first, then unsorted".
2. **"Why this?" overstated.** It said "Posted recently" for every post, including week-old ones, and "Selected by Relevant" even when nothing but recency was used.
3. **The two modes were hard-coded** in `selectFeed` and the Worker's `feed()` had its own copy of Raw (and no Relevant at all: it returned the networks' load order).
4. **The choice was not saved.** Every app start reset the Feed to Relevant (Raw when signed out).

## Decision

### 1. One lens format for every feed algorithm

A **lens** is a JSON manifest (`open-media.feed-lens/1`), never code. Raw and Relevant are two built-in manifests in the same format as anyone else's. One runner, `src/domain/feedLenses.ts`, filters and orders posts the app or the Worker already loaded:

```json
{
  "format": "open-media.feed-lens/1",
  "name": "Cooking videos",
  "permissions": ["follows"],
  "filters": { "kinds": ["video"], "about": ["cooking"], "mute": ["crypto"], "hideSources": ["hive"] },
  "order": "ranked",
  "objectives": { "recency": 0.6, "follows": 0.4, "interests": 0, "engagement": 0, "diversity": 0.3 },
  "interests": []
}
```

- **Filters** keep posts (`sources`, `kinds`, `about`, `followedOnly`, `maxAgeHours`) or leave them out (`hideSources`, `hideKinds`, `mute`, `muteAuthors`). Words match whole words, so muting "crypto" keeps "cryptography".
- **Order** is `newest` or `ranked`. Ranked scores are a weighted mean of recency (half-life 12 hours, so it never reaches 0), follows, interests and public engagement, then a greedy re-rank lowers repeat authors (and, lightly, repeat networks) by the `diversity` weight. Ties break by time, then id, so every device shows the same order.
- **Permissions are the sandbox.** A lens can always read a post's text, time, network and kind. It reads viewer data only when its manifest lists `follows`, `interests` or `public_engagement`; the runner removes everything else from the context before scoring, whatever the caller passes. Private messages, exact location, sensitive traits, KYC documents and emotional state have no field in the format, and `parseLens` refuses unknown fields, so no manifest can ask for them. This meets sections 24–25 without running third-party code at all: there is nothing to sandbox because a lens cannot execute.
- **Validation everywhere.** `parseLens` runs when a lens is drafted, saved, read from the database, read from a share link and loaded from device storage. A manifest that stops validating (for example after a format change) is skipped, never run. A manifest cannot claim to be built in or take the ids `raw` or `relevant` (the database refuses them too).

**The built-ins**

| Lens | Reads | Order |
|---|---|---|
| Raw | nothing about you | Newest first; always available |
| Relevant (version 2) | who you follow on Open Media, topics you chose | Newness 50%, follows 30%, topics 20%, with authors and networks spread out (diversity 0.3) |

Relevant now uses real follows (accepted ones, loaded once from `open_media_my_follows`) and topics people add from Search ("I'm into AI and design"). Without either, it is newest-first with voices spread out, so one network posting 30 times a minute (Hive, today) no longer fills the screen. Language and approximate region (allowed by section 23) are not used: posts carry neither today.

### 2. "Why this?" says what really happened

Each post lists the signals actually used for it (follows, matched topics, the source network's stream, "Posted 3 hours ago", the lens), the lens's rules in one line ("How Relevant works: Ranked by newness 50%, who you follow 30%, your topics 20% · Spreads authors and networks out"), the network's own published filters as before, and what was not used: signals the lens did not ask for, plus the five forbidden ones. Agents get the same fields in each post's `why`.

### 3. People write lenses in plain words, in Search

There is no lens editor and no new button (owner rule, 2026-10-26). Search already reads plain language, so it is where people talk to the Feed:

- A request that reads like a feed ("only videos from people I follow, no crypto", "hide hive", "newest first from farcaster called Open web") shows one result row: **Show the Feed as "Following Videos"**, with "Understood: Only videos · Only people you follow · Mute crypto" and anything it did not use. Choosing it saves the lens and switches the Feed.
- "I'm into AI and design" adds topics that Relevant lifts.
- A saved lens's name with "share", "remove" or "use" gives the matching row. Sharing copies (web) or opens the share sheet (phones) with `https://openmedia.site/?lens=<id>`.
- Lenses other people shared that match the words appear as rows too ("Use 'Calm videos' by @maker · 3 people use it").

`lensFromRequest` turns words into a manifest with fixed rules on the device: the same words always give the same lens, it needs no server or AI model, and it shows what it skipped instead of guessing. Richer requests go through an AI agent (below), which can write any manifest the format allows.

The Feed's existing picker shows Relevant, Raw and the saved lens in use (or the newest one), never more than three choices; it wraps below the title on narrow phones. When a lens keeps few of the loaded posts, the Feed fetches up to three more pages on its own, 1.5 seconds apart so the networks' public APIs are not hit back to back.

### 4. Agents can do everything a person can

Public, no key (REST and `/open/mcp`): `list_feed_lenses` (`GET /v1/lenses`), `get_feed_lens` (`GET /v1/lenses/{id}`), `draft_feed_lens` (`POST /v1/lenses/draft`), `preview_feed_lens` (`POST /v1/lenses/preview`) and `get_feed` with `lens` (`GET /v1/feed?lens=`). The person's account (`/me/mcp`, bearer token): `list_my_feed_lenses`, `save_feed_lens` (private or public), `install_feed_lens`, `delete_feed_lens` and `get_my_feed`, which runs a lens with the person's follows. WebMCP gains the read-only `list_open_media_feed_lenses`, and the Claude and Codex plugin gains the `open-media-feed-lenses` skill. The agent site documents the format and the built-in manifests at `/docs/feed-lenses`, generated from the same constants the runner uses.

### 5. Storage and sharing

`public.feed_lenses` (migration `20261031120000_feed_lenses.sql`) keeps each person's lenses: key, name, manifest (an object, at most 8 KB), `private` or `public`, and `forked_from`. Row-level security lets people read only their own rows; every write goes through `open_media_save_feed_lens`, which caps a person at 50 lenses and lets people fork only public lenses. `open_media_public_feed_lenses` and `open_media_public_feed_lens` are the public directory, readable without an account. A lens shared from a private account is shown without its author. Installs are counted as copies made by other people, so there is no counter to inflate.

On the device, lenses, the chosen lens and topics live in AsyncStorage; for a signed-in person they are also saved to the account, which wins when both have the same id, and lenses made before signing in are uploaded on sign-in. A share link opens the lens on the web and removes `?lens=` from the address bar.

## Consequences

- The builder prompt's Phase 6 foundation exists: a ranking provider interface (the runner), manifests, enforced permissions, a public directory with install counts and forking, and sandboxing by construction.
- Lenses can only reorder and filter posts the app already loaded. They cannot reach a network's whole history, so a very narrow lens shows few posts until more pages load.
- Not built yet: ratings and reviews of lenses, paid lenses, lens versions and change history, reporting a shared lens, and native deep links for share links (phones open the web link). Interests are kept per device, not in the account. The plain-language rules cover the common phrasings tested in `feedLenses.test.ts`; anything else is reported as not understood rather than guessed.
- The Worker's `get_feed` and `GET /v1/feed` default to Raw as before; `mode=relevant` now really runs Relevant (it previously returned load order).

## Verification (2026-10-27)

- Unit tests: `src/domain/feedLenses.test.ts` (ordering, permissions, validation, plain-language drafts), `services/mail-sync/src/feedLensApi.test.ts` (routes, MCP catalog, OpenAPI, refusal of forbidden fields), database tests in `supabase/tests/open_media_feed_lenses_test.sql` (12 checks, run against the local database).
- Web, local stack: Raw and Relevant give different orders on live network posts; a lens written in Search applies, persists across reloads, is saved to the account after sign-in, is shared publicly and is listed by `GET /v1/lenses` with its author and rules; desktop and 375 px widths.
- iOS Simulator: Search draft → Feed through the new lens, picker layout at phone size.
- Android emulator (API 36, local stack, signed in): "only from farcaster called Caster only" in Search drafts the lens; choosing it switches the Feed to Farcaster posts only, with the picker wrapped under the title (Relevant, Raw, Caster only); "Why this?" shows the lens and its rules; the lens is saved to the account and stays chosen after the app is force-stopped and reopened; Raw switches back to all networks, newest first; "share Caster only" makes it public and opens Android's share sheet with the `openmedia.site/?lens=` link.
- Not exercised: the iOS share sheet.

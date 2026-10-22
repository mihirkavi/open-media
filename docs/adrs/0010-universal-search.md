# ADR 0010: Universal search with basic AI

- Status: accepted
- Date: 2026-10-22

## Context

The builder prompt asks for one universal search system (people, posts, Clips, messages, email, settings, and documentation) with replaceable providers and AI-assisted retrieval "if practical", plus compact search on mobile and a restrained, persistent field on desktop. The owner asked for search across the whole platform, including public posts on every social network, with basic AI search.

What each network offers without keys (checked October 2026):

| Network | Public search | Used |
|---|---|---|
| Farcaster | `api.farcaster.xyz/v2/search-casts` (Farcaster's public client API; answers in under a second) | Yes |
| Lens | `posts(filter: { searchQuery })` on the v3 API (slow: 6–30 s) | Yes, with a 35 s timeout and streamed results |
| Hive | No keyless full-text search (Ecency and HiveSearcher need keys); `bridge.get_ranked_posts` by tag | By tag, disclosed as such |
| DeSo | No public search endpoint found | Matches among the newest 100 posts, disclosed as such |

## Decision

- **Understanding on the device.** `parseSearchQuery` reads plain language: "videos/clips", "photos", "on Lens/Farcaster/Hive/DeSo", "today/this week/this month". It shows what it understood ("Understood: Videos only · On Lens · Last 24 hours"), and the rest becomes the search text.
- **Local first.** Settings, messages and email, and already loaded posts are matched on the device. Messages and email are never sent anywhere for search.
- **Every network, live.** `networkSearches` query each network in parallel, apply the same published filters as Feed (ADR 0006), and stream in as each answers. Results are newest-first. Each source states how it searched ("posts tagged #ethereum", "newest 100 posts only"), and each post's "Why this?" says it matched the search on that network.
- **Basic AI.** After the networks answer (or after 9 s), the app sends the search text and up to 15 public post snippets to `POST /v1/search/assist` on the Worker. Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) writes 2–3 neutral sentences that cite posts by number. The prompt allows only the given posts and tells the model to treat post text as content, never instructions, and invalid citations are dropped. The card says it was written by AI from N public posts, can be wrong, and that only the search and those posts were sent. The endpoint is public and rate-limited per IP; local development has no AI, so the card stays hidden.
- **Everywhere in the app.** Desktop shows a persistent "Search everything" field at the top of the rail; phones use the header search button; signed-out visitors get a search button in the public bar.

## Consequences

- Public posts from all four networks are searchable without accounts.
- Hive and DeSo coverage is partial (tag and recency respectively), and this is stated next to their results.
- Farcaster's search endpoint is part of its client API, not a documented developer API, and Farcaster's ownership is changing. Lens search can be slow.
- AI summaries depend on Cloudflare Workers AI and can be inaccurate. They summarize only the posts shown and cite them.

# ADR 0020: Default feeds that work, and a lens assistant you talk to

- Status: **accepted, built, not yet deployed** (2026-10-31).
- Builds on: [ADR 0017](0017-feed-lenses.md) (feed lenses), [ADR 0010](0010-universal-search.md) (Search), [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents)
- Master builder prompt sections: 4.2, 21–26, Phase 6
- Plain-English guide: [FEED_ALGORITHMS.md](../FEED_ALGORITHMS.md)

## Context

The owner asked for people to be able to talk or write to an agent that helps them create feed filters and algorithms, use them, and share them publicly or in a marketplace, with no new buttons, an uncrowded interface and a high agent-readiness (Ora) score. The owner also reported that Raw and Relevant did not seem to work, and asked for clear visibility of their code and documentation.

ADR 0017 had built lenses four days earlier. Comparing `GET /v1/feed?mode=raw` with `mode=relevant` on the live Worker (2026-11-01) showed both running, but neither doing what a person would expect:

1. **Raw was out of order after scrolling.** Each network pages separately, and one page covers very different spans: Hive's first page was about ten minutes (ten posts at the top of Raw), Farcaster's about two days. "Load more" fetched the next page of every network and re-sorted everything, so Hive's second page (minutes older) landed above Farcaster posts from hours ago that the reader had already passed. The API did the same, and on later pages it also asked networks that had no more pages for their first page again, repeating posts.
2. **Relevant looked like Raw shuffled.** Its only personal signals were Open Media follows and topics typed into Search. Most people have neither, so its order was newness with networks taking turns. Seven DeSo horoscope bots posting within a minute, and posts in languages the reader doesn't use, ranked like anything else.
3. **Signed-out visitors saw Raw first**, which on the live data meant ten Hive posts in a row.
4. **Making a lens was one-shot.** Search turned one request into one lens; there was no way to say "also hide Hive" to the lens in use, and words the rules couldn't read were reported as not understood with nowhere to go.

## Decision

### 1. Raw merges the networks by a time horizon

The **horizon** is the oldest time every network still paging has reached. Newest-first lenses (Raw, and any lens with `order: newest`) show posts only down to it, and "load more" asks only the networks holding it up (within 30 minutes). Failed and finished networks never hold it back. This is the standard merge of sorted lists, and it guarantees that loading more only ever adds posts below the ones shown. `src/domain/feedMerge.ts` holds the rules; `useMixedFeed` tracks each network's progress.

The API does the same statelessly: `nextCursor` carries each network's cursor plus `before` (the horizon already returned). A network with posts left below the horizon is asked for the same page again and posts already returned are dropped. Networks missing from a cursor are no longer asked again (fixing the repeated first pages), and a network that fails keeps its cursor for the next page.

### 2. Ranked lenses keep shown posts in place

A ranked feed isn't in time order, so a horizon doesn't apply. Instead, when more posts load, the posts already shown keep their order and the newly loaded ones are ranked and added below (`stableOrder`). Refreshing, showing new posts, or switching lenses starts a fresh order.

### 3. Relevant version 3: two signals that work from the first visit

| | v2 | v3 |
|---|---|---|
| Newness | 50% | 40% |
| Who you follow | 30% | 25% |
| Your topics | 20% | 15% |
| Your languages | — | 10% |
| Public likes and reposts | — | 10% |
| Spread out | 0.3 | 0.4 |

- **Language** is allowed by section 23. A new permission, `language`, and objective, `language`, are added to the format (old manifests stay valid; the weight defaults to 0). The post's language is worked out on the device from its text (writing system, then the most common words of nine Latin-script languages); the viewer's languages come from the device and are never sent. A post is lowered only when it is clearly in another language. Languages sharing a writing system count as the same, so Marathi readers aren't shown Hindi as foreign. The REST feed reads `Accept-Language`.
- **Public engagement** (counts the networks publish) was already in the format; Relevant now uses it lightly, on a log scale. It is the only signal available for every post that separates a liked post from an automated one. It is not engagement *optimization*: it can lift a post by about three hours of newness at most for typical counts, it is listed in "Why this?", and Raw ignores it.
- Relevant is now the default for signed-out visitors too: it works without an account and reads nothing that leaves the device.

### 4. A lens assistant you talk to, in Search, with no new controls

Search stays the only place to make lenses (ADR 0017's no-new-button rule):

- **Follow-ups change the lens in use.** "also hide hive", "show hive again", "unmute crypto", "call it Calm" give an *Update "…"* row (`refineLens`). Changing a built-in makes the person's own copy ("My Relevant").
- **The assistant reads what the rules can't.** When the on-device rules leave words unread, Search asks `POST /v1/lenses/draft`, which runs the same rules and, only then, Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, the model the career assistant uses). The model must return a manifest; `parseLens` validates it (unknown fields, forbidden signals, built-in ids and missing permissions are refused) and the app validates it again. A refused answer falls back to the rules' answer. The row says *Written with AI and checked against the lens rules*.
- **Agents hold the same conversation:** `draft_feed_lens` takes `base` (a manifest or `raw`/`relevant`/`work`) and returns a one-line `reply` and `writtenBy`.

### 5. Code and documentation in plain sight

- "Why this?" gains one text link inside the expanded panel, *Manifest and source code*, to `/docs/feed-lenses`, which now links the runner, the merge rules, the assistant, this ADR and [FEED_ALGORITHMS.md](../FEED_ALGORITHMS.md).
- FEED_ALGORITHMS.md explains Raw and Relevant step by step, with a table pointing to the function for each step and the tests that prove it.
- Searchable Settings gains phrases such as "make my own feed", "how does relevant work" and "feed language".
- The agent skill `open-media-feed-lenses` describes the conversation (plugin 1.4.0).

## Consequences

- Raw is truthful and stable, but honest about volume: networks that post more fill more of it. People who want balance use Relevant.
- At first load, Raw shows only the stretch every network has reached (about ten minutes on the live data) and loads more as people scroll.
- Relevant now differs visibly from Raw for everyone. Its language guess can be wrong for short or mixed-language posts; it then says "unknown" and does nothing.
- The assistant can be called by anyone; it is covered by the per-client rate limit, and the model is called only when the rules miss words.
- Not built: region, follows from other networks, ratings and reviews, reporting a shared lens, version history, paid lenses, native share links (see FEED_ALGORITHMS.md, "What's next").

## Verification (2026-10-31)

- Unit tests: `src/domain/feedMerge.test.ts` (the live ordering bug reproduced, horizon, targeted loading, stable order), `src/domain/feedLenses.test.ts` (language detection, Relevant v3 ordering, explanations, old manifests, follow-ups), `services/mail-sync/src/feedPaging.test.ts` (API paging returns every post once, in time order, across pages), `services/mail-sync/src/lensAssist.test.ts` (rules first, conversation, model output validated, forbidden fields refused).
- `npm run check` (typecheck, app and Worker tests, web export).
- See the pull request for which platforms were exercised by hand.

# How the Open Media Feed is ordered

This is the plain-English guide to Open Media's feed algorithms: what Raw and Relevant do, how people make their own, and where each step lives in the code. Design records: [ADR 0017](adrs/0017-feed-lenses.md) (lenses) and [ADR 0020](adrs/0020-working-default-feeds-and-lens-assistant.md) (working defaults and the lens assistant). The public, always-current version for agents is `https://api.openmedia.site/docs/feed-lenses`.

## The idea in one paragraph

Every way of ordering the Feed is a **lens**: a small JSON file that says which posts to keep and how to order them. A lens is data, never code, so anyone can read exactly what it does, and no lens can run anything. Raw and Relevant are two lenses Open Media ships; people can describe new ones in plain words, keep refining them by talking, and share them. One runner applies every lens, in the app and on the server, so what an agent previews is what the person sees.

## Raw

**What it does:** every post from every network, newest first. It reads nothing about you and hides nothing.

**How it stays in order while you scroll.** Each network is loaded a page at a time, and pages cover very different stretches of time: on 1 November 2026, one Hive page was about ten minutes and one Farcaster page was about two days. If the Feed simply sorted everything loaded so far, the next Hive page (a few minutes older) would be sorted above Farcaster posts from hours ago that you had already scrolled past. So Raw works like merging sorted lists:

1. The **horizon** is the oldest time that *every* network still paging has reached. Raw shows only posts at or above it. Anything below it waits, because some network may still have posts that belong in between.
2. **Load more** asks only the networks holding the horizon up (within 30 minutes), so the Feed moves down evenly.
3. A network that failed, or has no more pages, never holds the Feed back.

| Step | Code |
|---|---|
| The horizon, which networks to ask, posts above the horizon | `feedHorizon`, `sourcesToLoad`, `aboveHorizon` in [`src/domain/feedMerge.ts`](../src/domain/feedMerge.ts) |
| Each network's progress and targeted "load more" | `useMixedFeed` in [`src/ui/useMixedFeed.ts`](../src/ui/useMixedFeed.ts) |
| Applying it in the Feed | `FeedView` in [`src/ui/OpenMediaFeed.tsx`](../src/ui/OpenMediaFeed.tsx) |
| The same merge for agents (`GET /v1/feed`, `get_feed`); the cursor carries the horizon | `feed` in [`services/mail-sync/src/agentApi.ts`](../services/mail-sync/src/agentApi.ts) |
| Proof | [`src/domain/feedMerge.test.ts`](../src/domain/feedMerge.test.ts), [`services/mail-sync/src/feedPaging.test.ts`](../services/mail-sync/src/feedPaging.test.ts) |

## Relevant (version 3)

**What it does:** newer posts first, lifted by a few signals you can see, with authors and networks spread out. It never hides a post.

| Signal | Weight | What it means | Works without setup? |
|---|---|---|---|
| Newness | 40% | Counts half as much every 12 hours, so old posts still sit in time order | Yes |
| Who you follow | 25% | Accepted follows on Open Media | After you follow someone |
| Your topics | 15% | Words you chose, e.g. by typing "I'm into AI and design" in Search | After you add topics |
| Your languages | 10% | A post clearly in a language your device doesn't use sits a little lower. Posts it can't place are never lowered | Yes |
| Public likes and reposts | 10% | The counts each network already publishes, on a log scale, so a hit post can't outrank everything | Yes |
| Spread out | 0.4 | Each repeat author (and, lightly, network) counts less, so one voice can't fill the screen | Yes |

How big the lifts are, in hours of newness (compared with a brand-new post): a post in another language is treated as about five hours older; a post with around 100 likes and reposts is lifted about three hours; a post by someone you follow about seventeen hours.

**Why version 3.** Version 2 used only follows and topics. Most people have neither set up, so for them Relevant was Raw with networks taking turns, and it felt broken. Language and public likes work from the first visit, are allowed by section 23 of the builder prompt, and are both shown in "Why this?".

**Language, privately.** Networks rarely say what language a post is in, so the app works it out from the text with two rules anyone can check: the writing system (Cyrillic, Devanagari, Arabic and so on), and for Latin letters the most common short words of nine languages. Your device's languages are read on the device and never sent. Languages that share a writing system are treated as the same (a Marathi reader isn't shown Hindi as foreign). Agents can pass `Accept-Language` to the REST feed for the same effect.

**Never used, by any lens:** private messages, exact location, sensitive-trait inference, KYC documents, emotional-state prediction. These have no field in the format, and unknown fields are refused, so no lens can ask for them.

| Step | Code |
|---|---|
| The Relevant manifest | `relevantLens` in [`src/domain/feedLenses.ts`](../src/domain/feedLenses.ts) |
| Filtering | `lensKeeps` |
| Scoring | `lensScore` and `objectiveValues` |
| Ordering and spreading voices out | `runLens` |
| A post's language | `postLanguage` |
| Your device's languages | `deviceLanguages` in [`src/ui/useFeedLenses.ts`](../src/ui/useFeedLenses.ts) |
| Posts already shown keep their place when more load | `stableOrder` in [`src/domain/feedMerge.ts`](../src/domain/feedMerge.ts) |
| "Why this?" | `explainLensPost` and `describeLensRules` |
| Proof | [`src/domain/feedLenses.test.ts`](../src/domain/feedLenses.test.ts) |

## Making your own feed by talking to it

There is no lens editor and no new button. Search already understands plain language, so Search is where you talk to the Feed:

1. **Describe it.** "only videos from people I follow, no crypto" → a row: *Show the Feed as "Following Videos"* · *Understood: Only videos · Only people you follow · Mute crypto*. Choose it and the Feed switches.
2. **Keep talking.** "also hide hive" → *Update "Following Videos"* · *Nothing from Hive*. "show hive again", "unmute crypto" and "call it Calm" work the same way. Changing Relevant or Raw makes your own copy ("My Relevant"); the built-ins never change.
3. **When the rules don't understand.** Fixed rules on the device handle the common phrasings, give the same answer every time and need no network. When they leave words unread ("something soothing, gardening vibes"), Search asks Open Media's lens assistant, an AI model on the server. What it writes is checked by the same validator as everything else and shown as plain rules, marked *Written with AI and checked against the lens rules*. Nothing changes until you choose the row.
4. **Use it everywhere.** Saved lenses follow your account to every device, and appear third in the Feed's picker (Relevant, Raw, yours).
5. **Share it.** "share Calm" makes it public and copies a link (`openmedia.site/?lens=…`). Anyone can open it, install a copy, or change their copy. Installs are counted as copies made by other people.
6. **Find others'.** Shared lenses that match your words appear in Search: *Use "Calm videos" by @maker · 3 people use it*.

Agents do all of this through the same server: `draft_feed_lens` (send the lens in use as `base` to continue the conversation), `preview_feed_lens`, `save_feed_lens`, `install_feed_lens`, `get_my_feed`. See [the agent docs](https://api.openmedia.site/docs/feed-lenses) and the `open-media-feed-lenses` plugin skill.

| Step | Code |
|---|---|
| Words → a lens | `lensFromRequest` in [`src/domain/feedLenses.ts`](../src/domain/feedLenses.ts) |
| Follow-ups change the lens in use | `refineLens`, `looksLikeRefinement` |
| Search rows | `useLensRows` in [`src/ui/SearchView.tsx`](../src/ui/SearchView.tsx) |
| The lens assistant (rules first, then a checked AI answer) | [`services/mail-sync/src/lensAssist.ts`](../services/mail-sync/src/lensAssist.ts) |
| Saving, sharing, installing | [`src/data/lensService.ts`](../src/data/lensService.ts), [`supabase/migrations/20261031120000_feed_lenses.sql`](../supabase/migrations/20261031120000_feed_lenses.sql) |
| The API and MCP tools | [`services/mail-sync/src/feedLensApi.ts`](../services/mail-sync/src/feedLensApi.ts) |

## The lens format

```json
{
  "format": "open-media.feed-lens/1",
  "name": "Calm",
  "permissions": ["interests", "language"],
  "filters": { "mute": ["politics", "election"], "hideSources": ["hive"] },
  "order": "ranked",
  "objectives": { "recency": 0.6, "interests": 0.3, "language": 0.1, "follows": 0, "engagement": 0, "diversity": 0.5 },
  "interests": ["gardening"]
}
```

- `filters` keep posts (`sources`, `kinds`, `about`, `followedOnly`, `maxAgeHours`) or leave them out (`hideSources`, `hideKinds`, `mute`, `muteAuthors`). Words match whole words: muting "crypto" keeps "cryptography".
- `order` is `newest` (like Raw) or `ranked` (like Relevant).
- `objectives` are weights from 0 to 1, normalized when scored. Each one that reads about you needs its permission: `follows`, `interests`, `language`, `public_engagement`.
- Manifests written before `language` existed still work unchanged.

## What's next for algorithm control

Built: the format, the runner, enforced permissions, plain-language and conversational authoring, an AI assistant checked by the validator, private and public lenses, installs, forks, share links, agent tools.

Not built yet, in the order they would matter:

1. **Region.** Allowed by section 23, but posts don't carry it.
2. **Follows from other networks.** Your Farcaster or Bluesky follows, once you connect those accounts, as a follows signal.
3. **Marketplace trust.** Ratings and short reviews, reporting a shared lens, version history with "what changed", and a "most installed this week" view in Search.
4. **Paid lenses.** Builders charging for a lens, through the payments layer (ADR 0013).
5. **Native share links.** Phones open the web link today.

# ADR 0021: Your own feed algorithm, tuned in plain words

- Status: **accepted; phase 1 built and verified on the web locally** (2026-10-31). Not deployed. Migration `20261108120000_feed_lens_versions.sql` is applied only to the local database. iOS and Android are not yet tested (owner: web only for now).
- Builds on: [ADR 0017](0017-feed-lenses.md) (feed lenses), [ADR 0003](0003-transparent-feed-baseline.md) (Raw and Relevant), [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents)
- Owner rule: no new buttons (2026-10-26). Everything here works through Search, the existing Feed picker and the existing “Why this?” panel.

## What the builder prompt asks for

From `Open Media — Master Builder Prompt.md`:

- **4.2:** “Your feed belongs to you.” “Users should not be locked into one hidden engagement-maximization algorithm.” “Start extremely simply: Relevant, Raw. Later support an algorithm marketplace.”
- **22:** AI as “an optional natural-language interface to complexity”, for example “Change my feed to chronological” and “Why am I seeing this post?”. “For consequential settings changes, show confirmation.”
- **23:** Relevant may use “explicit follows; selected interests; recency; language; approximate region; community membership” and must not use “private messages; KYC documents; inferred religion; inferred political ideology; sensitive-trait inference; emotional-state prediction; precise location; addiction optimization”. “Raw must always remain available.”
- **24:** “Long-term, anyone should be able to: create; publish; inspect; rate; install; uninstall; fork; audit; monetize where appropriate; a feed algorithm.” “Each algorithm needs a machine-readable manifest” (example: `version: 2.1`, `permissions`, `forbidden`, and `objectives: relevance, diversity, discovery, recency`). “Runtime permissions must be enforced.”
- **25:** “Third-party algorithms must never receive arbitrary production database access. Create a permission gateway.” Suggested techniques include capability APIs, resource limits, scoped datasets and audit logs.
- **26:** “Why am I seeing this?”, listing signals used and sensitive signals not used.
- **37 and 38:** algorithm choice as a protected right; the right to fork.
- **Phase 6:** “RankingProvider; manifests; permissions; marketplace foundation; sandboxing.”

## What already existed (ADR 0017)

- One manifest format (`open-media.feed-lens/1`) and one runner (`src/domain/feedLenses.ts`), used both on the device and in the Worker. Raw, Relevant and Work are built-in manifests.
- Filters (keep or hide by network, kind, words, people, age, follows only), `newest` or `ranked` order, four ranking objectives (recency, follows, interests, engagement) plus diversity.
- Permissions enforced by the runner. Forbidden signals have no field, and unknown fields are refused.
- Search turns words into a **new** lens (“only videos from people I follow, no crypto”). Lenses can be shared, installed (copied) and forked. They are stored in `public.feed_lenses` with RLS. Agents can list, draft, preview, save, install and delete lenses and read their feed through one.
- “Why this?” lists the signals used, the lens's rules and what was not used.

## Gaps this ADR closes

1. **You can replace an algorithm but not develop one.** Every request writes a new lens from scratch. “Less Hive”, “more videos” or “a bit more from people I follow” cannot adjust the lens you are using, and Relevant itself cannot be tuned.
2. **Only all-or-nothing rules.** Filters keep or hide. There is no way to lean a lens toward or away from a network, kind, topic or person without hiding it.
3. **No `discovery` objective.** The builder prompt's manifest lists it; the format had no way to lift voices you don't follow yet.
4. **No versions, history or undo.** `version` was whatever the client wrote. Nothing recorded what changed, when, or whether an agent changed it, so a shared lens could not be audited (section 24 “audit”, section 25 “audit logs”).
5. **“Why this?” lists signals but not their weight.** It says “You follow this author” but not how much that counted under *your* weights, so tuning had no visible effect on the explanation.
6. **Agents could not tune**, read history or undo; only replace a whole manifest.

Not closed here (see Consequences): ratings and reports of shared lenses, language and region signals, community membership, interests stored in the account, lenses in the account export, and paid lenses.

## Decision

### 1. Format `open-media.feed-lens/2`: boosts and discovery

`/2` is a superset of `/1`. The validator accepts both. A lens is written as `/1` unless it uses a `/2` field, so lenses that don't use the new fields stay readable by installed app builds that only know `/1`. Those older builds skip `/2` lenses instead of misreading them.

```json
{
  "format": "open-media.feed-lens/2",
  "id": "my-relevant", "name": "My Relevant", "version": 4, "forkedFrom": "relevant",
  "permissions": ["follows", "interests"],
  "filters": { "mute": ["crypto"] },
  "order": "ranked",
  "objectives": { "recency": 0.5, "follows": 0.5, "interests": 0.2, "engagement": 0, "diversity": 0.3, "discovery": 0.2 },
  "boosts": [{ "kind": "video", "weight": 0.5 }, { "source": "hive", "weight": -0.5 }, { "topic": "design", "weight": 1 }],
  "interests": []
}
```

- **Boosts** lean a lens without hiding anything. Each boost names exactly one of `source`, `kind`, `topic` or `author` and has a `weight` from −1 to 1. A matching post's score is multiplied by `1 + weight / 2`, so a single boost ranges from ×0.5 to ×1.5. All of a post's boosts together are capped between ×0.25 and ×2, so no rule can bury a post or let it take over the Feed. A lens can have up to 24 boosts. Boosts read only the post (network, kind, words, author handle), so they need no permission. They apply only to `ranked` lenses.
- **Discovery** (0–1) lifts authors the viewer does not follow yet. It needs the `follows` permission, because without follows every author is “not followed” and the signal would mean nothing.
- **Plain words for every rule:** “More videos”, “Less Hive”, “Much more about design”, “A bit less from @bot”, “Ranked by newness 33%, who you follow 33%, new voices 13%…”.

### 2. Tuning in plain words, where people already talk to the Feed

`tuneLens(base, request)` in `src/domain/feedLenses.ts` changes an existing lens with the same fixed, on-device rules as `lensFromRequest`. The same words always give the same change. It reports what it understood, what it skipped, and the rules that changed:

| Words | Change |
|---|---|
| “more videos”, “less hive”, “a lot more about design”, “a bit less from @bot” | boost of +0.5 / −0.5 (“a lot” ±1, “a bit” ±0.25), added to any boost already on the same thing |
| “more from people I follow”, “newer posts”, “more variety”, “more popular”, “more new voices / surprise me” | follows / recency / diversity / engagement / discovery objective ±0.2 (“a lot” ±0.4, “a bit” ±0.1), adding the permission the objective needs |
| “no hive”, “mute crypto”, “only videos”, “last 3 days” | the same filters a new lens would get, added to this one |
| “show hive again”, “unmute crypto”, “bring back videos” | removes the matching hide, mute and negative boost |
| “chronological”, “newest first” / “ranked” | switches the order |

Tuning a built-in lens never changes it. Raw, Relevant and Work stay exactly as published. The first change makes the person's own copy: “My Relevant” (`my-relevant`, `forkedFrom: "relevant"`), and later changes tune that copy. Tuning “My Raw” with a boost switches it to ranked by newness alone and says so, because chronological order has no scores to lean. Raw itself is always one tap away in the picker.

**No new buttons.** In Search, words that read like a change (“more…”, “less…”, “fewer…”, “no more…”, “… again”, “unmute…”, “tune…”) show one row: **Tune “My Relevant”: More videos · Less Hive**. Choosing it saves the change and returns to the Feed. The picker's third place already shows the lens in use, so “My Relevant” appears there. “undo” or “history” in Search lists earlier versions of the lens in use: **Go back to version 3 of My Relevant**, showing what that version did and whether the person or an agent made it. Lenses that only say “I'm into …” keep adding topics to Relevant as before.

### 3. “Why this?” shows the post's score under the person's own weights

`explainLensPost` now also returns `scoring`. The existing panel shows it under **How My Relevant weighed this post**:

```text
Score 51 of 100
Newness 41 of 42 · Who you follow 0 of 25 · Your topics 0 of 17 · New voices 17 of 17
Slightly less DeSo ×0.88
Then spread out so one author or network can’t fill the Feed
To change My Relevant, search “less deso” or “more text posts”.
```

(A real post at 375 px, under a My Relevant tuned with “less hive”, “more farcaster, mute crypto” and “a bit less deso, more new voices”.) Points are each objective's share of the weighted mean, so they add up to the score before boosts. Each boost that matched is shown with its multiplier. The last line is a hint, not a control: it shows the words that would tune the lens for this post's network and kind. Chronological lenses say “Newest first: no score”. Agents receive the same `scoring` lines in each post's `why`.

### 4. Versions and history: storage, sharing and forking

Migration `20261108120000_feed_lens_versions.sql`:

- `feed_lenses.version` (integer). The **database** assigns it: each save whose manifest or name actually changed adds 1 and writes that number into the stored manifest. Saving the same thing again changes nothing.
- `feed_lens_versions(lens_id, version, name, manifest, changed_by, created_at)` records every version. `changed_by` is `app` (the person in Open Media) or `agent` (any call through the Worker's agent API with the person's token). RLS lets people read only their own rows, and every write goes through security-definer functions. At most 50 versions are kept per lens (the oldest are dropped) and 120 changes per person per hour.
- `open_media_feed_lens_history(key)` returns the person's own versions. `open_media_revert_feed_lens(key, version)` saves an old version as the newest one, so going back is itself in the history and can be undone. `open_media_public_feed_lens_history(id)` lets anyone audit how a **shared** lens changed. A lens shared from a private account still shows no author.
- **Forking stays copying.** Installing a shared lens copies it (`forked_from`). If its author changes the original later, the copies don't change. Nobody can alter what you installed, and each copy has its own history from version 1.

### 5. Where ranking runs

Ranking runs in the same runner in both places. On the device, the Feed runs the person's lens over the posts it loaded, with their follows and topics. In the Worker, `get_my_feed`, `GET /v1/me/feed?lens=my-relevant` and the public `GET /v1/feed?lens=<shared id>` run the same code. Neither place gives a lens anything but the post fields and the permitted viewer signals (section 25's capability gateway is the runner itself, as in ADR 0017). Nothing executes: a lens is data.

### 6. Safety limits

- Forbidden signals still have no field, and unknown fields are refused, including inside `boosts`.
- Boost and objective weights are bounded (above). A lens can hide everything with filters, but Raw cannot be changed or removed and is always in the picker.
- There are 50 lenses per person, 8 KB per manifest, 24 boosts, 50 versions per lens and 120 changes per hour. Changes are reversible, and each one says who made it.
- Agents: tuning a private lens saves directly, because it is reversible and labelled `agent` in the history. Tuning a **public** lens changes what everyone sees, so the tools say to ask the person first, as for sharing. WebMCP stays read-only.

### 7. Agents can do what people can

Public `/open/mcp` and REST:
- `draft_feed_lens` / `POST /v1/lenses/draft` take an optional `base` (a lens id or manifest) and then **tune** it instead of writing a new lens. Nothing is saved.
- `get_feed_lens_history` / `GET /v1/lenses/{id}/history` return a shared lens's versions (audit).

Person's account `/me/mcp` (bearer) and REST:
- `tune_feed_lens` / `POST /v1/me/lenses/{key}/tune` take `{ request }`. The key may be `relevant`, `raw` or `work`, which tunes “My …”. It returns the saved lens with `understood`, `notUnderstood`, `changes` and its new `version`. With `save: false` it only previews.
- `get_my_feed_lens_history` / `GET /v1/me/lenses/{key}/history` return the person's versions.
- `revert_feed_lens` / `POST /v1/me/lenses/{key}/revert` take `{ version }`.
- `save_feed_lens` now returns `version`. Each post from `get_my_feed` carries `why.scoring`.

The `open-media-feed-lenses` agent skill (in `src/domain/agentSkills.ts`, synced to the Claude and Codex plugin with `npm run agent-plugin:sync`) explains tuning, history and the confirmation rule. `/docs/feed-lenses` documents format `/2` from the same constants.

## Consequences

- People can now *develop* an algorithm: start from Relevant, Raw, Work or anyone's shared lens, and lean it a little at a time in their own words. Each step is visible in “Why this?”, can be undone, and can be audited if shared.
- Builder prompt coverage after phase 1:
  - **create, publish, inspect, install, uninstall, fork:** done, from ADR 0017.
  - **audit:** done (history).
  - **tune or develop:** done.
  - **Why this? with weights:** done.
  - **discovery objective:** done.
  - **manifest version:** done (integers assigned by the database, not `2.1`).
  - **Phase 6 RankingProvider, permissions and sandboxing:** done by construction.
- Remaining:
  - **rate** shared lenses, and **report** a harmful one (phase 2).
  - **interests and the active lens in the account**, so agents and other devices see the same choice (phase 2).
  - **lenses and their history in the account export** (phase 2).
  - **language, approximate region and community membership** signals: posts don't carry them yet (phase 3).
  - **monetize:** not planned until payments for creators exist.
- Tuning rules are fixed patterns tested in `feedLenses.test.ts`. Anything else is reported as not understood. An AI agent can write any manifest the format allows.
- Older installed app builds skip `/2` lenses and keep working with every `/1` lens.
- Signed out, tuning works on the device, but there is no history (history lives in the account).

## Verification (2026-10-31)

- Unit tests in `src/domain/feedLenses.test.ts` cover boosts, discovery, caps, tuning words, forking built-ins, format compatibility and score breakdowns. `services/mail-sync/src/feedLensApi.test.ts` covers tune, history, revert and the MCP catalog. Database tests are in `supabase/tests/open_media_feed_lens_versions_test.sql`.
- Web, local stack (own Worker and web app sharing the local Supabase), signed in as a local test account:
  - At desktop width, “less hive” in Search shows “Tune ‘My Relevant’: Less Hive”. Choosing it makes My Relevant (the picker's third choice), and Hive went from 6 of the top 15 posts to none.
  - “a lot more videos” saves version 2. “undo” lists “Go back to version 1 of My Relevant · Made by you”, and choosing it saves version 3.
  - An agent called `tune_feed_lens` (“more farcaster, mute crypto”) through `/me/mcp`, which saved version 4 labelled `agent`. `get_my_feed_lens_history` lists all four versions. `get_my_feed` returns `why.scoring` with “More Farcaster ×1.25”. After a reload, the app shows the agent's version: Farcaster posts lead, and the same post's score went from 48 to 60.
  - At 375 px, tuning from Search and the “Why this?” panel fit without horizontal scrolling.
- Found and fixed while testing: the device copy of the lenses could load after the account copy and overwrite an agent's newer version. Lenses now merge by version.
- Not verified: iOS, Android, production, and signed-out tuning in the browser (covered by unit tests only).

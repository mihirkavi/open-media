# ADR 0030: Relevant as a ranking pipeline: relevance × newness, busy authors, a still Feed

- Status: **accepted; built and verified on the web locally** (2026-11-03). Migration `20261119120000_feed_interests` is applied to the local database only. The Worker and the migration are not deployed. iOS and Android are not tested.
- Builds on [ADR 0017](0017-feed-lenses.md) (lenses) and [ADR 0021](0021-your-own-feed-algorithm.md) (tuning). The [builder prompt's §23](../../Open%20Media%20—%20Master%20Builder%20Prompt.md) still sets which signals Relevant may use.

## Context

The owner, on the phone: Relevant "still does not show my relevant". The top of the Feed was nothing but New York Times headlines. Three causes, all in the ranker:

1. **Newness was half of an additive score.** In `score = 0.5·newness + 0.3·follows + 0.2·topics`, any post from the last few minutes got about 50 points, whoever wrote it. A friend's post from this morning, at about 25 + 30 = 55, barely beat it, and a friend's post from yesterday lost to it.
2. **Every web-feed item counted as "someone you follow", with the same weight as a person.** A newsroom posting sixty headlines a day therefore had sixty fresh, "followed" posts. The diversity step cost each extra post from the same author only 15%, so the Times still filled the screen.
3. **The topics people chose were kept on the device where they typed them.** On the phone, Relevant had no topics to lift at all.

There was also a stability problem. The order was recomputed with a new clock each time any network loaded or a page arrived, so posts moved under the reader.

## How large feeds are built

The open-sourced X ("Twitter") Home Mixer and Facebook's EdgeRank share one shape, and Open Media follows it without the engagement prediction §23 rules out:

1. **Candidates** come from what you follow ("in-network") and from public streams ("out-of-network").
2. **Filters** remove what the viewer muted or hid.
3. **Scoring** multiplies affinity by time decay (EdgeRank: affinity × weight × decay), so newness alone can't carry an irrelevant post.
4. **Heuristics** run after scoring: *author diversity*, so one account never runs consecutively; *content balance*, so in-network and discovery are mixed; and *fatigue*, so repeated sources count less.
5. **Serving** keeps the order still. New posts are offered at the top instead of reshuffling what is on screen.

## Decision

### 1. One score: relevance × newness

For a ranked lens, with r = newness's share of the lens's weights:

```
fit        = Σ weightₖ · valueₖ / Σ weightₖ        (follows, topics, and any engagement or discovery the lens asks for)
relevance  = 0.1 + 0.9 · fit                       (a floor, so fresh new voices still surface)
freshness  = 0.5 ^ (age / 12 h)
score      = relevance^(1−r) · freshness^r · boosts
```

For Relevant, r = 0.5:

| Post | Score |
| --- | --- |
| Brand-new post that matches nothing | 32 |
| Friend, 8 hours old | 63 |
| Friend, 3 days old | below a fresh stranger, so relevance can't hold the top for days |

Lens manifests do not change. The same objectives and weights now combine this way.

### 2. Busy authors count less per post

A followed author's follow value is 1 for up to four posts in the last day, and √(4 ÷ posts) after that. The count comes from the loaded posts, which is public data, so no new signal is read. The Times at sixty headlines a day gets about 26% of a follow per headline. A personal blog keeps 100%. "Why this?" says so: "The New York Times posted 60 times in the last day, so each post counts 26% of a follow".

### 3. Stronger author diversity

In the greedy re-rank:

- each earlier post by the same author multiplies the next one's score by (1 − diversity), which is 0.7 for Relevant, where it used to be 0.85;
- the same author is never shown twice in a row while anyone else is within the 40-post look-ahead;
- the network spread from ADR 0021 stays.

Nobody is hidden. Posts only move down.

### 4. Topics live in the account

The topics typed in Search or Settings ("show more design in Relevant") are kept in `public.feed_interests`, one row per person, at most 20 words. The row is read and written only by its owner, through `open_media_my_feed_interests` and `open_media_set_feed_interests`. Topics already chosen on a device are added to the account the first time it signs in. They are the person's own explicit choices, as §23 asks; nothing is inferred.

### 5. A still Feed

The Feed fixes the ranking clock (`now`) and keeps the posts on screen in place (`keepOrder`). Posts from a slower network or the next page are ranked among themselves and added below. A new order from the top happens only when the reader asks for one: new posts shown (at the top, or with the pill), another lens, Retry, or a refresh. Until every source has answered the first time, the order may still settle. Every card's "Why this?" uses the same clock and counts as the order, so the two always agree. Given the same posts and moment, the order is the same in any arrival order and on any device.

## Consequences

- People and small sources the viewer follows rise above high-volume publishers. Following a newsroom adds its best headlines without taking over.
- An account with no follows and no topics still gets a newness-led Feed with networks and authors spread out. "Why this?" says what to do about it, as before.
- The Worker (`get_feed` for agents) uses the same `runLens`, so agents see the same order.
- Not done: candidates from people the viewer follows on Farcaster or other networks. The networks' streams are still public ones. Reading a connected account's follow graph is the next step toward a fuller "in-network" source.

# ADR 0006: Blockchain social networks in Feed

- Status: accepted
- Date: 2026-10-21

## Context

The builder prompt asks Feed to be one place for a person's social world, including "emerging open networks", while keeping the feed transparent: Raw is "chronological eligible content", Relevant uses only disclosed signals, and "Global destruction is exceptional. Filtering is normal." It also rules out a crypto aesthetic and mandatory wallets.

We surveyed blockchain-based social networks (October 2026) and tested which ones serve public posts without an account, key, or payment:

| Network | Where data lives | Public read used | Notes |
|---|---|---|---|
| Farcaster | Accounts on Optimism; casts on Snapchain | Farcaster-run Snapchain node `crackle.farcaster.xyz:3381` (fallback `haatz.quilibrium.com`), `castsByParent` and `userDataByFid` | Neynar's hosted API now requires a key or x402 payment. Ownership moved from Merkle to Neynar (Jan 2026) and is moving again to Network School (Oct 2026); the protocol still serves reads. |
| Lens | Lens Chain (Ethereum L2) | `api.lens.xyz/graphql` `posts` query | Unfiltered newest posts include explicit spam links; Lens publishes a 0–10,000 account score for likely-human accounts. |
| Hive | Hive L1 | `api.hive.blog` `bridge.get_ranked_posts` with `sort: created` | Long-form posts; community downvotes gray or hide posts on-chain. |
| DeSo | DeSo L1 | `node.deso.org/api/v0/get-posts-stateless` | Short posts; many automated accounts but little harmful spam. |

All four allow cross-origin requests, so the app can read them directly on web, iOS, and Android. Not included: Nostr and Bluesky (open protocols, but not blockchains; candidates for a later "open networks" connector), Steemit (Hive is the larger fork), and SocialFi apps without a public read API.

## Decision

- Read-only connectors (`src/connectors/networkFeeds.ts`) implement the existing `CommunicationConnector.fetchFeed` contract and appear in the connector catalog with `read-feed` available and `publish-post` unavailable, with a stated reason.
- Pure normalizers (`src/domain/networkPosts.ts`) map each network's records into the canonical `SocialPost`, keeping provenance (`connectorId`, external ID, canonical URL) so every post links to its original.
- **Selection is chronological, never a network's engagement ranking.** We read Hive `created`, not `trending`, and DeSo's newest posts, not its `hot` feed, so Raw stays truly chronological and Relevant does not import another platform's hidden algorithm. Farcaster reads the newest top-level casts in four large channels (/farcaster, /ethereum, /dev, /design).
- **Filters are published defaults at the doorway scope.** Each network's filters are listed in code and shown verbatim in "Why this?" for every post, with a note that filtered posts stay on their network:
  - Farcaster: accounts without a username or profile photo, replies, empty casts.
  - Lens: accounts below a 5,000 / 10,000 account score (the scores cluster near 0 and near 10,000, so the threshold is not sensitive), posts with an author content warning, replies, reposts.
  - Hive: posts grayed or hidden by Hive community downvotes, posts tagged NSFW.
  - DeSo: posts hidden by the author or the network, accounts without a username, replies, reposts without text.
- Identical casts by the same Farcaster account across channels collapse to the newest copy. This removes duplicates and filters nothing.
- Feed is continuous and live: it loads older pages as the reader nears the end, and checks every source for new posts every 20 seconds while the app is in the foreground. New posts are inserted only while the reader is at the very top; otherwise a “N new posts” pill offers them (the common pattern in mainstream feeds), so content never shifts under a reader. Live updates poll each source's newest page, so a source that publishes more than a page between checks can leave a gap that is not backfilled.
- Each source loads and fails independently. One unreachable network shows a quiet notice and never empties Feed.
- Only HTTPS URLs from network data are loaded or opened. Network text is rendered as plain text. No viewer data is sent beyond ordinary HTTP requests.
- Visual treatment stays content-first: the network name is a quiet word in the post's metadata line. No chain badges, token amounts, or creator-coin prices.

## Consequences

- Signed-out visitors and members see a much fuller Feed immediately, even while Open Media's own backend is unavailable.
- The filters are fixed defaults. The user-configurable sensitivity ("Relaxed ── Strict") and community or jurisdiction filtering scopes from the builder prompt are not implemented. The per-post disclosure keeps the defaults inspectable until then.
- Public endpoints can change, rate-limit, or disappear (Farcaster ownership is in flux). A failing endpoint degrades to a notice, but someone must update the connector.
- Posting, replying, liking, and following on these networks would need each person's own signer (wallet or delegated key) and are out of scope. Video playback, image galleries, and Farcaster engagement counts are not implemented.

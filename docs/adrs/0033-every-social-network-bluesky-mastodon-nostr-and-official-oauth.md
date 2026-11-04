# ADR 0033: Every social network: Bluesky, Mastodon and Nostr, plus official OAuth posting to X, Threads, LinkedIn, Instagram and Facebook

- Status: **accepted; built and tested locally on the web** (2026-11-04). Not deployed. No real account has been connected to any of the new networks yet: that needs the owner's own accounts, and for X, Threads, LinkedIn, Instagram and Facebook, Open Media's developer apps there. iOS and Android not tested.

## Context

The owner asked for "all the 3p integrations", with every messaging and social connection present and ready. The master builder prompt (§4.1, §10, §12, §13) names the networks a person should never have to jump between: Instagram, X, LinkedIn, Facebook, email, messaging, and the open networks (Bluesky, Mastodon, Nostr, Farcaster). It also sets the rules: official APIs and protocols only, never scraping, capabilities advertised honestly, one tap → everywhere, and progressive disclosure in the composer.

Before this change:

- **Messaging** already covered twelve networks through opt-in bridges (ADR 0011): WhatsApp, Signal, Telegram, Google Messages, Google Voice, Instagram, Messenger, LinkedIn, X, Bluesky, Slack and Discord. iMessage, Snapchat, TikTok and Google Chat have no maintained bridge.
- **Social** covered only the four blockchain networks (Farcaster, Lens, Hive, DeSo; ADRs 0006 and 0007). ActivityPub and AT Protocol were listed as "Planned", and X, Threads, LinkedIn, Instagram and Facebook were missing or marked unavailable.

## Decision

### 1. Three open protocols become full networks: read, post, like, reshare, comment

| Network | Reads (no account) | How a person connects | What Open Media holds |
|---|---|---|---|
| **Bluesky** (AT Protocol) | `app.bsky.feed.searchPosts?q=*&sort=latest` on the public AppView, which is Bluesky's chronological view of every public post | Handle + an **app password** (Bluesky → Settings → Privacy and security → App passwords). The account's own server (PDS) is found from its DID document. | Only the session tokens, on this device. Never the app password. |
| **Mastodon** (ActivityPub) | The federated public timeline of `mas.to`, a large general server that allows anonymous reads (mastodon.social doesn't) | **Any server**: Open Media registers itself there (`/api/v1/apps`), then OAuth with PKCE in a sign-in window. Scopes: `read:accounts read:search write:statuses write:favourites`. | The token, on this device. |
| **Nostr** | `kind 1` notes from four large public relays (`relay.damus.io`, `nos.lol`, `relay.primal.net`, `relay.nostr.band`), with every signature checked | A **browser signer extension** (NIP-07) on web when one is installed; otherwise a **remote signer** (NIP-46 "Nostr Connect": Amber, Primal, nsec.app) by QR code or link. | A random connection key for talking to the signer. Never the nsec. |

The rules match the other networks: newest first, no network's engagement ranking, a few published filters shown in "Why this?" (Bluesky's moderation labels for spam, adult and graphic content; Mastodon content warnings, bots, replies and boosts; Nostr notes without a valid signature or from accounts without a published name and photo, which is common for spam). Search uses each network's own public search (Bluesky search, Mastodon hashtags, NIP-50 relay search), and profiles read an account's own posts (`getAuthorFeed`, `accounts/lookup`, NIP-05 or npub).

Cross-posting fits each network's limits before publishing: 300 graphemes on Bluesky (with link and hashtag facets in UTF-8 byte offsets), 500 characters on Mastodon (sent with an `Idempotency-Key`), and hashtags become `t` tags on Nostr. A video goes as a link to Open Media's copy. Likes, reshares and comments from the Feed's existing icons go to the network through the connected account (Mastodon finds the post on the person's own server first).

NIP-44 v2 (the encryption NIP-46 uses) is implemented from the NIP with the audited `@noble` primitives, and checked against the NIP's published test vector.

### 2. Closed networks: posting through their official OAuth APIs

X, Threads, LinkedIn, Instagram and Facebook only allow posting through an app they have approved, and that app's secret can't live in a public app. So:

- `services/mail-sync/src/socialOAuth.ts` is a **pass-through**. It builds the authorize URL, receives the network's redirect at `/v1/social/<network>/callback`, sends the browser back into the app (`/auth` on web, `openmedia://oauth` on phones), exchanges the code with the app secret, and forwards posts. **It stores nothing.** The person's token goes back to their device, which sends it with each post, as with every other network. Every call except the redirect needs an Open Media session, and calls are rate limited.
- The `state` value is random and says only where to return (web page or phone app). Anything else is refused, so the redirect can't be pointed elsewhere.
- What each network gets:
  - **X**: `POST /2/tweets`, with OAuth 2.0 PKCE. Tokens last two hours and are refreshed on the way.
  - **Threads**: a container, then `threads_publish`, with a long-lived token.
  - **LinkedIn**: `POST /rest/posts` as the member (`w_member_social`), with LinkedIn's reserved characters escaped.
  - **Instagram**: professional accounts only, and video only, as a Reel. Instagram's API doesn't accept text-only posts, and the composer says so before publishing.
  - **Facebook**: Pages only, because Facebook doesn't let apps post to personal profiles. Open Media uses the first Page the person manages.
- Until the owner registers the apps and sets the secrets (`X_CLIENT_ID`/`X_CLIENT_SECRET`, `THREADS_APP_ID`/`THREADS_APP_SECRET`, `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`, `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`), `/v1/social/status` reports them as off, and the app shows them under **Coming soon**. Each turns on by itself when its secret is set, with no new build.
- These networks are destinations only. None offers a free public API for reading feeds, and Open Media doesn't scrape.
- **Not possible today**, and said so in Settings: YouTube uploads (Google's verification and audit), TikTok (audited Content Posting API), Snapchat (no posting or chat API).

### 3. Design: one calm overview, nothing new to learn

No new buttons (owner rule). The existing screens got clearer:

- **Settings → Connections** now shows every network as a monochrome mark (`src/ui/NetworkMark.tsx`): its logo glyph where the icon font has one, otherwise a lettermark. They're grouped into Social networks, Chat apps and Email. Bright marks work now, faded ones are waiting, and a green dot means connected. One plain line under each group says what is missing. This replaces a bare text list of "On / Planned / Not available".
- **Settings → Cross-posting** groups networks into *Connected*, *Ready to connect*, *Needs an app on this device* (Lens's wallet, Hive Keychain) and *Coming soon* (a single row of faded marks). Each row says in a few words what connecting asks for. Connected rows keep the "include by default" switch, with Disconnect as a quiet link. App passwords are typed into a masked field.
- **The composer** lists only connected networks, plus one line such as "Connect Bluesky, Mastodon, Nostr and 1 more in Settings → Cross-posting", instead of a row for each of twelve networks.
- Approval QR codes are now drawn with plain views (`src/ui/QrGrid.tsx`) everywhere. The `<Image>` data-URI version drew nothing on web, which also affected Farcaster's QR.

## Consequences

- Open Media now reads seven networks and can post to twelve. Five of the twelve wait only on their app approval.
- Cross-posting destinations are `DestinationId = NetworkId | OAuthNetworkId`. Feed-only code still uses `NetworkId`.
- The web app's `/auth` page also ends network sign-in windows: `src/connectors/publishing/oauthCallback.ts` runs before the app, hands the result to the opening tab over a `BroadcastChannel`, and closes the window. Supabase sign-in ignores those callbacks (`state` starts with `omc_`).
- Bluesky is both a chat network (bridged DMs) and a feed network, so its feed entry in the catalog is `bluesky-posts`.
- The Mastodon reading server (`mas.to`) is one server's view of the fediverse. If it stops allowing anonymous reads, switch `mastodonReadingServer`.
- Nostr reads open WebSockets to four relays from the browser. Agents' feed calls do the same from the Worker, and a relay that can't be reached is skipped.

## Owner steps

1. Register Open Media's apps and set the Worker secrets above. Each network's redirect URL is `https://openmedia.site/v1/social/<network>/callback`. X needs a paid API tier for posting volume beyond the free limit. Threads, Instagram and Facebook need Meta app review. LinkedIn needs the "Share on LinkedIn" product.
2. Try each open network with a real account: a Bluesky app password, a Mastodon account, and a Nostr signer app.
3. Phones: new build, then check the `openmedia://oauth` return and the Nostr signer deep link.

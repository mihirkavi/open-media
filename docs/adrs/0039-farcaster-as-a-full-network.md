# ADR 0039: Farcaster as a full network

- Status: **accepted; built and tested locally** (2026-11-11). Reading was verified on the web against live Farcaster data. Writing is verified byte-for-byte against the official `@farcaster/core` SDK, but nobody has sent a live message with it: production has no Open Media Farcaster app account yet (`/v1/cross-posting/status` reports `farcaster: false`). iOS Simulator and Android not run for this change.
- Builds on: [ADR 0006](0006-blockchain-social-networks-in-feed.md) (reading), [ADR 0007](0007-cross-posting-to-blockchain-networks.md) (signer and cross-posting), [ADR 0024](0024-web-feeds-rss-atom-json-feed.md) (link reactions), [ADR 0033](0033-every-social-network-bluesky-mastodon-nostr-and-official-oauth.md) (the shared connector pattern).
- Owner rules: no new buttons or screens. Official protocols only (builder prompt §12–13). Never claim a capability the code doesn't have.

## Context

The owner asked for "all features and everything which could be integrated" for Farcaster. Before this change Open Media read casts from four channels and could post, reply, like and recast once someone connected. We checked the protocol's current state on 2026-11-11, using the `farcasterxyz/snapchain` source, the docs and live endpoints:

- **Ownership.** Neynar bought Farcaster in January 2026, then on 2026-10-15 passed the app and the protocol repositories to Network School. The protocol, the public Snapchain nodes and `api.farcaster.xyz/v2/signed-key-request` all still work. No policy for third-party apps has been published yet.
- **Protocol version 21 (2026-10-23).** Long casts (321 to 1,024 bytes) and "10k" casts (up to 10,000 bytes) are open to every account. Each cast can carry 4 embeds and 10 mentions.
- **Direct casts (DMs)** are not part of the protocol. Sending needs an API key from a private program, and there is no API for reading them.
- **On-protocol channels** exist in the code, but mainnet hasn't switched them on (they wait for protocol version 24). Channel lists and follows come from Farcaster's own HTTP API.

We found two defects:

1. **Mentions were dropped.** Farcaster keeps "@name" out of a cast's text and stores the mentioned accounts with their byte offsets instead. Open Media showed the text with gaps: "On Ethereum privacy's last mile:  private …".
2. **Quote casts lost what they quoted.**

## Decision

### Reading (no account needed)

- **Mentions.** `textWithMentions` (`src/domain/farcasterCasts.ts`) puts each "@username" back at its UTF-8 byte offset. This happens in the Feed, Clips, profile timelines, link comments and replies. The existing rich-text code then links each name to that person's Farcaster profile.
- **Quote casts.** The quoted cast is read by id (`castById`, at most 20 per page) and shown inside the post as a bordered quote. Tapping it opens the cast on Farcaster. `SocialPost.quote` is network-neutral, so other networks can use it later.
- **Replies.** The comment button on a Farcaster post now opens that cast's replies inside Open Media (`castsByParent?fid&hash`, newest 100), with no account needed. If you haven't connected Farcaster, the reply box becomes "Reply on Farcaster, or connect Farcaster in Settings → Cross-posting to reply here". The reply count catches up with the replies actually loaded.
- **Profiles.** A Farcaster person's profile now shows their bio, link and location. Farcaster stores a location as a geo URI; only a plain place name is shown, so a geo URI is hidden. It also shows follower and following counts, counted from their follow links up to 5,000 and shown as "5,000+" beyond that.
- **Your channels.** With Farcaster connected, the Feed reads up to eight channels you follow, using each channel's exact `url` from `api.farcaster.xyz/v1/user-following-channels`. Without a connection it reads the four default channels. "Why this?" says "a channel you follow". The account number used for this is stored apart from the signing key, so reading never touches the key.

### Writing (with the person's connected account)

All new messages are encoded by the same small protobuf writer. Each is checked byte-for-byte, hash and signature, against `@farcaster/core` in `farcasterMessage.test.ts`.

- **Long casts.** Text over 320 bytes goes out as a long cast, and over 1,024 bytes as a 10k cast, typed by size. The cross-posting limit rises from 320 to 10,000 bytes, and the composer notes "Goes to Farcaster as a long cast". The server relay's message limit rises to fit the 16 KB data a 10k cast may carry.
- **Mentions.** Before a post or reply is sent, each "@name" is looked up on Snapchain (`userNameProofByName`, which covers fnames and `.eth` names). A name that resolves becomes a real mention, so the person is notified. Names that don't resolve, and any after the tenth, stay as plain text. Email addresses are never mistaken for mentions.
- **Undo.** Likes and recasts on Farcaster posts can be taken back from the Feed (ReactionRemove). The connector interface gains an optional `undo`; networks without it still say "To undo it, use <network>".
- **Delete.** Deleting an Open Media post also deletes the Farcaster copy this device published (CastRemove), best effort. The connector interface gains an optional `removeCopy`. The delete confirmation says that Farcaster copies go too and other networks keep theirs.
- **Follow.** A Farcaster person's profile shows Follow / Following when you've connected Farcaster (LinkAdd / LinkRemove, checked with `linkById`). It reuses the existing Follow button.
- **Coming back to the app.** On phones the signed key request carries `redirectUrl: openmedia://farcaster`, so the Farcaster app returns people to Open Media after they approve. The server accepts only Open Media's own app links.

### Not built, and why

- **Direct casts.** These are off-protocol and need a private API key; there is no read API. Not built.
- **Mini apps.** Hosting one needs the full host SDK (wallet provider, sign-in and notifications) in a web view. Links to mini apps still open in the browser.
- **Following feed.** Snapchain has no feed endpoint, and building one means a request per followed account on every refresh. The channels you follow cover part of this for now.
- **Posting into a channel.** The composer has no place to choose a channel without a new control. Replies already land in the right thread.
- **Editing your Farcaster profile from Open Media (UserDataAdd).** This would need a new control. Not built.
- **People search.** Search has no people section for any network. It's a separate design decision.
- **Notifications.** Open Media has no notifications screen yet. A future one could read mentions (`castsByMention`), replies, reactions and follows from Snapchain.

## Owner setup to turn writing on

1. Create a Farcaster account for Open Media (the "app" identity people see when they approve). Keep its recovery phrase safe.
2. Set the Worker secrets: `npx wrangler secret put FARCASTER_APP_FID` and `npx wrangler secret put FARCASTER_APP_MNEMONIC`. Never put the phrase in chat or a file.
3. Deploy. `/v1/cross-posting/status` then reports `farcaster: true`, and Connect appears in Settings → Cross-posting.

## Consequences

- Farcaster is the first network where Open Media can read replies, take back likes and recasts, follow, and delete copies. The optional `undo` and `removeCopy` hooks let other connectors add the same later.
- Reading costs a few more public requests: quoted casts, mentioned profiles, two follow-count reads per Farcaster profile opened, and one channel-list read per 30 minutes with an account connected. All of them fail quietly.
- Network School may change `api.farcaster.xyz` or the public nodes. The signed key request and the channel list depend on it; casts and everything else come from Snapchain.

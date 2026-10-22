# ADR 0007: Cross-posting to blockchain social networks

- Status: accepted
- Date: 2026-10-21

## Context

The builder prompt's central V1 experience is "one tap → everywhere": a post is created once as a canonical Open Media post and goes to every authorized network through a connector gateway. The composer must not show "a forest of provider buttons" ("Sharing to: Open Media + 4", with the destinations revealed on tap), and defaults live in Settings → Cross-posting. Wallets must never be required to use Open Media, and Open Media must never ask for main keys.

The owner asked that posts go to every platform by default. Feed already reads Farcaster, Lens, Hive, and DeSo (ADR 0006). We researched each network's delegated-posting method in October 2026:

| Network | Delegation used | Platforms now | Owner setup | Cost to the person |
|---|---|---|---|---|
| Farcaster | Signed key request: the device makes an Ed25519 key, Open Media's app account signs an EIP-712 request, and the person approves it in the Farcaster app | Web (QR code), iOS, Android (deep link) | An Open Media Farcaster account (about $10 of ETH on OP Mainnet), set as Worker secrets `FARCASTER_APP_FID` and `FARCASTER_APP_MNEMONIC` | Gas to add the key, unless Farcaster makes it gasless or the app sponsors it |
| Lens | Lens login (SIWE signed in the person's wallet), then a Lens session; post metadata on Grove; post as a Lens Chain transaction | Web with a browser wallet | Optional now (Lens's public test app); register Open Media's own Lens app before launch (`EXPO_PUBLIC_LENS_APP_ADDRESS`) | A fraction of a cent in GHO per post, unless sponsored |
| Hive | Hive Keychain extension signs each post; Open Media stores only the account name | Web with Hive Keychain | None | Resource Credits (free for active accounts); one root post per 5 minutes |
| DeSo | DeSo Identity derived key limited to posting and 0.01 DESO total fees | Web | None | Well under a cent per post |

Not chosen yet: HiveSigner (needs an Open Media Hive app account and HTTPS universal links, because it rejects custom-scheme callbacks), WalletConnect for Lens on phones (needs a project ID and native wallet plumbing), and the DeSo SDK on phones (needs crypto shims and a WebView crypto bridge on Hermes).

## Decision

- **Default destination = every connected network.** `defaultDestinations` returns all connected networks unless the person turns one off in Settings → Cross-posting. The composer shows one line, "Sharing to Open Media + N", which expands to a checklist for this post only. Open Media is always included.
- **Canonical first.** The Open Media post is saved first. Then `crossPost` publishes to each chosen network in parallel and reports, per network, published / skipped (with the reason) / failed (with Try again).
- **Error prevention before publishing.** `prepareCrossPost` fits the text to each network: Farcaster counts UTF-8 bytes (320), and Hive gets a short title from the first sentence. A destination the text can't go to unchanged is flagged in the checklist before Post.
- **Idempotent retries.** Each network copy is keyed by the post's client ID and remembered locally, so Try again never double-posts. Hive permlinks and Lens metadata IDs are also derived from that key.
- **Delegation only, keys stay on the device.** Farcaster's Ed25519 key and the Lens refresh token are stored in the device keychain on phones and in browser storage on web, like the Open Media session. The DeSo derived key is managed by DeSo's SDK in the browser. Hive keys never leave Keychain. Open Media's server holds only its own Farcaster app mnemonic, signs only public keys, and relays only already-signed cast bytes (browsers can't post to Snapchain directly).
- **Small, verified Farcaster client.** Casts are encoded with a minimal protobuf writer plus audited `@noble` Ed25519 and BLAKE3, not the 5 MB+ official SDK. A test checks the bytes, hash, and signature against `@farcaster/core` exactly.
- **Honest availability.** Each connector reports `available`, or unavailable with `setup: 'owner'` ("Coming soon") or `setup: 'device'` (for example "Install Hive Keychain"). Nothing appears connectable unless it can work.

## Consequences

- Posting to all four networks works from the web app once the person connects each network. On iOS and Android, only Farcaster is possible today, and only after the owner creates Open Media's Farcaster account.
- Nobody has published live to any network with these connectors yet. Each needs a real account on that network. The Farcaster encoding is verified byte-for-byte against the official SDK. The Lens, Hive, and DeSo flows follow each network's current documentation and SDK source, but each still needs a first real post to confirm.
- Lens posts cost GHO unless the owner funds a Lens sponsorship. A sponsored-transaction response is reported as unsupported for now.
- Hive limits accounts to one new root post every 5 minutes. A second post within that window is reported clearly and can be retried.
- Farcaster's ownership is changing (Network School, October 2026). The signed-key-request API is isolated behind one Worker route and one connector.

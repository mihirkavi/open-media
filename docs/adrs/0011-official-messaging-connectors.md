# ADR 0011: Outside messaging networks through official APIs only

- Status: accepted as a plan (nothing in this ADR is implemented yet)
- Date: 2026-10-23

## Context

The owner wants Messages to include as many outside messaging networks as possible, like Beeper. Beeper does this with **bridges**: programs that log in to a person's WhatsApp, Instagram, LinkedIn, X or Discord account the way the network's own web or desktop app does (website session cookies or a reverse-engineered app protocol) and copy chats into Matrix ([Beeper developer docs](https://developers.beeper.com/desktop-api-reference/cli), [mautrix bridges](https://mau.fi/blog/2026-04-mautrix-release/)).

The master builder prompt decides this. It says to "support as many legitimate third-party integrations as technically possible" and to unify networks "where APIs and protocols permit", but also: "Use official APIs and protocols. Do not rely on unauthorized scraping." (`docs/MASTER_BUILDER_PROMPT.md`, Connector architecture; Phase 1 brief item 11: "never scrape"). It adds: "Ship a small number of reliable integrations first. Do not attempt every closed social network simultaneously." and that unsupported functionality must never be pretended.

A first draft of this ADR proposed running Beeper-style bridges. That draft is withdrawn: logging in as the user through an unofficial client is the unauthorized access the master plan rules out, it puts users' accounts at risk of bans, and server-side bridges would let Open Media read their private chats.

## Decision

Open Media connects outside messaging only through each network's official API or an open protocol. Networks without one stay "Not available" in Settings, with the reason shown.

| Network | Official route | Who it works for | Owner setup | Order |
|---|---|---|---|---|
| Bluesky DMs | Bluesky chat API (`chat.bsky.convo.*`), signed in with Bluesky OAuth (`transition:chat.bsky` scope) or an app password that allows DMs ([atproto scopes](https://atproto.com/guides/scopes), [atproto PR 2734](https://github.com/bluesky-social/atproto/pull/2734)) | Everyone with a Bluesky account | None | 1 |
| Matrix | The open Matrix client-server protocol: each person signs in to their own homeserver (matrix.org or any other) | Everyone with a Matrix account | None; replaces the single-account sandbox | 1 |
| Telegram | Telegram's official client API (MTProto), which Telegram opens to third-party apps | Everyone with Telegram | Register an API ID at my.telegram.org | 2 |
| Email (Gmail, Outlook) | Gmail API / Microsoft Graph with OAuth (already in the master plan's V1 email scope; IMAP works today) | Everyone | Google Cloud and Azure app registrations; Gmail's restricted scopes need Google verification | 2 |
| Slack | Slack Web API with user OAuth scopes | People whose workspace allows the app | Create a Slack app | 3 |
| Instagram DMs, Facebook Page messages | Meta Messenger Platform / Instagram Messaging API | Professional (Business or Creator) accounts only; 24-hour reply window ([overview](https://www.blotato.com/blog/social-media-api)) | Meta app, App Review, business verification | 3 |
| X DMs | X API direct-message endpoints | Everyone, but only on X's paid API tiers | Paid X developer account | 3 (if cost is acceptable) |
| WhatsApp | WhatsApp Business Platform (Cloud API) | Business phone numbers only; not personal WhatsApp | Meta business setup | Later, as a business inbox |

**Not available (no official API for personal messages):** personal WhatsApp, personal Instagram DMs, LinkedIn messages (partner-only API), Signal, Google Messages, Discord DMs, iMessage, Snapchat, TikTok. Settings already shows Instagram, LinkedIn, Snapchat and TikTok as "Not available"; that stays, with clearer wording that names the missing official API.

## How it is built

- **No new servers.** Bluesky, Matrix and Telegram connect from the person's own device (web, iOS, Android) to the network, so their tokens and messages never pass through Open Media. Where a server is needed (Meta and Slack webhooks, Gmail/Outlook token refresh), it runs on the existing Cloudflare Worker with encrypted, revocable credentials, as the mail service already does.
- **Same connector boundary.** Each network implements the capability-negotiated connector in `src/connectors` (read, send, realtime, attachments, revoke) and only advertises what really works. Chats appear in Messages around canonical people, labeled with their network, and are never described as end-to-end encrypted Open Media messages.
- **Device storage.** Tokens are kept in the device's secure storage (Keychain/Keystore; encrypted storage on web), and disconnecting revokes them where the network supports revocation.
- **Verification.** Each network is tested on web, iOS and Android with a real test account before its Settings row changes from "Planned" to available.

## Owner decisions (answered from the master plan)

1. *Run Beeper-style bridges on Open Media's server?* **No.** They rely on unauthorized logins, which the master plan forbids.
2. *Which server host and domain?* **None needed.** The first networks connect from the device; server pieces use the existing Worker.
3. *Spare WhatsApp number for testing?* **Not needed.** Personal WhatsApp has no official API.
4. *Ship on iPhone, or hide until App Store review?* **Ship on all platforms.** Official APIs don't carry the App Store risk that bridges do.

## Consequences

- Fewer networks than Beeper, but every connection is legitimate, revocable, and doesn't risk the user's account.
- Bluesky DMs and Matrix can be built now with no owner setup. Telegram, Gmail/Outlook OAuth, Slack, Meta and X each need a developer registration by the owner first.
- If WhatsApp, LinkedIn or another network opens an official messaging API later, it fits the same connector boundary.

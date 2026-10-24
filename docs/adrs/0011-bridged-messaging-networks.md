# ADR 0011: Bridged messaging networks (WhatsApp first)

- Status: proposed (plan only; nothing in this ADR is implemented)
- Date: 2026-10-23

## Context

The owner wants Open Media's Messages to include as many outside messaging networks as possible, the way Beeper does: WhatsApp, Instagram, LinkedIn and others. None of these networks offers an official API for reading and sending a person's own private messages. Settings currently marks Instagram, LinkedIn, Snapchat and TikTok "Not available", and Matrix is a local, single-account sandbox (`services/matrix-bridge`, "Planned" in the catalog).

Beeper connects these networks with **bridges**: open-source programs that log in to a person's account the way the network's own web or desktop app does, then copy conversations into Matrix. Most are the [mautrix bridges](https://mau.fi/blog/2026-04-mautrix-release/) (AGPL-3.0, written in Go on the shared `bridgev2` framework). Beeper's own list of supported networks: WhatsApp, iMessage, Telegram, Discord, Signal, Instagram DMs, Facebook Messenger, X DMs, LinkedIn, Slack, Google Messages (RCS/SMS), Google Chat, Matrix, IRC and Bluesky ([Beeper developer docs](https://developers.beeper.com/desktop-api-reference/cli)). Since 2025 Beeper also offers "Beeper On-Device", which runs the bridges on the user's own device so Beeper's servers never hold message content or network sessions; its older cloud-hosted bridges remain available and are planned to be retired ([AlternativeTo](https://alternativeto.net/news/2025/7/beeper-relaunches-with-on-device-model-new-features-and-text-com-merged-services), [Thurrott](https://www.thurrott.com/?p=323458)).

## Networks

Login method and risk as of October 2026. "Risk" is the chance the network restricts or bans an account that uses an unofficial client; it is a judgment, not a guarantee.

| Network | Bridge | How a person connects | Maturity | Account risk | Phase |
|---|---|---|---|---|---|
| WhatsApp | mautrix-whatsapp | Scan a QR code (becomes a linked device, like WhatsApp Web) | Mature | Medium | 1 |
| Telegram | mautrix-telegram (Go rewrite released 2026) | Phone number + code | Mature; Telegram allows third-party clients | Low | 2 |
| Signal | mautrix-signal | Scan a QR code (linked device) | Mature | Low–medium | 2 |
| Google Messages (RCS/SMS, Android phones) | mautrix-gmessages | Scan a QR code (like Messages for web) | Mature | Low–medium | 2 |
| Bluesky DMs | mautrix-bluesky, or Bluesky's official chat API directly | App password | Newer | Low (official API exists) | 2 |
| Instagram DMs, Facebook Messenger | mautrix-meta | Web login session (cookies) | Mature, breaks when Meta changes its site | High | 3 |
| LinkedIn | mautrix-linkedin | Web login session (cookies) | Works, fragile | High | 3 |
| X (Twitter) DMs | mautrix-twitter | Web login session (cookies) | Fragile | High | 3 |
| Slack | mautrix-slack | Workspace login or token | Mature | Workspace policy dependent | 3 |
| Discord | mautrix-discord (bridgev2 rewrite still in progress) | Login token | Legacy bridge | High (user-account automation is against Discord's terms) | 3 |
| Google Chat | Community bridgev2 port (pre-alpha) | Google login cookies | Pre-alpha | Medium | Later |
| iMessage | Needs a Mac (or jailbroken iPhone) running a relay for each user | — | Not practical for Open Media | — | No |
| Snapchat, TikTok | No maintained bridge | — | — | — | No |

## Options

1. **Bridges on Open Media's servers (recommended first).** Run a Matrix homeserver plus the bridges. Each Open Media user gets a hidden Matrix account; bridges are multi-user, so one WhatsApp bridge serves everyone. Fastest to build and works the same on web, iOS and Android. Cost: Open Media's servers hold each person's network session and can read their bridged messages, so this needs encryption at rest, strict access control, and honest disclosure.
2. **Bridges on the person's device (Beeper's current model).** Compile the Go bridges into the iOS/Android app (gomobile) and a desktop helper for the web. Best privacy: sessions and messages stay on the device. Much more work, background-execution limits on iOS make it unreliable while the app is closed, and the web app can't run it at all.
3. **Partner with Beeper.** Beeper has no public API for embedding its connections in another app, so this isn't available today.

**Decision (proposed):** start with option 1 for WhatsApp, keep the provider boundary clean (`src/connectors`) so a later on-device connector can replace it network by network, and revisit option 2 once usage justifies it.

## Plan

### Phase 0: infrastructure (about 1 week)
- A small Linux server (Cloudflare Workers can't run long-lived bridges): Docker Compose with a Matrix homeserver, PostgreSQL 16, and the bridges. Homeserver: **Synapse** (reference implementation, widest bridge compatibility) unless memory is tight, in which case continuwuity (lighter Rust server, fewer admin tools).
- Federation off: this homeserver exists only to host bridges, not as a public Matrix server.
- Replace the sandbox gateway with a production Matrix gateway in the Worker or on the same server: authenticate every request with the Supabase session, map each Open Media user to their own Matrix account and token, and never share sync state between users.
- Encrypt bridge databases and backups; keep the server's admin access to the owner.

### Phase 1: WhatsApp (about 2 weeks)
- **Connect screen** (Settings → Connections → WhatsApp): explains the risk in plain words before anything starts ("WhatsApp doesn't officially support this. Your account could be limited. Open Media's server will hold your WhatsApp session and can read these chats."), then shows the QR code from the bridge's login API. On a phone, the QR can't be scanned with the same phone, so also offer WhatsApp's "link with phone number" code where the bridge supports it.
- Bridged chats appear in Messages next to Open Media chats, labeled "WhatsApp", using the existing normalized conversation model (`mapMatrixSnapshot`). Send text first; images, voice notes, reactions and read receipts after.
- Disconnect removes the linked device and deletes that person's bridged data.
- WhatsApp rules to explain in the UI: up to 4 linked devices, and linked devices are logged out if the phone isn't used for 14 days ([Tech Advisor](https://www.techadvisor.com/article/1797903/whatsapp-on-multiple-phones.html)).
- Verified on web, iOS and Android with a real test WhatsApp number (not the owner's main account).

### Phase 2: Telegram, Signal, Google Messages, Bluesky (about 1 week each once Phase 1 exists)
Same connect pattern; most work is per-network login screens. Bluesky DMs may use Bluesky's official chat API instead of a bridge.

### Phase 3: Instagram/Messenger, LinkedIn, X, Slack, Discord
Cookie-based logins with the highest ban risk and the most breakage. Ship each behind an explicit "experimental" label, one at a time, only after Phase 1–2 are stable.

## Costs

- Server: about $10–25/month for a small VM (4 GB RAM) that comfortably runs Synapse, PostgreSQL and several bridges for early testers; more as users grow. Backups add a few dollars.
- A domain or subdomain for the homeserver (e.g. `matrix.<open-media-domain>`).
- Ongoing maintenance: bridges need updating when networks change their apps, sometimes urgently.

## Risks and obligations

- **Account bans.** Strongest for Instagram, LinkedIn, X and Discord. Always opt-in, per network, with the warning shown before connecting.
- **Privacy.** Server-side bridges can read bridged messages. This must be stated in the connect screen and privacy policy; on-device bridges remove it later.
- **App Store review.** Apple has acted against apps that bridge closed messaging networks (it cut off Beeper Mini's iMessage access in 2023). WhatsApp-style linked devices are less contentious, but review is a real risk; the iOS app could ship with bridged networks disabled until review accepts them.
- **License.** The bridges are AGPL-3.0. Running them unmodified is fine; any modified bridge must offer its source to its users.
- **Terms of service.** Using these bridges likely breaks the networks' terms. That risk sits with Open Media and each user who opts in.

## Owner decisions needed before building

1. Accept server-side bridges (option 1) for now, with the privacy disclosure.
2. Choose and pay for a server host, and a homeserver domain.
3. A spare WhatsApp number for testing.
4. Whether iOS ships with bridged networks enabled or hidden until App Store review is clear.

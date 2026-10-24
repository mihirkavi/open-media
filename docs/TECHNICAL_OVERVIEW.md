# Open Media technical overview

This is the detailed, engineer-facing companion to the [README](../README.md). It lists exactly what is implemented, how the product behaves, how the code is organized, and every known limitation.

## What works now

- Adaptive Expo/React Native app for iOS, Android, tablets, and web
- Feed, Clips, and Messages as the only primary destinations
- Public Feed for signed-out visitors: anyone can read Open Media posts without an account
- Real text posts: publish from the composer, delete your own posts, and report other people’s posts; posts reported by three different people are hidden for review
- A read-only public JSON API ([docs](../services/mail-sync/PUBLIC_API.md)) with an OpenAPI 3.1 document, pagination, CORS, and per-IP rate limiting, so people and agents can read public posts and profiles. It is served by Open Media’s single production Worker alongside mail sync
- Passwordless onboarding with a live, public Open Media profile and handle (your email stays private)
- Real direct conversations, message persistence, RLS isolation, and realtime delivery through Supabase
- A local-only Matrix room/sending sandbox that demonstrates the connector boundary without claiming production isolation
- Profile, universal Search, Create, and searchable Settings as utilities
- System, Light, and Dark appearance, persisted locally
- **Clips with real short videos**: an immersive vertical stream of short videos from Farcaster, Lens, Hive, and DeSo, one per screen. Swipe or scroll to the next clip. The clip on screen plays muted (tap the speaker for sound, tap the video to pause), only nearby clips are loaded, more clips load as you near the end, and new clips are announced by a pill instead of interrupting the one you're watching. Clips uses the same canonical posts, filters, “Why this?” disclosure, and “Open on …” links as Feed, and the same videos play inline in Feed when tapped. See [ADR 0008](adrs/0008-clips-from-blockchain-networks.md)
- **Post short videos**: add a video (up to 3 minutes and 100 MB) from the composer, or record one on iOS and Android. Before anything leaves the device, Open Media removes location and device details from MP4/MOV files and records the file's SHA-256. The composer shows upload progress, then creates the Open Media post, then cross-posts: Lens and DeSo receive their own copy of the file (Grove and DeSo's Livepeer upload), Farcaster embeds the video link, and Hive (which has no native video) gets a link with the poster. The clip plays in Feed and Clips and is returned by the public API. See [ADR 0009](adrs/0009-short-video-posting.md)
- **Universal search with basic AI**: one search across settings, messages and email (matched on your device only), Open Media posts, and live public posts on Farcaster, Lens, Hive (by tag), and DeSo (newest posts). Plain language works (“videos about ethereum on lens today”), and the app shows what it understood. A short AI summary of what the public posts say, with citations, comes from Workers AI and receives only your search and those public posts. Desktop has a persistent “Search everything” field; phones use the header search button; signed-out visitors can search too. See [ADR 0010](adrs/0010-universal-search.md)
- One canonical `SocialPost` type shared by Feed and Clips
- **WhatsApp and other chat apps in Messages (chat bridges)**: connect WhatsApp, Signal, Google Messages, Google Voice, Instagram, Messenger, LinkedIn, X, Bluesky, Slack and Discord in Settings → Email & connections → Chat networks, each with that network's own sign-in (QR code, pairing code, username and password, an app password, or values copied from a desktop browser) and step-by-step guidance written for it; Telegram is wired the same way and starts once Open Media's Telegram app ID is set. Bridged chats appear in Messages next to Open Media chats and email, labelled with their network, and you can reply from there. The network list in `src/domain/chatNetworks.ts` drives Settings, the connector catalog and the chat labels. This works like Beeper: Open Media runs the open-source mautrix bridge on a private Matrix homeserver (`services/bridges`). It's opt-in and starts with a warning, because WhatsApp doesn't approve these bridges (accounts could be limited) and the bridge server can read bridged chats. The owner chose this over the master plan's official-API rule for messaging. See [ADR 0011](adrs/0011-bridged-messaging-networks.md)
- **Blockchain social networks in Feed**: public posts from Farcaster, Lens, Hive, and DeSo appear in the same Feed as Open Media posts, with no account, wallet, or API key. Open Media reads each network's *newest* public posts (never the network's own engagement ranking), applies a few published filters (for example Lens's likely-human account score, Hive's community downvotes, and author content warnings), and lists the source and filters under “Why this?”. Filtered posts stay on their network; Open Media only leaves them out of this view. Posts from every network are mixed into one stream (no per-network tabs), and every post links to its original. The Feed is continuous and live: older posts load as you scroll, every source is checked for new posts every 20 seconds while the app is open, new posts slide in when you are at the very top, and a “new posts” pill appears instead when you have scrolled down, so nothing moves under you. See [ADR 0006](adrs/0006-blockchain-social-networks-in-feed.md)
- **Post once, publish everywhere**: connect Farcaster, Lens, Hive, or DeSo in Settings → Cross-posting, and every Open Media post also goes to each connected network by default. The composer shows one line, “Sharing to Open Media + N”, which expands so you can leave a network out of a single post. You can also turn a network off by default. Open Media never asks for a seed phrase or main key: Farcaster uses a key you approve in the Farcaster app (it stays on your device), Lens uses a sign-in your wallet approves, Hive posts are signed by Hive Keychain (the browser extension on the web, the Keychain mobile app through HiveAuth on iOS and Android), and DeSo uses a derived key that can only post and spend at most 0.01 DESO. Too-long posts are flagged per network before publishing, results are shown per network, and Try again never double-posts. See [ADR 0007](adrs/0007-cross-posting-to-blockchain-networks.md)
- Raw reverse-chronological feed and a simple Relevant feed with “Why this?” explanations
- Universal local search across loaded posts, conversations, and every indexed setting
- Canonical people with multiple reviewed provider identities and one chronological conversation
- Source-preserving messages and inline email subject context
- Email in Messages: connect any IMAP/POP + SMTP mailbox (presets for Gmail, iCloud, Yahoo, AOL, Fastmail, Zoho, GMX). Your inbox and sent mail appear as people-first conversations next to Open Media chats, sync automatically, and you can reply by email from the thread (threaded with `In-Reply-To`). Emails read like messages: links become tappable words instead of tracking URLs, quoted history is hidden, and long mail collapses. Senders that pass DMARC and publish a BIMI mark certificate show their brand logo and a blue verified check, with the domain always visible. Threads look like iMessage: subjects appear bold inside the bubble only when they change, times are centered separators, and bubbles group by sender. Company senders without BIMI show their site icon, loaded from the company's own domain (people on personal mail providers show initials). Each person, and each company across all its sending addresses, has one chat across every connected mailbox. Photos and files arrive with the email (stored privately, up to 10 per message and 15 MB each); images that load from the sender's servers stay hidden until you tap "Show images", and tracking pixels are dropped. Hover or long-press any message to reply to it, as in iMessage: email replies thread to that exact message, and native replies show a quote
- One-command local app: `npm run local` runs the database, auth, mail service, public API, and web app on your computer; sign-in emails can go to your real inbox through your own SMTP server (`npm run local:email`)
- Supabase auth/database backend, encrypted mailbox credentials, RLS on every exposed user table, reversible message blocking/reporting, in-app data export and account deletion, Contacts review flow, and Apple Foundation Models search boundary
- Capability-negotiated connector contracts that keep unavailable publishing, sending, OAuth, realtime, and attachment features disabled
- **Open Media Events (Layer 1)**: an agent-agnostic event discovery and planning service for ChatGPT, Claude and other MCP clients. It searches Luma, Meetup, Eventbrite and your own ICS or schema.org feeds in parallel, de-duplicates and ranks results with reasons, checks your schedule, places calendar holds you approve on a subscribed iCloud calendar, and hands off registration to the official page. It is served over MCP with OAuth 2.1 at `/mcp`, with a REST/OpenAPI mirror. See [docs/events](events/README.md)

Feed shows live public posts from Open Media and from the four blockchain networks above. Clips shows real short videos (up to 3 minutes) from Open Media and from those networks: Open Media videos in the `post-videos` storage bucket, Lens videos stored on Grove, Farcaster videos, DeSo videos hosted on Livepeer, and Hive videos hosted on 3Speak. Open Media profiles, posts, and native messages are live data.

## Product behavior

`Feed` and `Clips` are two views of the same post model. `Raw` is chronological. `Relevant` currently considers only recency, explicit follows, selected interests, and community membership; it explicitly excludes private messages, exact location, and sensitive-trait inference. Follows and interests are not stored yet, so for live posts Relevant is effectively recency.

**What is public:** every Open Media post, and each profile’s handle, display name, bio, avatar, join date, and post count. **What stays private:** messages, imported email, contacts, blocks, and reports. The composer and Profile say so before anything is published. Deleted posts disappear from the app and API immediately, but copies already read by others cannot be recalled.

`Messages` keeps a person canonical while preserving the source of each message. Open Media-to-Open Media direct messaging is live. Email joins the same list: each mailbox and correspondent becomes a conversation with both directions in order, and replies go out through that mailbox’s SMTP server. Connect mailboxes in **Settings → Connections → Email & contacts**. Imported email is never presented as end-to-end encrypted.

The official APIs of WhatsApp, Facebook Messenger, Instagram, and LinkedIn cover only business numbers, Pages, professional accounts, or approved partners, not personal chats. Personal chats from these networks therefore come only through the opt-in chat bridges described above (see [ADR 0011](adrs/0011-bridged-messaging-networks.md)), which start with a warning about account limits and about the bridge server being able to read bridged chats.

Matrix is an additional transport rather than a replacement for canonical Open Media people. The gateway in `services/matrix-bridge` is currently a local development sandbox: it authenticates one configured account outside the Expo bundle, translates room snapshots into the existing connector model, and sends text events back through the Matrix Client-Server API. It refuses production mode. A public connector still requires per-user authorization and isolation. Provider-specific bridges remain separate services and must not be described as connected until explicitly configured and verified.

## Architecture

```text
App.tsx
  OpenMediaThemeProvider
  OpenMediaApp
    PublicHome (signed out) / FeedView → live public posts (src/data/postService.ts)
                                       + Farcaster, Lens, Hive, DeSo (src/connectors/networkFeeds.ts → src/domain/networkPosts.ts)
    ClipsView              → short videos from Open Media and the same networks (src/ui/ClipsView.tsx, ClipVideo.tsx / ClipVideo.web.tsx)
    OpenMediaMessages     → live Supabase/Matrix conversations + provider-normalized models
    Search / Settings     → indexed local domain search
            │
    connector capability gateway
            │
    Supabase auth/profiles/RLS messaging + Matrix bridge gateway
            │
    existing mail API
            │
services/mail-sync Worker + private Supabase mail schema

People & agents (no account)
            │
same Worker, public /v1/posts and /v1/profiles routes → open_media_public_* functions → public posts/profiles

ChatGPT / Claude / other MCP clients (OAuth 2.1)
            │
same Worker, /mcp and /v1/events/tools/* → src/events engine → D1 (open-media-events)
            │
luma-discovery · structured-event-feeds · calcom-availability (separate public repos)
```

Important boundaries:

- `src/domain`: normalized people, messages, posts, feed logic, search, and settings index
- `src/connectors`: provider-neutral capabilities, safe mock adapter, and mail-service client
- `src/ui`: adaptive Open Media surfaces plus preserved connection/contact UI
- `services/mail-sync`: the single production Worker: mailbox network safety, TLS connection tests, encrypted credentials, import, and the unauthenticated read-only public API (`src/publicApi.ts`)
- `services/mail-sync/src/events`: Open Media Events (Layer 1): provider router, de-duplication, ranking, plan lifecycle, calendar feed, D1 store, MCP/REST tools and OAuth owner sign-in
- `skills`: portable agent skills and YAML workflows for event discovery, planning, registration and personalization
- `services/matrix-bridge`: server-side Matrix authentication, room synchronization, and text sending
- `supabase/migrations`: private mail storage plus Open Media profiles, conversations, messages, realtime, and authenticated RPC/RLS policies
- `docs/OPEN_MEDIA_MIGRATION.md`: current/target architecture, database changes, risks, and phased plan
- `docs/MASTER_BUILDER_PROMPT.md`: the public, self-contained starting brief for the project
- `docs/adrs`: short architectural decisions

## Configuration

Apple Foundation Models requires the native iOS target, iOS 26+, supported hardware, Apple Intelligence enabled, and an available local model. Ordinary search works without it.

Configure `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for onboarding and native messaging. Add the app callback URL to Supabase Auth redirect URLs before distributing a native build. Production should prefer provider OAuth where supported. The client accepts `EXPO_PUBLIC_OPEN_MEDIA_API_URL`; the former `EXPO_PUBLIC_CONVO_API_URL` remains a temporary compatibility alias.

`npm run local` also serves the public API at `http://127.0.0.1:8787/v1/posts` (see [services/mail-sync/PUBLIC_API.md](../services/mail-sync/PUBLIC_API.md)). Set `EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL` to show the open-data link to signed-out visitors.

To test Matrix locally, configure the gateway process from `services/matrix-bridge/.env.example`, run `npm run matrix:server`, and start a development build with `EXPO_PUBLIC_MATRIX_BRIDGE_URL` pointing to that gateway. The app exposes **Try the local Matrix sandbox** only in development. Matrix credentials remain in the gateway process and are never embedded in the Expo client. Never expose the single-account sandbox publicly.

## Validation

```bash
npm run check
npm run test:db # requires the local Supabase stack
npx expo-doctor@latest
```

The check runs app and Worker (mail sync, public API and events) typechecks/tests plus a production web export. `services/mail-sync/scripts/events-e2e.ts` exercises the events service end to end over OAuth and MCP. Generated output stays inside `.expo-dist/` and is ignored.

## Honest limitations

This is a beta, not a finished public social network. Open Media's own videos are stored as uploaded (no transcoding or adaptive streaming) in a public Supabase Storage bucket; Cloudflare Stream is the recommended production host but isn't implemented (see ADR 0009). On a local stack, video links point at `127.0.0.1`, so Farcaster and Hive are skipped with an explanation. Video cross-posting has not been tested against a live network. iOS and Android need a new development build for video picking and recording, and don't make a poster image yet; abandoned uploads aren't cleaned up automatically. Hive videos depend on 3Speak's player API (the same JSON its official embed player loads), which isn't a documented public API and could change. Phones play videos with `expo-video`, which needs a new development build after this change. The public-posts migration and the public API routes are implemented and tested locally; production rollout is tracked in [docs/PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Replies, likes, reposts, follows, public profile pages in the app, server-rendered HTML pages, RSS/Atom feeds, and ActivityPub federation are not implemented; the JSON API is the supported machine interface. Moderation is basic: community reports auto-hide a post, and removal/restoration is a service-role database operation with no operator console yet. Email is plain text only (no HTML bodies or attachments), reads only Inbox and Sent, and signs in with app passwords; Gmail/Outlook OAuth is not implemented, so Microsoft mailboxes that require OAuth will be refused. Email sending, the mail migration, and sign-in emails through custom SMTP are verified locally; production rollout is tracked in the readiness checklist. Cross-posting to Lens works only in the web app for now (it needs a browser wallet; phones would need a WalletConnect project). On iOS and Android, Hive connects through HiveAuth and the Hive Keychain mobile app, and DeSo through DeSo's sign-in page in a system browser sheet; both are implemented and checked against their protocols (HiveAuth payload encryption is tested against OpenSSL), but neither has been approved end to end with a real account yet, and DeSo video upload from phones is not supported. On iOS 27 the app uses the UIScene lifecycle (`plugins/with-ios-scene-lifecycle.js`); builds without it stop at launch. Farcaster posting stays off (“Coming soon”) until the operator creates Open Media's own Farcaster account and sets `FARCASTER_APP_FID`/`FARCASTER_APP_MNEMONIC` on the Worker. Lens uses Lens's public test app unless `EXPO_PUBLIC_LENS_APP_ADDRESS` is set, and each Lens post costs a little GHO unless sponsored. None of the four connectors has published to a live network yet: the Farcaster message encoding is verified byte-for-byte against the official SDK, and the other flows follow each network's current documentation and SDK source. Open Media cannot reply, like, or follow on these networks. The Feed shows only the first image of a post and no video playback, Farcaster engagement counts are not shown, and Farcaster comes from four large channels (/farcaster, /ethereum, /dev, /design) rather than the whole network. These public APIs can change or rate-limit without notice; a network that fails shows a notice while the rest of the Feed keeps working. Filters are fixed defaults for now; the user-configurable filtering in the builder prompt is not implemented. Chat bridges run only on a local development stack today (`npm run bridges`); production needs the owner to set up the bridge server (services/bridges/README.md). Every running network has been checked up to its first real sign-in step (a QR code, a pairing-code prompt, a username and password form, or a list of browser values to copy), not with a real account; text messages are bridged both ways, while photos and files show as placeholders and can't be sent. Sign-in methods: WhatsApp (QR or pairing code), Signal (QR), Google Messages (Google account cookies, then an emoji to confirm on the phone), Google Voice (Google cookies), Instagram and Messenger (cookies or username and password), LinkedIn (cookies and headers), X (cookies or username and password), Bluesky (app password), Slack (email, token and cookie, or a Slack app) and Discord (its sign-in token, copied from the web app's Authorization header; its current release predates the shared login API, so Open Media adapts to it and doesn't offer its QR sign-in). Cookie sign-ins ask you to copy values from a desktop browser's developer tools, because the app has no built-in browser for that yet. Telegram needs Open Media's own API ID and hash from my.telegram.org (owner step; `npm run bridges` starts it once `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are set). iMessage, Snapchat and TikTok have no bridge, and Google Chat's bridge is unmaintained. Cross-posting to closed networks (Instagram, LinkedIn, X, and others), production Matrix authorization, Matrix media/room creation/E2EE, attachments, push notifications, image upload, video transcoding, an operator report-review console, and E2E messaging are not implemented. Their UI is disabled or explicitly marked as reserved. Native messages have reversible user blocking/reporting plus database-enforced membership, sender integrity, timestamp integrity, and per-user flood limits. Data export and account deletion are implemented in Profile and covered by database security tests.

Most consumer social networks do not expose universal private-message access to ordinary third-party apps. Instagram has a narrower professional-account messaging API, LinkedIn messaging access is restricted, Snapchat Login Kit excludes private messages, and approved TikTok Data Portability access is an export workflow rather than live DM sending. Official connectors for them remain disabled until Open Media implements and receives approval for an applicable official capability; the opt-in chat bridges are the owner-approved exception for messaging (ADR 0011).

For social accounts, Open Media reads other providers only through approved APIs and open protocols; for messaging it also offers the opt-in chat bridges above. For events, it reads only public, unauthenticated data: iCalendar feeds, schema.org Event data that platforms publish on public pages, and the public JSON behind Luma's website. It follows robots.txt and never signs in, registers or buys tickets on anyone's behalf. Registration is always a handoff to the official page; see [docs/events](events/README.md) for the verified capability matrix. The reverse is intentional: Open Media’s own public posts and profiles may be freely read and scraped by people and agents, preferably through the public API. See [the migration plan](OPEN_MEDIA_MIGRATION.md) for the next additive steps and security boundaries.


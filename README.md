# Open Media

**Post everywhere. Message everyone. One app.**

Open Media is a cross-platform beta for bringing a person’s social world together without pretending every provider is open. Open Media’s own posts and profiles are public: anyone can read them without an account, and people, scrapers, and AI agents can consume them through a documented read-only JSON API. It evolves incrementally from Convo’s people-first unified messenger while preserving its email-import, contact-cleanup, private-search, auth, and deployment boundaries.

## What works now

- Adaptive Expo/React Native app for iOS, Android, tablets, and web
- Feed, Clips, and Messages as the only primary destinations
- Public Feed for signed-out visitors: anyone can read Open Media posts without an account
- Real text posts: publish from the composer, delete your own posts, and report other people’s posts; posts reported by three different people are hidden for review
- A read-only public JSON API ([docs](services/mail-sync/PUBLIC_API.md)) with an OpenAPI 3.1 document, pagination, CORS, and per-IP rate limiting, so people and agents can read public posts and profiles. It is served by Open Media’s single production Worker alongside mail sync
- Passwordless onboarding with a live, public Open Media profile and handle (your email stays private)
- Real direct conversations, message persistence, RLS isolation, and realtime delivery through Supabase
- A local-only Matrix room/sending sandbox that demonstrates the connector boundary without claiming production isolation
- Profile, universal Search, Create, and searchable Settings as utilities
- System, Light, and Dark appearance, persisted locally
- One canonical `SocialPost` type shared by Feed and Clips
- Raw reverse-chronological feed and a simple Relevant feed with “Why this?” explanations
- Universal local search across loaded posts, conversations, and every indexed setting
- Canonical people with multiple reviewed provider identities and one chronological conversation
- Source-preserving messages and inline email subject context
- Email in Messages: connect any IMAP/POP + SMTP mailbox (presets for Gmail, iCloud, Yahoo, AOL, Fastmail, Zoho, GMX). Your inbox and sent mail appear as people-first conversations next to Open Media chats, sync automatically, and you can reply by email from the thread (threaded with `In-Reply-To`)
- One-command local app: `npm run local` runs the database, auth, mail service, public API, and web app on your computer; sign-in emails can go to your real inbox through your own SMTP server (`npm run local:email`)
- Supabase auth/database backend, encrypted mailbox credentials, RLS on every exposed user table, reversible message blocking/reporting, in-app data export and account deletion, Contacts review flow, and Apple Foundation Models search boundary
- Capability-negotiated connector contracts that keep unavailable publishing, sending, OAuth, realtime, and attachment features disabled
- **Open Media Events (Layer 1)**: an agent-agnostic event discovery and planning service for ChatGPT, Claude and other MCP clients. It searches Luma, Meetup, Eventbrite and your own ICS or schema.org feeds in parallel, de-duplicates and ranks results with reasons, checks your schedule, places calendar holds you approve on a subscribed iCloud calendar, and hands off registration to the official page. It is served over MCP with OAuth 2.1 at `/mcp`, with a REST/OpenAPI mirror. See [docs/events](docs/events/README.md)

Feed shows live public posts. Clips still shows clearly labeled fictional sample videos because media upload is not implemented. Open Media profiles, posts, and native messages are live data.

## Product behavior

`Feed` and `Clips` are two views of the same post model. `Raw` is chronological. `Relevant` currently considers only recency, explicit follows, selected interests, and community membership; it explicitly excludes private messages, exact location, and sensitive-trait inference. Follows and interests are not stored yet, so for live posts Relevant is effectively recency.

**What is public:** every Open Media post, and each profile’s handle, display name, bio, avatar, join date, and post count. **What stays private:** messages, imported email, contacts, blocks, and reports. The composer and Profile say so before anything is published. Deleted posts disappear from the app and API immediately, but copies already read by others cannot be recalled.

`Messages` keeps a person canonical while preserving the source of each message. Open Media-to-Open Media direct messaging is live. Email joins the same list: each mailbox and correspondent becomes a conversation with both directions in order, and replies go out through that mailbox’s SMTP server. Connect mailboxes in **Settings → Connections → Email & contacts**. Imported email is never presented as end-to-end encrypted.

WhatsApp, Facebook Messenger, Instagram, and LinkedIn are listed in Settings but stay off: their official APIs cover only business numbers, Pages, professional accounts, or approved partners, not personal chats. Open Media does not scrape them or use unofficial bridges.

Matrix is an additional transport rather than a replacement for canonical Open Media people. The gateway in `services/matrix-bridge` is currently a local development sandbox: it authenticates one configured account outside the Expo bundle, translates room snapshots into the existing connector model, and sends text events back through the Matrix Client-Server API. It refuses production mode. A public connector still requires per-user authorization and isolation. Provider-specific bridges remain separate services and must not be described as connected until explicitly configured and verified.

## Architecture

```text
App.tsx
  OpenMediaThemeProvider
  OpenMediaApp
    PublicHome (signed out) / FeedView → live public posts (src/data/postService.ts)
    ClipsView              → labeled sample clips (src/domain/posts.ts)
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

## Run locally

Requirements: Node.js 22.13+ (`nvm use`), npm, and Docker Desktop. Xcode or Android Studio only for native simulators.

### Everything on your computer (recommended)

```bash
npm install
npm run local
```

This starts local Supabase (database, auth, and a test inbox), the mail and public API Worker, and the web app, then opens <http://localhost:8081>. It opens Docker Desktop if needed and writes gitignored local config (`.env.development.local`, `services/mail-sync/.dev.vars`, `.local/`). Ctrl+C stops the app and Worker; `npm run local:stop` also stops the database. Your local data persists between runs.

**Signing in.** Enter your email, then type the 6-digit code from the sign-in email (the link also works if you open it in the same browser). By default, sign-in emails land in the local test inbox at <http://127.0.0.1:54324>. To receive them in your real inbox, run:

```bash
npm run local:email
```

It asks for your email address and an app password in your own terminal, checks them against your provider’s SMTP server, and saves them only in `supabase/.env` (gitignored). `npm run local:email -- --off` switches back to the test inbox.

**Email in Messages.** In the app, open **Settings → Connections → Email & contacts → Add an email account**. Known providers fill in their IMAP and SMTP servers; most need an app password rather than your normal password. Mail syncs when the app opens and every five minutes, and you can reply from the conversation. For testing without a real mailbox, the local SMTP server is `localhost:54325`.

### App only

```bash
npm run web
```

Other targets:

```bash
npm run ios
npm run android
npm run ios:native
```

Apple Foundation Models requires the native iOS target, iOS 26+, supported hardware, Apple Intelligence enabled, and an available local model. Ordinary search works without it.

Configure `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for onboarding and native messaging. Add the app callback URL to Supabase Auth redirect URLs before distributing a native build. Production should prefer provider OAuth where supported. The client accepts `EXPO_PUBLIC_OPEN_MEDIA_API_URL`; the former `EXPO_PUBLIC_CONVO_API_URL` remains a temporary compatibility alias.

To run the public API locally against the local Supabase stack, see [services/mail-sync/PUBLIC_API.md](services/mail-sync/PUBLIC_API.md) and start it with `npm run public-api:server`. Set `EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL` to show the open-data link to signed-out visitors.

To test Matrix locally, configure the gateway process from `services/matrix-bridge/.env.example`, run `npm run matrix:server`, and start a development build with `EXPO_PUBLIC_MATRIX_BRIDGE_URL` pointing to that gateway. The app exposes **Try the local Matrix sandbox** only in development. Matrix credentials remain in the gateway process and are never embedded in the Expo client. Never expose the single-account sandbox publicly.

## Validation

```bash
npm run check
npm run test:db # requires the local Supabase stack
npx expo-doctor@latest
```

The check runs app and Worker (mail sync, public API and events) typechecks/tests plus a production web export. `services/mail-sync/scripts/events-e2e.ts` exercises the events service end to end over OAuth and MCP. Generated output stays inside `.expo-dist/` and is ignored.

## Honest limitations

This is a beta, not a finished public social network. Posts are text-only; Clips content is fictional sample media. The public-posts migration and the public API routes are implemented and tested locally; production rollout is tracked in [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md). Replies, likes, reposts, follows, public profile pages in the app, server-rendered HTML pages, RSS/Atom feeds, and ActivityPub federation are not implemented; the JSON API is the supported machine interface. Moderation is basic: community reports auto-hide a post, and removal/restoration is a service-role database operation with no operator console yet. Email is plain text only (no HTML bodies or attachments), reads only Inbox and Sent, and signs in with app passwords; Gmail/Outlook OAuth is not implemented, so Microsoft mailboxes that require OAuth will be refused. Email sending, the mail migration, and sign-in emails through custom SMTP are verified locally; production rollout is tracked in the readiness checklist. Cross-posting, social connector authorization, production Matrix authorization, Matrix media/room creation/E2EE, attachments, push notifications, media upload/transcoding, an operator report-review console, and E2E messaging are not implemented. Their UI is disabled or explicitly marked as reserved. Native messages have reversible user blocking/reporting plus database-enforced membership, sender integrity, timestamp integrity, and per-user flood limits. Data export and account deletion are implemented in Profile and covered by database security tests.

Most consumer social networks do not expose universal private-message access to ordinary third-party apps. Instagram has a narrower professional-account messaging API, LinkedIn messaging access is restricted, Snapchat Login Kit excludes private messages, and approved TikTok Data Portability access is an export workflow rather than live DM sending. Those connectors remain disabled until Open Media implements and receives approval for an applicable official capability. Open protocols and supported email connections are the honest interoperability path.

For messaging and social accounts, Open Media only reads other providers through approved APIs and standard protocols. For events, it reads only public, unauthenticated data: iCalendar feeds, schema.org Event data that platforms publish on public pages, and the public JSON behind Luma's website. It follows robots.txt and never signs in, registers or buys tickets on anyone's behalf. Registration is always a handoff to the official page; see [docs/events](docs/events/README.md) for the verified capability matrix. The reverse is intentional: Open Media’s own public posts and profiles may be freely read and scraped by people and agents, preferably through the public API. See [the migration plan](docs/OPEN_MEDIA_MIGRATION.md) for the next additive steps and security boundaries.

## Compatibility note

The iOS/Android application identifiers, legacy `convo://` callback, EAS project ID, deployed mail worker, and existing database project remain unchanged so installed builds and App Store/TestFlight continuity are preserved. The new `openmedia://` scheme is also registered, and all user-facing branding is Open Media.

## License

MIT. See [LICENSE](LICENSE).

<!-- project-artwork:start -->
## Project artwork

![Conceptual artwork for Open Media](assets/brand/cover.png)

Conceptual project artwork. [Asset files, design notes, and generation prompts](assets/brand/README.md).
<!-- project-artwork:end -->

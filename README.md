# Open Media

**Post everywhere. Message everyone. One app.**

Open Media is a cross-platform private beta for bringing a person’s social world together without pretending every provider is open. It evolves incrementally from Convo’s people-first unified messenger while preserving its email-import, contact-cleanup, private-search, auth, and deployment boundaries.

## What works now

- Adaptive Expo/React Native app for iOS, Android, tablets, and web
- Feed, Clips, and Messages as the only primary destinations
- Passwordless onboarding with a live Open Media profile and private handle
- Real direct conversations, message persistence, RLS isolation, and realtime delivery through Supabase
- A local-only Matrix room/sending sandbox that demonstrates the connector boundary without claiming production isolation
- Profile, universal Search, Create, and searchable Settings as utilities
- System, Light, and Dark appearance, persisted locally
- One canonical `SocialPost` type shared by Feed and Clips
- Raw reverse-chronological feed and a simple Relevant feed with “Why this?” explanations
- Universal local search across fictional posts, conversations, and every indexed setting
- Canonical people with multiple reviewed provider identities and one chronological conversation
- Source-preserving messages and inline email subject context
- Real TLS-only IMAP/POP mailbox connection testing, import, resync, listing, and credential-safe disconnection through the separate mail-sync service
- Supabase auth/database backend, encrypted mailbox credentials, RLS on every exposed user table, reversible message blocking/reporting, in-app data export and account deletion, Contacts review flow, and Apple Foundation Models search boundary
- Capability-negotiated connector contracts that keep unavailable publishing, sending, OAuth, realtime, and attachment features disabled

Feed and Clips still use clearly fictional sample posts. Open Media profiles and native messages are live data.

## Product behavior

`Feed` and `Clips` are two views of the same posts. `Raw` is chronological. `Relevant` currently considers only recency, explicit follows, selected interests, and community membership; it explicitly excludes private messages, exact location, and sensitive-trait inference.

`Messages` keeps a person canonical while preserving the source of each message. Open Media-to-Open Media direct messaging is live. The existing email connection and contact-review tools are available in **Settings → Connections**; imported email is read-only until a separately authorized send capability exists.

Matrix is an additional transport rather than a replacement for canonical Open Media people. The gateway in `services/matrix-bridge` is currently a local development sandbox: it authenticates one configured account outside the Expo bundle, translates room snapshots into the existing connector model, and sends text events back through the Matrix Client-Server API. It refuses production mode. A public connector still requires per-user authorization and isolation. Provider-specific bridges remain separate services and must not be described as connected until explicitly configured and verified.

## Architecture

```text
App.tsx
  OpenMediaThemeProvider
  OpenMediaApp
    FeedView / ClipsView   → src/domain/posts.ts
    OpenMediaMessages     → live Supabase/Matrix conversations + provider-normalized models
    Search / Settings     → indexed local domain search
            │
    connector capability gateway
            │
    Supabase auth/profiles/RLS messaging + Matrix bridge gateway
            │
    existing mail API
            │
services/mail-sync + private Supabase mail schema
```

Important boundaries:

- `src/domain`: normalized people, messages, posts, feed logic, search, and settings index
- `src/connectors`: provider-neutral capabilities, safe mock adapter, and mail-service client
- `src/ui`: adaptive Open Media surfaces plus preserved connection/contact UI
- `services/mail-sync`: mailbox network safety, TLS connection tests, encrypted credentials, and import
- `services/matrix-bridge`: server-side Matrix authentication, room synchronization, and text sending
- `supabase/migrations`: private mail storage plus Open Media profiles, conversations, messages, realtime, and authenticated RPC/RLS policies
- `docs/OPEN_MEDIA_MIGRATION.md`: current/target architecture, database changes, risks, and phased plan
- `docs/MASTER_BUILDER_PROMPT.md`: the public, self-contained starting brief for the project
- `docs/adrs`: short architectural decisions

## Run locally

Requirements: Node.js 22.13+, npm, and Xcode or Android Studio for native simulators.

```bash
npm install
npm run web
```

Other targets:

```bash
npm run ios
npm run android
npm run ios:native
```

Apple Foundation Models requires the native iOS target, iOS 26+, supported hardware, Apple Intelligence enabled, and an available local model. Ordinary search works without it.

Configure `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for onboarding and native messaging. Add the app callback URL to Supabase Auth redirect URLs before distributing a native build. To test IMAP import locally, configure the ignored mail-service environment file, start `npm run mail:server`, and open **Settings → Connections → Email & contacts**. Production should prefer provider OAuth where supported. The client accepts `EXPO_PUBLIC_OPEN_MEDIA_API_URL`; the former `EXPO_PUBLIC_CONVO_API_URL` remains a temporary compatibility alias.

To test Matrix locally, configure the gateway process from `services/matrix-bridge/.env.example`, run `npm run matrix:server`, and start a development build with `EXPO_PUBLIC_MATRIX_BRIDGE_URL` pointing to that gateway. The app exposes **Try the local Matrix sandbox** only in development. Matrix credentials remain in the gateway process and are never embedded in the Expo client. Never expose the single-account sandbox publicly.

## Validation

```bash
npm run check
npm run test:db # requires the local Supabase stack
npx expo-doctor@latest
```

The check runs app and mail-service typechecks/tests plus a production web export. Generated output stays inside `.expo-dist/` and is ignored.

## Honest limitations

This is a production-hardened private beta, not a finished public social network. Feed/Clips content is fictional and in-memory. Cross-posting, Open Media post persistence, social connector authorization, Gmail/Outlook OAuth, SMTP/provider email sending, production Matrix authorization, Matrix media/room creation/E2EE, attachments, push notifications, media upload/transcoding, public-content moderation, an operator report-review console, and E2E messaging are not implemented. Their UI is disabled or explicitly marked as reserved. Native messages have reversible user blocking/reporting plus database-enforced membership, sender integrity, timestamp integrity, and per-user flood limits. Data export and account deletion are implemented in Profile and covered by database security tests.

Most consumer social networks do not expose universal private-message access to ordinary third-party apps. Instagram has a narrower professional-account messaging API, LinkedIn messaging access is restricted, Snapchat Login Kit excludes private messages, and approved TikTok Data Portability access is an export workflow rather than live DM sending. Those connectors remain disabled until Open Media implements and receives approval for an applicable official capability. Open protocols and supported email connections are the honest interoperability path.

Approved APIs and standard protocols are required; scraping is out of scope. See [the migration plan](docs/OPEN_MEDIA_MIGRATION.md) for the next additive steps and security boundaries.

## Compatibility note

The iOS/Android application identifiers, legacy `convo://` callback, EAS project ID, deployed mail worker, and existing database project remain unchanged so installed builds and App Store/TestFlight continuity are preserved. The new `openmedia://` scheme is also registered, and all user-facing branding is Open Media.

## License

MIT. See [LICENSE](LICENSE).

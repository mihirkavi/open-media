# Open Media

**Post everywhere. Message everyone. One app.**

Open Media is an early cross-platform foundation for bringing a person’s social world together without pretending every provider is open. It is evolving incrementally from Convo’s people-first unified messenger: existing conversation, identity, email-import, contact-cleanup, private-search, auth, and deployment work remains in place.

## What works now

- Adaptive Expo/React Native app for iOS, Android, tablets, and web
- Feed, Clips, and Messages as the only primary destinations
- Profile, universal Search, Create, and searchable Settings as utilities
- System, Light, and Dark appearance, persisted locally
- One canonical `SocialPost` type shared by Feed and Clips
- Raw reverse-chronological feed and a simple Relevant feed with “Why this?” explanations
- Universal local search across fictional posts, conversations, and every indexed setting
- Canonical people with multiple reviewed provider identities and one chronological conversation
- Source-preserving messages and inline email subject context
- Real TLS-only IMAP/POP mailbox connection testing and import through the separate mail-sync service
- Supabase auth/database scaffold, encrypted mailbox credentials, RLS defense in depth, Contacts review flow, and Apple Foundation Models search boundary
- Capability-negotiated connector contracts that keep unavailable publishing, sending, OAuth, realtime, and attachment features disabled

All included people, posts, social accounts, and social messages are fictional demonstration data.

## Product behavior

`Feed` and `Clips` are two views of the same posts. `Raw` is chronological. `Relevant` currently considers only recency, explicit follows, selected interests, and community membership; it explicitly excludes private messages, exact location, and sensitive-trait inference.

`Messages` keeps a person or intentional group canonical while preserving the source of each message. The existing email connection and contact-review tools are available in **Settings → Connections**. Live sending remains disabled because no current connector advertises a working send operation.

## Architecture

```text
App.tsx
  OpenMediaThemeProvider
  OpenMediaApp
    FeedView / ClipsView   → src/domain/posts.ts
    OpenMediaMessages     → existing Person, Conversation, Message models
    Search / Settings     → indexed local domain search
            │
    connector capability gateway
            │
    existing mail API + Supabase auth
            │
services/mail-sync + private Supabase mail schema
```

Important boundaries:

- `src/domain`: normalized people, messages, posts, feed logic, search, and settings index
- `src/connectors`: provider-neutral capabilities, safe mock adapter, and mail-service client
- `src/ui`: adaptive Open Media surfaces plus preserved connection/contact UI
- `services/mail-sync`: mailbox network safety, TLS connection tests, encrypted credentials, and import
- `supabase/migrations`: private mail storage and authenticated RPC/RLS policy
- `docs/OPEN_MEDIA_MIGRATION.md`: current/target architecture, database changes, risks, and phased plan
- `docs/MASTER_BUILDER_PROMPT.md`: the public, self-contained starting brief for the project
- `docs/adrs`: short architectural decisions

## Run locally

Requirements: Node.js 22+, npm, and Xcode or Android Studio for native simulators.

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

To test IMAP import locally, configure the ignored mail-service environment file, start `npm run mail:server`, and open **Settings → Connections → Email & contacts**. Production should prefer provider OAuth where supported. The client accepts `EXPO_PUBLIC_OPEN_MEDIA_API_URL`; the former `EXPO_PUBLIC_CONVO_API_URL` remains a temporary compatibility alias.

## Validation

```bash
npm run check
npx expo-doctor
```

The check runs app and mail-service typechecks/tests plus a production web export. Generated output stays inside `.expo-dist/` and is ignored.

## Honest limitations

This is a functional local V1 slice, not a production social network. Feed/Clips content is fictional and in-memory. Cross-posting, Open Media post persistence, social connector authorization, Gmail/Outlook OAuth, SMTP/provider email sending, attachments, realtime sync, notifications, media upload/transcoding, moderation, export/deletion workflows, abuse controls, and E2E messaging are not implemented. Their UI is disabled or explicitly marked as reserved.

Approved APIs and standard protocols are required; scraping is out of scope. See [the migration plan](docs/OPEN_MEDIA_MIGRATION.md) for the next additive steps and security boundaries.

## Compatibility note

The bundle identifiers, `convo://` URL scheme, EAS project, deployed mail worker, and existing database names remain unchanged during the incremental migration so installed builds and existing resources continue to work.

## License

MIT. See [LICENSE](LICENSE).

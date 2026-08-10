# Convo

Convo is a people-first, cross-platform unified messenger foundation. Its goal is to make every conversation with a person feel coherent and immediate, even when individual messages arrive through different addresses or services.

The app now includes the first production-oriented integrations: configurable IMAP/POP email import through a separate secure service, on-device Apple Contacts cleanup, and private semantic search through Apple Foundation Models. The social conversations remain fictional demo data and live sending is still disabled.

## Product idea

Most communication products make providers the top-level structure. Convo makes a person—or an intentional group—the stable layer instead:

```text
Maya Chen
  Work email       maya.chen@example.com
  Personal email   maya.weekends@example.com
  Instagram        @mayawanders
        ↓
  One reviewed person record
        ↓
  One chronological conversation timeline
```

Source remains visible on every message, but it never fragments the relationship. Email subjects appear as compact topic cards within the timeline, so an email thread keeps its context without becoming a separate inbox conversation.

## Implemented MVP

- Canonical `Person` records with multiple reviewed email, handle, or phone identities
- One direct conversation per person, plus distinct participant-set-based group conversations
- Unified chronological timelines containing email, Instagram-like, LinkedIn-like, Snapchat-like, and SMS demo messages
- Tiny local/generic source markers on every message and source summaries in conversation rows
- Compact email topic dividers that retain subjects and keep replies inline with the person timeline
- Responsive three-pane desktop layout and focused mobile list-to-thread flow
- People, group, favorites, unread, and full-text filters; no provider account tabs
- Realistic but entirely fictional mock identities and messages
- Confidence-scored identity-match suggestions that cannot merge until explicitly accepted
- TypeScript validation, domain tests, Expo dependency checks, and static web export validation
- Immediate traditional message search plus a separately labeled Apple Intelligence result section
- Review-before-write Apple Contacts normalization using Expo SDK 56's current Contacts API
- User-configurable iCloud and standards-based IMAP/POP setup with real connection testing and mailbox import
- Supabase Auth/database scaffold with encrypted mailbox credentials kept in a private schema

## Architecture

```text
App.tsx                         responsive app composition and people-filter state
src/
  domain/
    models.ts                   people, identities, messages, groups, email context
    identityResolution.ts       confidence signals and mandatory review gate
    selectors.ts                people-first search and filtering
  connectors/
    types.ts                    provider capability and normalized sync contracts
    mockEmailConnector.ts       safe local adapter; no credentials or network access
    mailApiConnector.ts         authenticated client for the separate mail-sync service
  contacts/                     on-device Contacts scan and reviewed updates
  search/                       Apple Foundation Models adapter and availability fallback
  data/
    mockData.ts                 fictional people, linked identities, and timelines
  ui/
    PeopleRail.tsx              people/group/favorites navigation
    ConversationList.tsx        canonical-person rows, search, filters, source summaries
    ThreadView.tsx              merged timeline, email topics, composer
    SourceMarker.tsx            small generic/local provider indicators
  theme.ts                      shared color and shape tokens
modules/apple-foundation-search native iOS 26+ Expo module; content stays on-device
services/mail-sync/             separate IMAP/POP test, import, auth, and encrypted storage service
supabase/migrations/            private mail-account/message schema with RLS defense-in-depth
```

### Identity resolution rules

Connectors normalize provider records into identities, messages, and candidate associations. They do **not** decide that two identities are the same person.

1. Matching evidence creates a confidence-scored suggestion.
2. Suggestions remain `review-required`, even at high confidence.
3. A person can inspect the evidence and accept or reject the association.
4. Only an explicitly accepted suggestion is eligible to merge into a canonical person.
5. Groups use a stable participant set and remain separate from each participant’s direct conversation.

Name similarity alone is weak evidence. A production design should combine provider-verified addresses, user address-book links, verified phone numbers, prior explicit decisions, and conflict detection. It must also support undo and maintain an audit trail. No blind or silent merging is acceptable.

### Timeline normalization

Each normalized message stores both a canonical `senderPersonId` and the precise `senderIdentityId` and `source` used for that message. This makes the timeline people-first without erasing provenance. Email messages additionally carry `EmailContext`, including their provider thread ID and subject; the UI renders that context when an email topic enters the timeline.

## Run locally

Requirements:

- Node.js 22 or newer
- npm
- Xcode for an iOS simulator, or Android Studio for an Android emulator

```bash
npm install
npm run web
npm run mail:server
```

Other development targets:

```bash
npm run ios
npm run android
```

The regular `npm run ios` path can use Expo Go for UI work. Apple Foundation Models is custom native code, so use `npm run ios:native` for AI search. It requires iOS 26 or later, supported Apple Intelligence hardware, Apple Intelligence enabled, and a downloaded model. When unavailable, exact search still works immediately and the app explains why the AI section is unavailable.

## Try iCloud Mail locally

1. Copy `services/mail-sync/.env.example` to the ignored `services/mail-sync/.env`, or export the values in your shell. For local in-memory testing, set `NODE_ENV=development` and `CONVO_ALLOW_INSECURE_LOCAL_AUTH=true`.
2. Start the mail service with `npm run mail:server`.
3. Start/reload Convo, open **Settings → iCloud Mail**, and enter the iCloud address plus an Apple app-specific password. The preset uses `imap.mail.me.com`, TLS, and port `993`.
4. Tap **Test & connect**. Convo verifies the login, imports up to the latest 100 Inbox messages, normalizes them into people-first conversations, and never writes the password to device storage.

POP over TLS (`995`) is supported for providers that require it, but is intentionally labeled **import** because POP does not provide folder/read-state synchronization. Unencrypted IMAP/POP is rejected.

For the iOS simulator, the development app defaults to `http://127.0.0.1:8787`. Override it with `EXPO_PUBLIC_CONVO_API_URL`. Android emulators generally need a host-reachable address rather than `127.0.0.1`.

## Public deployment boundary

The dedicated Supabase project is provisioned in the Convo organization at `https://sgqrkbsmroytevkgogoy.supabase.co`, and the mail-sync migrations have been applied and verified. The production mail service is deployed as a Cloudflare Worker at `https://convo-mail-sync.convo-mail-sync.workers.dev`; its health endpoint returns 200 and mailbox routes require a valid Supabase session. Configure:

```text
App: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPO_PUBLIC_CONVO_API_URL
Node service: SUPABASE_URL, DATABASE_URL, MAIL_CREDENTIALS_KEY, CONVO_APP_ORIGIN, NODE_ENV=production
Cloudflare Worker: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, MAIL_CREDENTIALS_KEY
```

`MAIL_CREDENTIALS_KEY` must be a server-only base64 32-byte key (`openssl rand -base64 32`). The service authenticates Supabase JWTs, blocks private/reserved mailbox targets, requires TLS, encrypts passwords with AES-256-GCM, avoids credential logging, and stores mail tables in an unexposed `private` schema. The Worker uses authenticated RPCs plus RLS and does not receive a database password or service-role key. Never put the database URL or credential-encryption key in an `EXPO_PUBLIC_` variable.

`convo://auth` is configured in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs** for native magic-link sign-in.

Run the local validation suite:

```bash
npm run check
npx expo-doctor
```

The web export is written to `.expo-dist/`, which is ignored and remains inside the repository.

## Connector and platform reality

Convo now has a working standards-based email path. The Instagram, LinkedIn, Snapchat, SMS, and Gmail OAuth indicators remain local generic visuals, not official brand assets and not evidence of those providers' private-message APIs.

| Source | Practical integration path | Important constraints |
| --- | --- | --- |
| Gmail | Gmail API with OAuth and narrowly scoped access | Google verification, secure token storage, quotas, push-notification infrastructure, and user consent are required. |
| iCloud Mail / generic IMAP | Implemented connection test and Inbox import/sync through the separate service | iCloud requires an app-specific password. Sending, attachments, background scheduling, and IMAP IDLE are not implemented yet. |
| Generic POP | Implemented TLS-only import fallback | POP has no folder/read-state sync and should not be presented as equivalent to IMAP. |
| LinkedIn | Approved LinkedIn APIs only | LinkedIn does not provide broad public personal-inbox access for a general unified messenger. Do not depend on scraping or claim full support. |
| Meta services | Product-specific, approved Meta APIs | Consumer Instagram and Messenger access differs from business messaging APIs. App review, policy compliance, and account eligibility may be required; broad personal inbox access is not guaranteed. |
| Snapchat | Approved Snap integrations only | A general personal-message inbox API should not be assumed. The current marker is purely demonstrative. |
| iMessage / SMS | Platform-specific Apple and Android capabilities | Apple does not expose a general iMessage inbox API to third-party apps. SMS access is constrained by OS permissions and store policies. |

Native iOS and Android builds are supported by the Expo foundation, and responsive web covers desktop browsers. A dedicated macOS binary is not implemented; the current desktop experience is the web application.

## Security and privacy principles

- Keep secrets and personal message exports out of the client bundle and Git history.
- Prefer provider OAuth over raw passwords when supported.
- Store refresh tokens only in an appropriately secured backend or OS keychain design.
- Minimize requested scopes and retain only data necessary for the product.
- Preserve per-message source, chosen identity, send state, and failure state.
- Require review before joining identities and support unmerge/undo.
- Require explicit user approval before connecting personal accounts or sending live messages.

## Status and limitations

This repository is an early product and integration foundation, not yet a store-ready messaging client. Email login testing/import, credential encryption, Supabase Auth hooks, Contacts cleanup, private AI search, and the hosted Supabase schema are implemented. The separate mail service is not hosted yet, so durable production sync is not live. Background scheduling, notifications, attachments, SMTP sending, deletion/retention controls, account removal, privacy disclosures, abuse controls, and production observability remain release blockers. Composer interactions still transmit nothing.

## License

MIT. See [LICENSE](LICENSE).

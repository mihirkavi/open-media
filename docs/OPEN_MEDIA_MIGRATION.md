# Convo → Open Media migration

This document records the repository through the 2026-08-18 private-beta hardening pass and the incremental path to Open Media. Planned capabilities are not presented as live.

## Current Architecture

| Area | Current implementation | Boundary or limitation |
| --- | --- | --- |
| Frontend | Expo SDK 57, React Native 0.86, React 19, TypeScript; shared iOS/Android/web app | No router; `App.tsx` owns in-memory navigation and data composition |
| Domain | Canonical people, reviewed identities, conversations, messages, email context; now canonical social posts and feed selectors | Post state remains fictional/local; identity merge persistence and undo are not implemented |
| Auth | Supabase PKCE magic-link onboarding; chunked OS SecureStore session storage; strict callback validation; JWT forwarded to the mail service | CAPTCHA is not configured; local development bypass exists only behind an explicit development flag |
| Backend | Supabase native messaging plus `services/mail-sync`, deployed as a rate-limited Cloudflare Worker with TLS-only IMAP/POP import | No post service, background job scheduler, SMTP, or provider OAuth |
| Database | Supabase profiles, conversations, membership, native messages, blocks/reports, private-schema mail data, encrypted credentials, account export/deletion, RLS and authenticated RPCs | No public post, graph, connector-grant, delivery-receipt, moderator-action, or audit tables |
| APIs/connectors | Normalized mail client, mock mail connector, capability-negotiated connector catalog | IMAP import is the only live external content path; social/Gmail/Outlook operations are unavailable until authorized implementations exist |
| Realtime/messaging | Canonical people-first Supabase conversations with persistence, realtime inserts, reversible blocks/reports, sender integrity and flood limits | No receipts, offline retry queue, push notifications, operator report-review console, or E2E implementation |
| Media | Canonical post media metadata and accessible placeholder presentation | No upload, transcoding, object storage, moderation, thumbnailing, streaming, or malware scanning |
| Deployment | Expo/EAS production environment; signed iOS Store builds; static web export; deployed Supabase migrations; deployed Cloudflare mail worker | Existing app identifiers and EAS project remain for update continuity |
| Tests | App/mail typechecks and unit tests, Worker tests, web export, Expo Doctor, 36 database security tests, local browser onboarding/messaging/export checks, signed native cloud build | No automated native UI or visual-regression suite yet |

Expo Doctor passes all package/configuration checks. On the current development Mac it additionally reports that CocoaPods 1.15.2+ is not installed; signed EAS native builds are the native compile gate until that local tool is installed.

`npm audit --omit=dev` reports 11 high-severity advisories in the Expo/Metro build-tool chain through `image-size`; the published advisory currently has no patched release. The mail service audit is clean. Do not use `npm audit fix --force`, because its proposed downgrade breaks the supported Expo SDK 57 dependency set.

## Target Architecture

```text
Expo clients (one adaptive product shell)
  ├─ Feed presentation ─┐
  ├─ Clips presentation ├─ canonical SocialPost + engagement + provenance
  └─ Messages ──────────┴─ canonical Person/Persona + Conversation + Message
             │
     capability gateway
       ├─ Open Media services
       ├─ email adapters (Gmail, Graph, IMAP/SMTP where appropriate)
       ├─ open protocol adapters (ActivityPub, AT Protocol, others)
       └─ approved provider APIs
             │
   auth/token vault · jobs/webhooks · normalized database · media pipeline
```

Clients depend on normalized contracts, never provider response shapes. A connector publishes a descriptor and per-operation capabilities. The application enables an action only when the selected connector reports that operation as available.

Open Media messages and email retain distinct security semantics. Future native messaging encryption belongs below the normalized message boundary; imported email is not relabeled as end-to-end encrypted. For future group E2E work, evaluate a maintained MLS implementation rather than inventing cryptography; MLS specifies asynchronous group key establishment with forward secrecy and post-compromise security, while still recommending secure transport ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)).

## Reusable Components

- Expo/React Native cross-platform setup, EAS project, web export, and strict TypeScript checks.
- Canonical people, reviewed identities, source-preserving messages, inline email subjects, identity suggestion review gate, and selectors.
- Supabase auth hooks, private mail schema, authenticated worker RPCs, encrypted credential storage, network-target validation, and mail normalization.
- Device Contacts review-before-write flow and Apple Foundation Models availability/fallback boundary.
- Existing message fixtures and tests, now consumed by the Open Media Messages surface.
- `SocialPost`, feed ranking/explanations, universal search, settings index, theme provider, and capability catalog added in this slice.

## Required Database Changes

Apply these in additive migrations, not by rewriting the mail schema:

1. `humans` (private root), `personas`, `accounts`, and reviewed `identity_links`; never make private persona links public by default.
2. `posts`, `post_media`, `post_revisions`, `post_engagement`, and `external_post_mappings` with immutable origin/provenance fields.
3. `follows`, selected interests, community membership, and a versioned `feed_events`/explanation record limited to permitted ranking signals.
4. `conversations`, `conversation_members`, `messages`, `message_deliveries`, `attachments`, and provider thread mappings.
5. `connector_grants`, granted scopes, discovered capabilities, encrypted token references, sync cursors, webhook subscriptions, and revocation state.
6. `publish_jobs` and per-destination attempts with idempotency keys, explicit partial-success state, retry policy, and an audit trail.
7. Retention/export/deletion jobs and security audit events. Raw secrets remain outside exposed schemas; media objects require per-user authorization.

All user-owned tables require RLS, ownership indexes, explicit grants, bounded retention, and tests proving cross-user isolation. Database rows should reference secrets held in a dedicated encrypted vault rather than storing provider refresh tokens inline.

## Security Risks

- Mailbox and social scopes expose high-value private data. Use authorization-code + PKCE, incremental consent, exact granted-scope checks, encrypted refresh tokens, revocation, and reauthentication. Google explicitly recommends secure token storage and incremental authorization ([OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)); Gmail scopes can trigger verification and a security assessment when restricted data is stored server-side ([Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)). Microsoft recommends PKCE for all app types and requires it for SPAs ([Microsoft identity platform](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)).
- Cross-posting can cause irreversible disclosure. Require an idempotency key, show the effective destinations, preserve per-destination outcomes, and confirm consequential changes to defaults.
- Connector content and federation payloads are untrusted. Validate schemas, URLs, MIME types, sizes, redirects, webhook signatures, and rate limits; block SSRF and credential leakage.
- Identity linking can expose relationships or collapse personas. Keep links reviewable, reversible, private by default, and auditable.
- Recommendation systems can become surveillance systems. Enforce a deny-by-default signal gateway; this V1 uses only follow, interest, community, and recency fields and exposes “Why this?”.
- E2E claims are dangerous without key verification, device lifecycle, backup, multi-device recovery, abuse reporting, and metadata analysis. Do not call imported email or current demo messages E2E encrypted.
- Media processing is an attack surface. Add quarantined uploads, content-type verification, size/duration limits, scanning, isolated transcodes, signed URLs, and lifecycle cleanup before accepting files.

## Migration Strategy

1. Keep application identifiers, Supabase project, and mail worker stable so existing installs and data continue to work; change the displayed product name first.
2. Add provider-neutral models and interfaces beside the Convo message model. Move screens to them one coherent surface at a time.
3. Ship local/read-only slices before network writes. A UI action stays disabled until a real adapter passes contract and security tests.
4. Add database tables and backfills additively. Dual-read or adapt old mail rows into canonical messages before moving writes.
5. Build one production connector vertically, including OAuth, sync, revocation, error recovery, and auditability, before multiplying providers.
6. Add job orchestration, observability, abuse controls, privacy/export tools, and staged rollout gates before enabling cross-post or message sending.

## Phase 1 Implementation Plan

- [x] Rebrand the displayed app and package to Open Media while retaining bundle IDs, scheme, EAS project, and backend names for upgrade continuity.
- [x] Add an adaptive black/white shell with Feed, Clips, and Messages as the only primary destinations; keep Search, Profile, Settings, and Create as utilities.
- [x] Add persisted System/Light/Dark appearance.
- [x] Add one canonical post model reused by Feed and Clips.
- [x] Add Raw chronological and transparent Relevant feed modes with per-post explanations and an explicit forbidden-signal list.
- [x] Add settings indexing, natural-language settings lookup, and universal local search across settings, conversations, and posts.
- [x] Add capability-negotiated connector contracts and an honest catalog for Open Media, IMAP, Gmail, Outlook, ActivityPub, and AT Protocol.
- [x] Retain the working people-first conversation model, email import normalization, Supabase auth, mail connection UI, and Contacts flow.
- [x] Add unit coverage for post reuse/ranking transparency, connector capabilities, and search.
- [x] Add production profiles, direct conversations, native messages, realtime delivery, reversible blocks/reports, RLS, account export/deletion, and message flood controls through additive database migrations.
- [x] Harden onboarding callbacks/session storage and deploy a rate-limited, observable mail Worker with credential-safe account management.
- [ ] Next: create a persistent Open Media post service and a content moderation/reporting workflow before public Feed/Clips publishing.
- [ ] Next: implement provider OAuth authorization-code + PKCE and token lifecycle, starting with one email provider.
- [ ] Next: implement media upload/transcode/storage and connector contract tests before enabling Publish.

## Research-backed UI constraints

- The app uses React Native `useColorScheme` through a persisted System/Light/Dark preference, consistent with [Expo color-theme guidance](https://docs.expo.dev/develop/user-interface/color-themes/).
- Controls use predictable navigation, labels, selected state, and at least 44-point primary targets. Text palettes target WCAG AA contrast; WCAG 2.2 requires 4.5:1 for normal text and adds minimum target-size guidance ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)).
- ActivityPub is treated as a client/server and federation adapter, not a generic social scraper ([W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/)). AT Protocol support will preserve its schema and repository semantics rather than flattening writes into an unofficial endpoint ([AT Protocol Lexicon](https://atproto.com/specs/lexicon)).

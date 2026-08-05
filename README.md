# Convo

Convo is a people-first, cross-platform unified messenger foundation. Its goal is to make every conversation with a person feel coherent and immediate, even when individual messages arrive through different addresses or services.

The initial MVP is a fictional, local demo. It runs from one Expo/React Native codebase on iPhone, iPad, Android, and the web, including Mac-class browsers. There are no credentials, personal message imports, background sync jobs, or live sends.

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
  data/
    mockData.ts                 fictional people, linked identities, and timelines
  ui/
    PeopleRail.tsx              people/group/favorites navigation
    ConversationList.tsx        canonical-person rows, search, filters, source summaries
    ThreadView.tsx              merged timeline, email topics, composer
    SourceMarker.tsx            small generic/local provider indicators
  theme.ts                      shared color and shape tokens
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

- Node.js 20.19 or newer
- npm
- Xcode for an iOS simulator, or Android Studio for an Android emulator

```bash
npm install
npm run web
```

Other development targets:

```bash
npm run ios
npm run android
```

Run the local validation suite:

```bash
npm run check
npx expo-doctor
```

The web export is written to `.expo-dist/`, which is ignored and remains inside the repository.

## Connector and platform reality

Convo does **not** currently connect to any messaging provider. The Instagram, LinkedIn, Snapchat, SMS, Gmail, iCloud, and generic email indicators in the demo are local generic visuals, not official brand assets and not evidence of provider integration.

| Source | Practical integration path | Important constraints |
| --- | --- | --- |
| Gmail | Gmail API with OAuth and narrowly scoped access | Google verification, secure token storage, quotas, push-notification infrastructure, and user consent are required. |
| iCloud Mail / generic IMAP | User-authorized IMAP for reading and SMTP for sending | Apple may require an app-specific password; IMAP is not a complete realtime messaging API and server behavior differs. Credentials must never ship in the client or repository. |
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

This repository is an early product and interface MVP, not a production messaging client. The people-first domain, UI, and mock connector boundary are runnable; authentication, durable storage, identity-review UI, sync orchestration, notifications, attachments, encryption strategy, and production connectors remain unimplemented. Composer interactions clear local demo text but transmit nothing.

## License

MIT. See [LICENSE](LICENSE).

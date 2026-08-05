# Convo

Convo is a product foundation for a calm, cross-platform unified messenger. Its goal is to make conversations from different services feel as coherent and immediate as iMessage, without hiding where a message came from or overstating what third-party platforms allow.

The initial MVP is email-first. It runs from one Expo/React Native codebase on iPhone, iPad, Android, and the web, including Mac-class browsers. Today it uses realistic local mock conversations only: there are no credentials, mailbox connections, background sync jobs, or live sends.

## Why it matters

Communication is organized around providers even though people think in conversations. Convo explores the opposite model: a single conversational surface where source is useful context, not the primary navigation. The interface aims to keep the familiarity and clarity of a native messenger while making account boundaries and delivery behavior explicit.

## Implemented MVP

- Responsive three-pane desktop layout with a focused mobile thread flow
- Unified source navigation for mock iCloud Mail and Gmail accounts
- Search across subjects, previews, participant names, and addresses
- Account filters, unread-only filtering, unread counts, stars, and subtle source badges
- Conversation list, thread header, message bubbles, timestamps, and responsive composer
- Realistic but fictional email conversations stored locally in source control
- A connector contract that separates provider capabilities from the message domain
- A development-only mock email connector that cannot send or access a network
- TypeScript validation, domain selector tests, and static web export validation

## Product architecture

```text
App.tsx                    responsive app composition and view state
src/
  domain/
    models.ts              provider-neutral accounts, conversations, messages, drafts
    selectors.ts           deterministic inbox search/filter behavior
  connectors/
    types.ts               connector capability and sync contracts
    mockEmailConnector.ts  safe local adapter; no credentials or network access
  data/
    mockData.ts            fictional demo accounts and threads
  ui/
    SourceRail.tsx         accounts and source navigation
    ConversationList.tsx   search, filters, unread states, conversation rows
    ThreadView.tsx         header, transcript, and demo-only composer
  theme.ts                 shared color and shape tokens
```

The domain model does not expose Gmail, IMAP, or social-network payloads directly. A future connector should authenticate outside the UI, normalize provider records into the domain model, declare its exact capabilities, and persist sync cursors through a secure storage layer. Sending should remain disabled until a connector, confirmation flow, and delivery-state handling are implemented and tested.

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

Run the complete local validation suite:

```bash
npm run check
```

The web export is written to `.expo-dist/`, which is intentionally ignored and remains inside the repository.

## Connector and platform reality

Convo does **not** currently connect to any messaging provider.

| Source | Practical integration path | Important constraints |
| --- | --- | --- |
| Gmail | Gmail API with OAuth and narrowly scoped access | Google verification, secure token storage, quotas, push-notification infrastructure, and user consent are required. |
| iCloud Mail / generic IMAP | User-authorized IMAP for reading and SMTP for sending | Apple may require an app-specific password; IMAP is not a complete realtime messaging API and server behavior differs. Credentials must never ship in the client or repository. |
| LinkedIn | Approved LinkedIn APIs only | LinkedIn does not provide broad public inbox access for a general unified messenger. Do not depend on scraping or claim full support. |
| Meta services | Product-specific, approved Meta APIs | Consumer Instagram, Messenger, and WhatsApp access differs. Business APIs, app review, policy compliance, and account eligibility may be required; broad personal inbox access is not guaranteed. |
| iMessage / SMS | Platform-specific Apple and Android capabilities | Apple does not expose a general iMessage inbox API to third-party apps. SMS access is also constrained by OS permissions and store policies. |

Native iOS and Android builds are supported by the chosen Expo foundation, and responsive web covers desktop browsers. A dedicated macOS binary is not implemented; the current desktop experience is the web application. Any future native desktop target would need separate validation and packaging.

## Security and privacy principles

- Keep secrets out of the mobile/web bundle and Git history.
- Prefer provider OAuth over raw passwords when supported.
- Store refresh tokens only in an appropriately secured backend or OS keychain design.
- Minimize requested scopes and retain only data necessary for the product.
- Make source, send state, and failure state visible to the user.
- Require explicit user approval before connecting personal accounts or sending live messages.

## Status and limitations

This repository is an early product and interface MVP, not a production messaging client. The UI and architecture are runnable; authentication, durable storage, sync orchestration, notifications, attachment handling, encryption strategy, and production connectors remain unimplemented. Composer interactions clear local demo text but do not transmit anything.

## License

MIT. See [LICENSE](LICENSE).

# ADR 0037: One contact resolver, and contacts that find their Open Media accounts

- Status: **accepted; built and verified locally** (2026-11-10) on the web (375 px and desktop) and the iOS Simulator. Not deployed: the migration and Worker need `npx supabase db push --linked` and `npm run deploy`. Android not run (the Mac's JDK is too old).
- Builds on: [ADR 0013](0013-identity-contacts-commerce-payments.md) (encrypted contact cards, reversible links), [ADR 0023](0023-editable-contacts-and-one-conversation-per-person.md) (how identities match a card), [ADR 0036](0036-contacts-page-and-apple-style-contact-design.md) (Contacts page).

## Context

The owner reported: "I click on the contact and it does not show me even if I know I have it saved." Two causes:

1. **Every screen decided "which contact is this?" its own way.** Messages matched a conversation with `contactForConversation` (which also tries the sender's other mailboxes), the thread heading re-derived a single identity and called `cardFor`, the profile called `cardFor` and `linkedIdentities` again, and Feed names called `cardFor` through `useSavedName`. Conversations already carried the matched `contactId`, but the heading ignored it. Any difference between those paths showed a saved person as a stranger.
2. **A contact saved by email or phone never reached the person's Open Media account.** Open Media profiles do not show emails or numbers, and nothing asked whether a saved address belongs to an account, so the person's chats, posts and profile never showed the saved contact unless the viewer linked it by hand.

## Decision

### One resolver

`resolveContact(cards, query)` in `src/domain/people.ts` is the only way to answer "which of my contacts is this?". A `ContactQuery` is an identity, the contact already matched (`cardId`) when the caller knows it, and other identities of the same sender (`alsoKnownAs`). Order: a known `cardId` that still exists; the viewer's own card; `cardFor` (link, then the only card holding it); the only card holding any of `alsoKnownAs`.

- `savedName(cards, query)` gives the saved name (never for the viewer's own identities); `identitiesOf(card, ref)` lists a resolved card's identities.
- `contactQueryFor(conversation)` (`src/domain/contactMerge.ts`) is how a conversation asks: its identity (a merged conversation asks through its newest channel), its `contactId`, and every address an email sender wrote from. `contactForConversation` is that query through the resolver, so Messages and every screen that opens a conversation agree by construction.
- `PersonTarget` extends `ContactQuery`; the thread heading passes the conversation's `contactId`, and `PersonProfile` resolves its target with `resolveContact`.
- **Guard rail:** `src/domain/contactResolution.test.ts` fails if any file in `src/ui` calls the building blocks (`cardFor`, `holdsRef`, `holdsHandle`, `contactForConversation`, `linkedIdentities`) directly, and checks that every conversation shown under a contact opens that same contact, with and without its id.

### Contact discovery

Like WhatsApp and Signal, the server says which emails and numbers on the viewer's contacts belong to Open Media accounts, and the app links them.

- **Database** (`supabase/migrations/20261123120000_contact_discovery.sql`): `profiles.discoverable` (default **on**, the owner's choice on 2026-11-10) and `open_media_discover_contacts(emails, phones)`, callable only when signed in, at most 500 values a call. It matches only confirmed sign-in emails (case-insensitive) and confirmed numbers given with a country code, skips accounts that turned discovery off, anyone who blocked the viewer or whom the viewer blocked, and the viewer. It returns only the handle for values the caller sent.
- **Worker:** `POST /v1/me/contacts/discover`, rate-limited per person (`discover:<user>`); `PUT /v1/me/identity` takes `discoverable`.
- **App:** `discoveryRequest(cards)` sends the emails and international numbers of contacts not yet connected to an account (never the viewer's own card); `linkDiscoveredAccounts` adds an automatic link ("Their Open Media account uses this email") only when exactly one contact holds the value, no contact already has that account, and the viewer never said "not this person". The link shows on the card and can be unlinked like any other. It runs when contacts load and whenever their unconnected emails or numbers change.
- **Setting:** Profile → Privacy and identity → "Who can find you by your email or number": People who have it / No one.

## Consequences

- A person shown under a contact's name opens that contact from Messages, Feed, Search, Contacts and group chips, because they all ask the same function.
- Someone who has your confirmed email or number can learn your Open Media handle unless you turn discovery off. Bulk guessing is limited by the 500-value cap, the per-person rate limit, and needing an account.
- Future contact matching changes go in `resolveContact` or its building blocks only; the guard test keeps screens from growing their own rules again.

# ADR 0023: Editable contacts, contact names everywhere, one conversation per person, and contact import

- Status: **accepted; built and verified on the web locally** (2026-11-02). Not committed or deployed. No database migration (contact cards are already encrypted JSON, ADR 0013). iOS and Android are not tested yet.
- No third-party messaging service is involved: merging runs in the app on data Open Media already holds (its own messages, synced email, and chats from its own self-hosted bridges).
- Builds on: [ADR 0011](0011-bridged-messaging-networks.md) (bridged chats through Open Media's own bridges), [ADR 0013](0013-identity-contacts-commerce-payments.md) §2.4 (encrypted contact cards, reversible links)
- Owner rules: no new buttons or screens (contact editing lives in the person's existing profile view); never commit real personal data.

## Context

The owner asked for four things: edit contacts; show a person's contact name wherever there is one (and a platform's full name when there is no contact); show emails under the contact's name when the address is saved; and put every chat and email from a person, on any platform, into one conversation, whichever network or inbox it arrived on. They then asked for contact import from Apple, Google and other exports and, where possible, straight from the device.

ADR 0013 already had encrypted contact cards with emails, phones, notes and reversible links, but cards could not be edited, held no handles on other networks, and Messages listed each chat and email thread separately.

## Decision

### Contact cards

- Cards gain an optional `handles: { network, handle }[]`, where `network` is `open_media`, an open network (`farcaster`, `lens`, `hive`, `deso`) or a bridged chat network (`whatsapp`, `telegram`, `signal`, `gmessages`, `gvoice`, `instagram`, `messenger`, `linkedin`, `twitter`, `bluesky`, `slack`, `discord`). Old cards without it stay valid. The Worker stores cards as opaque encrypted JSON, so nothing changes on the server.
- **Editing** happens in the "Only you see this" box of the person's profile (`src/ui/ContactEditor.tsx`): name, any number of emails, phones and handles (one row each, added from quiet chips), notes, and delete with a second tap to confirm. Saving trims, lower-cases emails, removes duplicate rows (phones compare on their last ten digits) and keeps the card's links and "not this person" choices.
- From someone without a card, **Add to my contacts** creates one that holds their identity (as an email, phone or handle) and opens the editor; **Add to a contact I have** links the identity to an existing card.

### How identities match a card

An identity is an email address, a phone number, an Open Media handle, an open-network handle or a bridged chat id. A card **holds** an identity when:

1. the identity is in the card's `links` (the viewer confirmed it, or it was auto-linked by an exact email or phone, ADR 0013), or
2. the card lists the same email (case-insensitive), the same phone (equal, or the same last ten digits when one has no country code), or the same handle on the same network (no leading `@`, case-insensitive), or
3. for networks whose chat ids are phone numbers (WhatsApp, Signal, Google Messages, Google Voice), a phone number on the card equals the chat id.

`rejected` always wins: an identity the viewer unlinked or said "No" to is never matched to that card again by rules 2 and 3.

**Conflicts.** A link (rule 1) beats rules 2 and 3. If no card links the identity and more than one card holds it, **no card is chosen**: the conversation stays on its own, under the platform's name, and the editor warns "Dev also has 555 000 1234. Messages from it stay in their own conversation until only one contact has it." Names never match on their own; a same-full-name match is only a suggestion, as before.

### Names

- **A saved contact's name comes first, everywhere it can be found**: the Messages list and thread heading, the person's profile (with their public name and handle on the line below), and Feed author names. This overrides ADR 0013 §2.4, which kept the saved name as a private alias only; the owner chose this on 2026-11-02. It is still private: the saved name is shown only to the viewer who saved it and is never sent anywhere else.
- Without a contact, the fullest name the platform gives is used: a bridged one-to-one chat uses the room's name when the member has none or only has a number or id (`fullerName`); email already uses the "From" display name; Open Media and the open networks use the profile's display name.
- Search results (`src/ui/SearchView.tsx`) are not changed here; they receive the merged conversations, so message results carry contact names, but person results keep public names. (That file belonged to another session's work at the time.)

### Fixes after the first release (2026-11-02)

The owner saw saved addresses still showing as raw addresses in Messages. Four causes, all fixed:

- **Address-only threads.** "Add to my contacts" on a thread whose sender gave no name saved the address itself as the contact's name. A new contact now starts with an empty name and the editor asks for one. A contact whose "name" is only an address or number counts as unnamed everywhere (`contactName`), and its profile says "Add their name".
- **Aliases.** Email matching ignores case, a `+tag` after the name, and dots in Gmail names (`sameEmail`).
- **Groups.** Group emails and group chats stay their own conversation, but each saved person in them shows under the contact's name in the title (email groups only; a bridged room keeps its own name), the sender lines and the preview.
- **Threads with several addresses** (a company writing from two mailboxes) match a contact saved with any one of them, as long as they all point at the same contact.

The new message **To** field now offers every email on your contacts under the contact's name, then the people you have emailed (renamed when saved), each address once. Open Media people in its results also show under the saved name, and names match without accents.

### Your own card (2026-11-03)

Like "My Card" in Apple Contacts, a person can keep a contact card for themselves: an ordinary encrypted card with `self: true` (at most one). No database change.

- **Where:** on your own profile, the "Only you see this" box offers **Add my other addresses**, then shows them with Edit; the editor is the same one, with the name taken from your profile ("Sam Rivera (Me)") instead of a name field. In Profile → Your contacts, **Name (Me)** is pinned first, opens your profile, and is not counted as a contact.
- **What it does:** mail from any address on your card counts as sent by you (`normalizeStoredEmail`'s `alsoMine`), so your other address never appears as a separate person. Your identities (on your card as an email, number, handle or link) are never matched to another contact, merged into anyone's conversation, auto-linked or suggested (`isMine`; `cardFor` and `reconcile` skip them). A one-to-one chat with one of your own accounts shows as "Name (Me)". The To field lists your own addresses last, as "Name (Me)".
- **Conflicts:** your own card wins: an identifier on your card and on someone else's is treated as yours.
- **Privacy:** the card is private like every contact card; nothing on it is shown to others unless it is already a public profile field.

### One conversation per person

`mergeByContact` (`src/domain/contactMerge.ts`) runs after every source loads:

- Only one-to-one conversations take part. Group chats and group emails (more than one other person) never merge.
- A contact with one conversation keeps it, renamed to the contact. A contact with several gets one conversation `contact:<card id>` whose messages are all of theirs in time order; the originals are kept as its `channels`, untouched.
- Each run of messages shows a quiet source marker (WhatsApp, Email, Open Media…). Runs break when the source changes. The list row shows the latest message's source icon before the preview; the heading says "WhatsApp, Email and Open Media".
- **Replies** go through one channel. The default is the channel the person last wrote from, among channels that can take a reply (an email channel needs outgoing mail set up); else the most recent channel that can reply. A quiet "by email to priya@… ⌄" line above the composer opens the channels as chips. Replying to a specific message switches to that message's channel, and a quoted reply threads only within its own channel. Blocking and reporting act on the Open Media account of the selected channel.
- Unread counts add up; opening a profile's "Message" opens the merged conversation that holds that chat.

### Import

Inside **Profile → Your contacts** (`src/ui/ContactImport.tsx`), no new screen:

| Source | Where it works | How |
| --- | --- | --- |
| The phone's contacts | iOS and Android apps | `expo-contacts`, with the system permission prompt (existing `readDeviceContacts`) |
| Contact Picker API | Chrome on Android (web); Safari on iOS only behind an experimental setting | `navigator.contacts.select(['name','email','tel'])`: the browser shows the device's own list and returns only the people picked |
| A file | Everywhere | vCard 2.1/3.0/4.0 (`.vcf`, from Apple Contacts, iCloud, Google Contacts, Outlook, Android) and CSV (Google, Outlook, or any sheet with name, email or phone columns) |
| Drag and drop | Desktop web | Drop a `.vcf` or `.csv` on the box. On a Mac, the Contacts app drags selected people out as a vCard, so ⌘A and drag imports everyone |

Desktop browsers, including Safari and Chrome on a Mac, have **no API that reads the system address book**; the Contact Picker API is mobile-only. That is why the Mac path is a file or a drag from Contacts.

The parser (`src/domain/contactImport.ts`) reads names (FN, or N, or the organisation), nicknames, emails, phones, notes and social handles (`IMPP`, `X-SOCIALPROFILE`, and CSV columns named after a network). Google's " ::: " multi-value cells are split. Everything is read on the device; nothing leaves it until the person confirms.

**Review, then save.** The box shows how many contacts are new, how many add details to a contact already saved, and how many are already saved, with Import and Cancel. Merging: an imported contact that shares an email or phone with exactly one saved card adds its new emails, phones, handles, nicknames and notes to that card and keeps the saved name; matching none (or several) makes a new card. Duplicates inside the file are merged first, and importing the same file twice changes nothing. Imported cards are `source: 'manual'`, so a later device import never deletes them.

## Consequences

- Merging is per viewer and private: it never tells anyone that two accounts are one person, and every merge is undone by unlinking or editing the card.
- A wrong identifier on a card pulls the wrong chats in; the fix is visible (the source marker on each run) and immediate (edit or unlink).
- Telegram's bridge identifies people by numeric id, not username, so a Telegram username typed into a card does not match a bridged Telegram chat; adding the contact from the chat itself (which links its id) does.
- Tests: `src/domain/contactMerge.test.ts` (matching, conflicts, links, groups, reply channel, names, editing) and `src/domain/contactImport.test.ts` (Apple vCard, vCard 2.1 quoted-printable, Google and Outlook CSV, bad files, merge-without-duplicates, re-import).

## Not yet

- iOS and Android are not tested (phone testing is deferred on the development Mac). Pending checks: the editor with the keyboard and safe areas, the channel chips, "From this iPhone" import with the permission prompt, and the file picker for `.vcf` on iOS.
- The Contact Picker path was not exercised: no Android device or emulator was available. Bridged chats were not exercised live (no bridge running locally); their matching is covered by unit tests.
- Search's person results still use public names.

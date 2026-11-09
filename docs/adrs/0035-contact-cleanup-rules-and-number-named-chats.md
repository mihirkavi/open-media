# ADR 0035: Contact cleanup rules on import, and chats named with a phone number

- Status: **accepted; built and verified on the web locally** (2026-11-07). Not committed or deployed. No database change (contact cards stay encrypted JSON, ADR 0013). iOS and Android are not tested yet.
- Builds on: [ADR 0023](0023-editable-contacts-and-one-conversation-per-person.md) (contact import, matching, one conversation per person), [ADR 0011](0011-bridged-messaging-networks.md) (bridged chats).

## Context

The owner cleaned their own Apple and iCloud contacts with a written set of rules (no invented details, real names in name fields, real numbers in phone fields, LinkedIn as a profile, no technical metadata in notes, never merge people only because they share a switchboard), and asked for the same rules in Open Media's contacts. They also reported a contact they had already saved by number still showing **Add to my contacts** in a Signal chat.

That chat's cause: Signal identifies a person by a UUID, not a phone number. The Signal bridge names a one-to-one chat with the person's number while the person joins under their Signal profile name, so the app had no number to compare with the saved card. ADR 0023's third matching rule (a saved number reaches a chat whose id is that number) only worked for WhatsApp.

## Decision

### Chats named with a number (Signal, Google Messages, Google Voice, WhatsApp)

- The Worker (`services/mail-sync/src/bridges.ts`) gives the one other person in a one-to-one chat on a phone-number network a `phone` when the chat's name, the bridge channel's name or the person's display name is only a phone number. A chat whose other side never joined keeps the earlier stand-in member (`@<ghost>+<digits>`). Groups never get one.
- The app (`src/domain/bridgedChats.ts`, `src/domain/people.ts`) carries it as a `phone` identity and as `phone` on the chat's identity (`{ kind: 'bridge', network, id, phone }`). The identity's key is still the chat id, so links and "not this person" choices are unchanged. A card holds the chat when one of its numbers, or a handle on that network, is that number. **Add to my contacts** from such a chat saves the number too.
- `samePhone` also matches a number written with its national trunk 0 (052…, 098…, 07…) to its international form. Two numbers that both have a country code must still match exactly, so +1… and +91… never join.

### Cleanup rules on import (`src/domain/contactRules.ts`)

Every vCard or CSV import applies them before the review step:

- **Names**: repairs UTF-8 text read as Mac Roman ("Jos‚àö¬©" → "José"); removes emails (moved to the email list), pronouns, well-known credentials (MBA, PMP, Ph.D., CFA, SHRM-CP…), emoji, flags, ®/™, Apple's contractor markers and "(Sample)", and repeated parts ("Erica Ablan-Go Ablan-Go"); spaces "Alekhya(Allu)" as "Alekhya (Allu)"; fixes ALL CAPS and all lower case while keeping initials, particles and McGill-style capitals; keeps Jr., Sr., II–IV. A "name" that is only a number, or a spreadsheet's header row ("First Name Middle Name Last Name"), leaves the name empty.
- **Companies**: a card Apple marks `X-ABShowAs:COMPANY`, or one with only an organisation, keeps its name as written and is flagged `company` (no person-name rules).
- **Phones**: placeholders ("Mobile", "Home Phone", "0", "+00000000"), glued metadata ("ROLE:…", "(smsft)") and invisible characters are removed; " ::: " values and two glued +91 numbers are split; an impossible "+0" is dropped. Short codes and USSD codes stay. **No country code is ever guessed.**
- **Emails**: placeholders ("Email Address", "work") go; text glued after the domain goes; domains are never "corrected".
- **Profiles**: LinkedIn usernames are read from broken links too ("https::https::http://…", a link inside a link, accented usernames). Apple's WhatsApp profiles (`x-userid=…@s.whatsapp.net`) become WhatsApp handles. LinkedIn `URL`s become LinkedIn handles.
- **Notes**: phone numbers, emails, LinkedIn links and "Contact type: Company" found in an exported note move to their fields; **the note's text is not imported**, because exports fill notes with metadata (connection dates, CRM fields). This changes ADR 0023, which imported notes.

### Merging on import

An imported contact joins a saved card, or another entry in the same file, when they share an email address (not a shared mailbox such as info@ or careers@), a phone number or a handle, **and their names fit together** (one name's words include the other's, or the first names agree or one shortens the other, with no clash in the last name). A shared LinkedIn profile is enough on its own. Two entries in the same file with the same full name are one person unless their LinkedIn profiles differ. Saved contacts are still never matched by name alone. So a household number, an office switchboard or sample data never joins two different people.

## Consequences

- A contact saved only by number now names, merges and opens correctly from a Signal or Google Messages chat that is named with that number. A chat named with the person's own name (no number anywhere) still needs the contact added from the chat once (which links its id), as before.
- Import is stricter: some rows that used to become a contact with a placeholder name are skipped, and note text is no longer imported.
- Cards still have no fields for company, job title, birthday, postal address, website or phone labels, so those parts of a vCard are not imported. Adding them is a separate decision (it needs editor and profile changes on every platform).
- Tests: `src/domain/contactRules.test.ts`, new cases in `src/domain/contactMerge.test.ts`, `src/domain/contactImport.test.ts` and `services/mail-sync/src/bridges.test.ts`. All test data is made up.

## Not yet

- iOS and Android are not tested (the import box and profile are shared code; the change is in domain logic and the Worker).
- The fix for number-named chats was checked against the shape of a real Signal chat on the local bridge, through unit tests and a local replay; it was not checked in the running app with the bridges started.

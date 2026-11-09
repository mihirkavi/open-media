# ADR 0036: A Contacts page, an Apple-style contact card and editor, and export

- Status: **accepted; built and verified on the web locally** (2026-11-07), at desktop width and at phone width (390 px). Not committed or deployed. No database change: contact cards stay encrypted JSON (ADR 0013); `company` is a new optional field. iOS and Android are not tested yet.
- Builds on: [ADR 0023](0023-editable-contacts-and-one-conversation-per-person.md) (contacts, editing, import), [ADR 0035](0035-contact-cleanup-rules-and-number-named-chats.md) (cleanup rules).
- Changes ADR 0023: contacts move from a collapsible box inside Profile to their own page, reached from Profile (like Settings); deleting no longer asks for a second tap.

## Context

The owner asked for the most seamless contacts experience (viewing, adding, editing, importing, exporting and deleting), following the master builder prompt (§14 "Don't make me think", §15 white, black type, restrained grays, generous whitespace) and inspired by apple.com and nike.com. Research covered Apple's Human Interface Guidelines (lists, sheets, alerts, undo, typography, accessibility), Apple Contacts and Google Contacts help pages, Cardhop, Linear's redesign notes, and the live CSS of apple.com and nike.com.

What the old design lacked: there was no way to add a contact from scratch, no export, no search, and no A–Z order; the list was hidden in a collapsed box among Profile settings and would not scale to thousands of contacts; companies looked like people; delete needed two taps.

## Decision

**Contacts page** (`src/ui/ContactsPage.tsx`, destination `#contacts`, opened from a "Contacts" row in Profile; Back returns to Profile). No new tab: the builder prompt keeps navigation to Feed, Clips and Messages.

- A Large Title (34 pt bold), a lock line "N people · only you can see them", then **New contact** (black pill), **Import** and **Export** (gray pills; round icon buttons on a phone).
- One search field: the start of any name word or nickname, the start of a handle, digits anywhere in a number, and inside email addresses only when the search has "@" or ".", as in Apple Contacts. No match offers "Add “query”".
- My card first, then a suggestions banner when people may already be contacts, then everyone A to Z with letter headers, in a virtualised `SectionList` so thousands of contacts scroll smoothly.
- Rows: a 40 pt avatar (initials; companies get a building icon in a rounded square), the name at 17 pt, and one line of how you reach them ("+1 (555) 010-0021 · Signal · LinkedIn"). Rows are at least 60 pt tall.
- Empty state: "Your people, in one place." with the import sources.

**Contact card** (`src/ui/ContactCardView.tsx`, inside the person's profile): Call and Mail actions under the name when there is a number or address; a quiet "Only you see this" line with **Edit**; details in one rounded group, label above value (13 pt over 17 pt), tap to call, write or open the profile; numbers shown the way people read them (`displayPhone`, display only). Linked chats get their own group with **Unlink**. Someone not saved gets "Add to Contacts" and "Add to an Existing Contact" rows (Apple's wording).

**Editing** (`src/ui/ContactEditor.tsx`): Cancel on the left, Done on the right (HIG); the name; then numbers, emails and accounts, each with a red remove control, and green "add phone", "add email", "add account" rows; notes; **Delete Contact** last. A new contact is a draft until Done: Cancel discards it and leaves the page.

**Deleting**: immediate, with an "N deleted · Undo" bar for 8 seconds, instead of a confirmation (HIG: avoid alerts for common, undoable actions).

**Import** (`src/ui/ContactImport.tsx`): the sources as rows in one group, then a review with large counts (new, add details, already saved) and one full-width "Import N contacts" button, Cancel below.

**Export** (`src/domain/contactExport.ts`, `src/data/contactExportFiles.ts`): every contact as one vCard 3.0 file, "Open Media Contacts YYYY-MM-DD.vcf": structured names, emails labelled Home or Work, LinkedIn and other accounts as social profiles Apple Contacts recognises, companies with Apple's company flag, notes, lines folded at 75 bytes. The web downloads it; iOS shares the file; Android shares the vCard text. Your own card is left out. Re-importing the export changes nothing.

**Design tokens** (`src/ui/contactsDesign.ts`): Apple's text sizes (34, 28, 17, 15, 13), spacing 4–32, group radius 20, pill buttons, 44 pt touch targets (48 dp on Android), colours only from the app theme (so dark mode follows), red only for removing and deleting, green only for adding a field, a 0.97 press scale.

## Consequences

- Contacts scale to thousands and are reachable in two taps from Profile.
- Deleting is faster and recoverable for 8 seconds; after that it is gone, as before (there is no "Recently deleted" yet).
- Tests: `src/domain/contactExport.test.ts` (Apple-compatible output, folding, round trip), `displayPhone` in `src/domain/contactRules.test.ts`. The exported file was also read by Apple's Contacts framework on macOS: names, company flags and social profiles came through.

## Not yet

- iOS and Android are not tested. On Android, export shares the vCard as text rather than as a file.
- Not built from the research: swipe actions on rows, an A–Z index rail, a "Recently deleted" list, CSV export, bulk select, a duplicates review screen, labels for numbers and emails (cards have no label field yet), and company, job title, birthday and address fields.

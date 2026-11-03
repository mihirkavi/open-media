# ADR 0026: Read receipts, honest per channel

- Status: **accepted; Open Media messages built and verified on the web locally** (2026-11-03). Migration `20261113120000_message_receipts.sql` is applied to the local database only.
- Email read state and bridged chats' receipts: **built and tested** (2026-11-02, see "Email and bridged chats" below). Migration `20261114120000_mail_read_state.sql` is applied to the local database only. Bridged receipts are not yet tested against a real homeserver and bridge. iOS and Android not tested.

## Context

The owner asked for read receipts "whereever possible including emails", sent, delivered and read, with the standard symbols. Before this, nothing recorded reading: `conversation_members.last_read_at` existed but was never written, and every conversation reported `unreadCount: 0`, so the Unread filter could never find anything real.

The builder prompt does not mention receipts. Its privacy rules apply: receipts disclose behaviour (when someone reads), so people must be able to turn them off, and the product must "never pretend unsupported features exist".

## Decision

### What each channel can honestly say

| Channel | Shown | Why |
|---|---|---|
| Open Media | Sending · Sent ✓ · Delivered ✓✓ · Read ✓✓ (full colour) with time | Open Media runs both ends |
| Bridged chats | Sent ✓ · Delivered ✓✓ · Read ✓✓ with time, as the bridge reports them | mautrix bridges relay WhatsApp, Signal and others' delivery and read receipts |
| Email | Sent ✓ only | Email has no reliable delivered or read signal. Return-receipt headers are mostly ignored, and tracking pixels would break the privacy principles, so Open Media never claims either |

Email and bridged chats still get real **unread** counts, and opening them reads them (below).

"Delivered" means the other person's app fetched the conversation. "Read" means they had it on screen with a newer message from you. In a group, both wait for everyone.

### Storage and privacy

Read and delivery times live in `public.conversation_reads`, not on `conversation_members`. Every member can select `conversation_members`, so one person's opt-out could not be enforced there. Both new tables have RLS on with no grants. Everything goes through security-definer functions:

- `open_media_mark_delivered()`: called after the app loads conversations.
- `open_media_mark_read(conversation)`: the conversation on screen; members only.
- `open_media_conversation_receipts(ids)`: delivery for every member, and read times only when both the caller and that member share read receipts. The caller always gets their own row, for unread counts.
- `open_media_message_settings()` and `open_media_set_read_receipts(share)`.

Read receipts are **reciprocal**, as in WhatsApp: turning them off also hides other people's. Delivery is always shown. They are on by default.

### No new buttons

The thread shows a tick under each group of your messages and words under your latest one ("Read 9:41 PM"), extending the existing "Sending…" line. Turning receipts off or on is done in Search: "turn off read receipts" or "read receipts on". The row explains the reciprocity before it is chosen.

### Unread counts

Unread is now real for Open Media chats: messages from others after your read time. Before you have ever opened a conversation, your own reply counts as having read what came before it, so the first rollout doesn't mark old history unread.

### Agents

`list_conversations` returns `unread` per conversation and `receipt` (and `readAt`) on your own messages. `mark_conversation_read` and `set_read_receipts` (also `POST /v1/me/conversations/{id}/read` and `PUT /v1/me/settings/read-receipts`) do what the app does. Agents are told to confirm before changing the setting.

### Email and bridged chats

**Email unread state.** Unread is the mail server's own read flag, so it matches every other mail app.

- IMAP: each time sync reads INBOX it also reads the `\Seen` flag of the newest 50 messages and stores it (`private.mail_messages.seen`, through `open_media_set_mail_seen`). New mail is saved first, then its flag. A flag changed in another mail app also ends the live wait (ADR 0025), so mail read on a phone stops showing unread here within moments.
- POP has no read state on the server; POP mail counts as read. So do sent mail and all mail stored before this change, so the rollout marks nothing old as unread.
- The app reads unread mail through `open_media_unseen_mail()`. If that function doesn't exist yet, everything counts as read, as before.
- Opening an email conversation calls `POST /v1/mail-accounts/{id}/seen` with its unread Message-IDs. The service stores them as read, then signs in to IMAP, finds each message by Message-ID (or UID when there was none) and adds `\Seen`, as opening it in any mail app would. If the server can't be reached, the mail still counts as read here; the next sync that reads INBOX brings back the server's state.
- Marking mail read tells the sender nothing. Outbound email still says only "Sent": no read-receipt (MDN) requests, which most mail apps ignore or ask about, and no tracking pixels.

**Bridged chats.**

- The bridge sync now asks Matrix for read receipts (`m.receipt`, `m.read`). One of your messages is **read** once every other member's receipt is at or after it, at the earliest of their receipt times, as in a group of Open Media chats. Read implies delivered.
- **Delivered** comes from the bridge's message status events (`com.beeper.message_send_status` with `delivered_to_users`) when the bridge sends them; otherwise a message stays at Sent until it is read.
- **Unread** counts messages from others after your own receipt or your latest message, whichever is later (the same first-rollout rule as Open Media chats). When neither is among the 30 events the sync reads, the homeserver's own `unread_notifications` count caps it.
- Opening a bridged chat sends a receipt for its latest message from the other side (`POST /v1/bridges/rooms/{id}/read`).
- Two fixes found while verifying this against the local homeserver:
  - Room version 12 room ids have no `:server` part. The service rejected them as "Chat not found", for sending as well as for receipts; both forms are accepted now.
  - Synapse answered the bridge sync, which is identical on every poll, from its response cache, so new messages and receipts stayed out of view for minutes. The filter now changes every 15 seconds: answers are at most that old, and Synapse still computes at most one sync per 15 s per person.
- **Reciprocity**: with read receipts shared, that is `m.read`, which the bridge passes on to WhatsApp, Signal and the rest. With them off, it is `m.read.private`: it clears the unread count on our homeserver and tells no one. The service also drops others' read times from bridged chats (delivery stays). It reads the setting through `open_media_message_settings`; if that fails, it treats receipts as off, so nothing is disclosed by mistake.

## Consequences

- Receipts update when the conversation list reloads (opening Messages, new messages, pull to refresh), not live while both people stare at the thread.
- Verified on the web locally (2026-11-02), synthetic data only, at phone width (375 px) and desktop width:
  - Email: mail sent to a test address through Mailpit, served over IMAP by a throwaway front that reports Mailpit's read state as `\Seen` (kept outside the repo). Unread marks appeared from the server's flags. Opening a conversation found its message by Message-ID and set `\Seen` on the server. Marking mail read in Mailpit ("another app") cleared the mark in Open Media within about 3 seconds.
  - Bridged chats: a synthetic WhatsApp-style chat on the local Synapse (a fake `whatsapp_` ghost; nothing reached WhatsApp). The chat showed "Delivered" from a bridge status event and "Read 11:51 PM" from the ghost's `m.read`. Opening it sent `m.read`, or `m.read.private` with read receipts off, and then the read time was hidden and the other side saw no new receipt.
  - Not verified: a real mautrix bridge relaying receipts to and from WhatsApp, a real IMAP provider, iOS and Android.
- Bridged receipts depend on the bridge: networks or bridges that don't relay receipts stay at Sent. Mail or chats read on another device only clear here when the server knows: IMAP always does; a bridged chat only if the bridge relays your own reads (double puppeting).
- Email read state from other mail apps only covers the newest 50 INBOX messages, the same window sync reads.
- For agents, `list_conversations` and `mark_conversation_read` still cover Open Media chats only, and the email listing has no unread flag yet.
- The owner applies `20261114120000_mail_read_state.sql` to production. Until then the app and service work as before: all mail counts as read, and marking it read only sets the flag on the IMAP server.
- Tests:
  - `src/domain/receipts.test.ts` covers states, groups, hidden receipts and unread counts.
  - `supabase/tests/open_media_message_receipts_test.sql` covers 14 checks, including reciprocity and strangers seeing nothing.
  - `services/mail-sync/src/imap.test.ts`: read state is reported after saving; mail read elsewhere ends the wait; opening marks `\Seen` by Message-ID or UID.
  - `services/mail-sync/src/bridges.test.ts`: read up to the other side's receipt, delivered from status events, unread counts, hidden read times, `m.read` versus `m.read.private`.
  - `src/domain/emailNormalization.test.ts` and `src/domain/bridgedChats.test.ts`: unread counts, which mail opening marks read, and the receipts shown.
  - `supabase/tests/open_media_mail_read_state_test.sql`: 8 checks, including that sent mail is never unread and one person can't touch another's mail.

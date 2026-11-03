# ADR 0026: Read receipts, honest per channel

- Status: **accepted; Open Media messages built and verified on the web locally** (2026-11-03). Migration `20261113120000_message_receipts.sql` is applied to the local database only. Bridged chats and email read state are not built yet (see Consequences). iOS and Android not tested.

## Context

The owner asked for read receipts "whereever possible including emails", sent, delivered and read, with the standard symbols. Before this, nothing recorded reading: `conversation_members.last_read_at` existed but was never written, and every conversation reported `unreadCount: 0`, so the Unread filter could never find anything real.

The builder prompt does not mention receipts. Its privacy rules apply: receipts disclose behaviour (when someone reads), so people must be able to turn them off, and the product must "never pretend unsupported features exist".

## Decision

### What each channel can honestly say

| Channel | Shown | Why |
|---|---|---|
| Open Media | Sending · Sent ✓ · Delivered ✓✓ · Read ✓✓ (full colour) with time | Open Media runs both ends |
| Bridged chats | Sent now; read later from the bridge's Matrix `m.read` receipts | mautrix bridges relay WhatsApp, Signal and others' read receipts |
| Email | Sent ✓ only | Email has no reliable delivered or read signal. Return-receipt headers are mostly ignored, and tracking pixels would break the privacy principles, so Open Media never claims either |

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

## Consequences

- Receipts update when the conversation list reloads (opening Messages, new messages, pull to refresh), not live while both people stare at the thread.
- Still to build:
  - bridged chats' read receipts (Matrix `m.receipt` in the bridge sync, and sending `m.read` when a bridged chat is opened);
  - email unread state from IMAP `\Seen`, and marking mail seen on the server when it is opened.
- Tests:
  - `src/domain/receipts.test.ts` covers states, groups, hidden receipts and unread counts.
  - `supabase/tests/open_media_message_receipts_test.sql` covers 14 checks, including reciprocity and strangers seeing nothing.

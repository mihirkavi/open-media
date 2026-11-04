# ADR 0032: Message reactions, iMessage-style replies and times

- Status: **accepted; built and checked on the web locally** (2026-11-04). Not deployed: the migration `20261120120000_message_reactions.sql` is applied to the local database only. iOS and Android are not tested; the phone gestures (long-press, double-tap, swipe left for times) were only checked in a phone-sized browser.

## Context

The owner asked for a better-looking reply design in chats, reactions on messages, and timestamps "in an aesthetic way how iMessages do". Replies were a quote with a grey bar inside the reply bubble; times were plain grey lines; there were no reactions. The [no-new-buttons rule](../../AGENTS.md) applies, but the owner asked for reactions by name. They use the gestures the thread already had (hover and long-press, which used to start a reply) and add no permanent controls.

## Decision

### Reactions (tapbacks)

- Six quick reactions, like iMessage: ❤️ 👍 👎 😂 ‼️ ❓ (`tapbacks` in `src/domain/reactions.ts`). One per person per message: picking another replaces it, picking the same one takes it off.
- **Opening the bar:** long-press or double-tap a message on a phone; double-click it, or use the smile in the hover tray, on the web. The bar floats above the bubble with a small spring, ringed on your current choice, with Reply at the end. The rest of the thread fades back while it is open. Tapping anywhere else, or Escape, closes it.
- **Badges** sit over the bubble's top corner (the outer corner of messages you receive, the inner one of yours), with a small tail dot. Yours alone is dark; other people's are light. Up to three different emoji show, then a total. Tapping a badge opens the bar. The screen reader reads "Ben loved this", "You and Ben liked this".
- **Storage:** `public.message_reactions`, one row per (message, person). Members can read their conversations' rows. Nobody writes the table directly: `open_media_set_reaction(message, emoji)` checks membership, blocks (no new reactions while either side has blocked the other; taking one off still works) and that the value is one emoji. The table is in the realtime publication, so reactions arrive live. Your own shows at once and is rolled back if the server refuses it.
- Only Open Media chats have reactions. Email, bridged networks, Matrix and Open Media AI don't, because none of them can carry one back yet.

### Replies

- The message being answered sits above the reply as a faint "ghost" bubble (outlined, smaller grey text, the original sender's name), joined to the reply by a thin line that curves down into it. Tapping the ghost scrolls back to the original, which briefly lights up.
- The composer shows "Replying to Ben" and the quoted line inside the message box, above the text, with a close button.

### Times

- The time line between messages reads like iMessage: the day in semibold and the time lighter ("**Today** 9:41 AM", "**Yesterday** 9:41 AM", "**Monday** 9:41 AM", "**Tue, Sep 1** at 9:41 AM"). It still appears after an hour's gap.
- Each message's own time: on the web, in the hover tray beside the bubble (wide windows only). On phones, swipe the thread left: your bubbles slide aside, the times come in from the right edge, and everything springs back when you let go.

## Consequences

- One more table and function; the conversation load makes one more query (it fails soft on servers without the table).
- A long-press on a message now opens the tapback bar instead of replying at once; Reply is in the bar. Where reactions aren't available, long-press still replies at once.
- The swipe for times and the long-press bar need a check on a real iPhone and Android phone.

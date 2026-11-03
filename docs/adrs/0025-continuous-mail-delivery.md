# ADR 0025: Continuous mail delivery

- Status: **accepted; built and tested locally** (2026-11-02). Not committed or deployed. No database migration and no new Cloudflare bindings. iOS and Android are not tested yet.
- Builds on: the live-mail long poll deployed on 2026-10-31 (`POST /v1/mail-accounts/:id/sync?wait=1`, IMAP IDLE in `services/mail-sync/src/imap.ts`, `src/ui/useLiveMail.ts`).
- Owner rules: no new buttons or screens; never read or log mail content.

## Context

The owner asked for email to be fetched continuously, "like any other email client". The 2026-10-31 long poll already existed: while the app is open, each mailbox keeps one sync open, the Worker signs in to IMAP, reads new mail, then waits in IDLE for about 25 seconds and answers when new mail arrives. The owner still did not see mail arrive on its own.

What the code and Worker analytics showed (status and timing only, 2026-10-30 to 2026-11-02, `workersInvocationsAdaptive`; Workers Logs were not readable with the current wrangler token):

1. **Long polls run.** Wall time p99 is about 27.7 s on every recent version: the 25 s wait plus about 2.7 s of work before it. CPU p99 is 0.1–0.3 s. 103 requests ended as `clientDisconnected` (an app closed mid-wait, as expected) and 20 as `exceededResources` (large first syncs, unrelated).
2. **Each 25 s cycle repeated a full sync before waiting**: sign in, LIST, open INBOX and read 50 headers, open Sent and read 25 headers, ask Supabase which of those 75 Message-IDs are stored, then open INBOX again and IDLE. Most of the 2.7 s, and most of the load on the mail server, was this repeated check.
3. **One rate limit covered every mailbox and device.** `MAIL_SYNC_RATE_LIMITER` allows 12 syncs a minute per **user**. A cycle every ~27 s is ~2.2 a minute per mailbox per open device, so three mailboxes open on a laptop and a phone (~13 a minute) are already over it. A refused sync counts as a failure, and the app backs off for 15, 30, then 60 seconds, so mail stalls in exactly the multi-mailbox, multi-device setup the owner has.
4. **POP mailboxes looped.** `syncPop3` re-downloaded and returned the newest 50 messages on every sync. The app read "50 new messages", refreshed, and asked again at once, until the rate limit stopped it (point 3).
5. **A gap before IDLE.** IDLE compared against the INBOX count taken when INBOX was re-opened, so mail that arrived after INBOX was read but before IDLE began waited for the next cycle. A deletion followed by a new message also left the count unchanged, so that mail did not end the wait.
6. **Hidden web tabs stopped.** On the web, react-native-web reports a hidden tab as `background`, and the hook stopped following mail until the tab was shown again. Desktop mail clients keep fetching while in the background.
7. **Nothing runs while the app is closed.** The `* * * * *` and `17 */4 * * *` crons serve the marketplace and planned events; neither touches mail. When the app opens, stored mail shows at once and the first live sync fetches what arrived meanwhile.

## Options

| Option | Latency while open | Ready on reopen | Cost and limits | Verdict |
| --- | --- | --- | --- | --- |
| **A. Foreground IDLE long poll, made cheap** (what exists, fixed) | Seconds where IDLE works; at most one wait (~40 s) where it doesn't | First sync on open, usually 1–3 s, only new bodies downloaded | One sign-in per ~40 s per mailbox per open device; no extra storage; no wall-time limit while a client is connected | **Chosen** |
| B. Per-minute cron poll of every mailbox (STATUS UIDNEXT, or CONDSTORE HIGHESTMODSEQ) | Up to 60 s | Yes, within a minute | 1,440 sign-ins a day per mailbox even when nobody looks (iCloud and Gmail may throttle that from shared Cloudflare IPs). Needs a service-role path that decrypts every user's mailbox password outside a user request, new RPCs and a migration, and fan-out (6 open sockets per invocation) as users grow | Later, if push notifications need it |
| C. Durable Object per mailbox holding an IDLE connection | Seconds, even when closed | Yes | An outbound socket keeps the object awake (no hibernation): about 2.6 M GB-s a month per mailbox at 128 MB, roughly $4 per mailbox per month, plus reconnect logic for evictions and every deploy, and 29-minute IDLE renewals | Rejected for now |
| D. Push to the client (WebSocket, SSE, Supabase Realtime) | Same as the producer | No by itself | Only a transport: something must still watch the mailbox (A, B or C). The long poll already is the push channel for A | Not needed with A |

CONDSTORE (option B's cheaper check) only helps once the server keeps state per mailbox; UIDNEXT gives the same "anything new?" answer for new mail and is supported by every IMAP server, so A uses UIDNEXT.

## Decision

Keep the foreground long poll as the delivery path and fix what made it unreliable.

1. **Cursor.** Every sync answer carries an opaque `cursor`: `i1.<INBOX UIDVALIDITY>.<UIDNEXT>.<Sent UIDVALIDITY>.<UIDNEXT>` for IMAP, `p1.<count>.<UIDL of the newest message>` for POP (`services/mail-sync/src/mailCursor.ts`). The app sends it back on the next live sync (`followMailAccount`, `?wait=1&cursor=…`). A folder whose UIDVALIDITY and UIDNEXT haven't changed is not read at all: no header FETCH and no Supabase lookup. A live sync with nothing new is now sign-in, LIST, two EXAMINEs and IDLE. The cursor is only a hint; a missing, stale, edited or malformed one makes the sync read the folders as before, and stored Message-IDs still prevent duplicates. It holds no addresses or content. Plain syncs (opening Settings, pull to refresh) send no cursor, so they still re-check everything, including mail saved before names and Cc were kept.
2. **Rate limit per mailbox.** The sync limiter key becomes `user:mailbox`, so each mailbox has its own 12 a minute. A live mailbox uses ~1.5 a minute per open device (one 40 s wait each); POP mailboxes use 4 a minute per device (one check every 15 s).
3. **POP.** With a cursor, an unchanged POP mailbox costs sign-in, STAT and UIDL; otherwise only messages after the newest one seen are downloaded. Only mail not stored yet is returned and saved, so the app no longer loops. A `-ERR` reply to a list command (UIDL on servers without it) is now read as one line instead of waiting for the 30 s timeout; such servers fall back to comparing the count.
4. **No gap before IDLE.** After re-opening INBOX, if its UIDNEXT has moved past where INBOX was read, the new mail is fetched at once. While waiting, each EXPUNGE lowers the baseline, so a new message after a deletion ends the wait.
5. **40 s waits** instead of 25 s: fewer sign-ins, still inside every timeout on the path (Cloudflare 100 s, iOS 60 s of silence, browsers).
6. **Web tabs keep following mail when hidden.** Phones still stop in the background, where the system suspends the app anyway, and catch up when it returns.
7. **Status.** No new status UI. Failures stay quiet and back off (15 s, 30 s, then every minute), and mail already stored keeps showing. Settings' existing per-mailbox count and error message are unchanged.

## Consequences

- While the app is open, IMAP mail with working IDLE (Gmail, iCloud, Fastmail, most hosts) appears in Messages a moment after the server accepts it; servers without IDLE, and POP, within about 15 seconds.
- Each open device keeps one IMAP connection per mailbox. iCloud and Gmail allow well over the handful this needs.
- When the app is closed, nothing fetches mail. On reopen, stored mail shows first and the first live sync adds what arrived meanwhile. Push notifications for new mail would need option B or C, plus APNs/FCM; that is a separate decision.
- **Not yet confirmed against a real iCloud or Gmail mailbox on Cloudflare's edge.** Unit tests cover IDLE with `process.nextTick` behaving as on Workers, the cursor, the gap and deletions; the local stack was verified end to end with the Mailpit test inbox (see Verification). The next step is a remote probe with a test (not personal) mailbox, or the owner watching mail arrive after deploy, plus Workers Logs (`imap_sync` lines, which record stage, milliseconds and counts only).

## Verification

- `services/mail-sync`: `mailCursor.test.ts` (round trip, malformed cursors), `imap.test.ts` (unchanged mailbox reads no headers; cursor from another UIDVALIDITY is ignored; mail arriving before IDLE; new mail after a deletion), `pop3.test.ts` (unchanged mailbox downloads nothing, then only the new message; unstored-only results; servers without UIDL).
- Web, locally (`npm run local`, 2026-11-02): Mailpit has no IMAP and its POP3 is off in the local stack, so a throwaway IMAP front (kept outside the repo) served Mailpit's mail for one test address with IDLE, polling Mailpit every second. Mail sent over SMTP to Mailpit appeared in Messages with no action about 1 s later (desktop width, phone width, and with the tab reporting itself hidden). The second and later live syncs carried the cursor (`cursor=i1.1.3.1.1`).
- `npm run check` passes.
- Not verified: iOS and Android (deferred, the owner's laptop can't run the simulators), POP against a real server (covered by unit tests only), a real IMAP provider, and Cloudflare's edge.

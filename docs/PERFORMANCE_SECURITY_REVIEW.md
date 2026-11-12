# Performance, memory and security review (2026-11-11)

This review is read-only and covers:

- the app (`src/`, about 37k lines);
- the Worker (`services/mail-sync`, about 37k lines);
- Supabase (`supabase/`, about 10k lines);
- the SDK and CLI packages.

Each finding is marked **Confirmed** (the code path was read end to end) or **Plausible**. The scroll and stall fix is done; [ADR 0038](adrs/0038-bounded-media-and-virtualized-streams.md) records it. Everything else is the plan below.

## 1. Fixed now: "scroll gets slow after watching a few posts and clips"

| Cause | Fix |
|---|---|
| Feed videos kept a live player forever once tapped, and kept playing off screen | `usePlayback`: one plays, at most two exist, and a video pauses when it leaves the screen |
| Feed and Clips were `ScrollView` + `.map` and never unmounted | `FlatList` with small windows; Clips uses `getItemLayout` |
| Rows were not memoized, and "Why this?" scored every post on every render | `React.memo` rows and stable callbacks; the explanation is computed only when open |
| The bridged-chat poll re-rendered the whole app every 5 s | State is set only on a real change; the poll is foreground only and backs off for a minute when there are no bridges |
| The `PeopleProvider` value was new on every render | `useContactsStore` returns a memoized value |
| A `StyleSheet` was built per component instance (94 places) | `useThemedStyles`: built once per theme |
| The translation cache grew forever | Bounded to 600 entries |

## 1b. Fixed 2026-11-11: profiled responsiveness pass

Measured with Playwright at 4× CPU throttling (local stack, a synthetic 400-message chat) and against production.

| Measured problem | Before | After | Fix |
|---|---|---|---|
| Typing in a long chat (P3) | ~1,150 ms per keystroke | ~30 ms | `MessageThread` memoizes its rows (`threadRows`); keystrokes re-render only the composer |
| A new message appearing (P1) | ~660 ms | ~170 ms | `loadOpenMediaConversations` sends its six queries at once instead of one after another, and assembles in linear time; realtime bursts coalesce into one reload (200 ms, never overlapping) |
| Reloads that changed nothing re-rendered the app (P1, P10) | every insert, every 3 s in Matrix mode | only on change | `nativeSignature` / `blockedSignature` in `OpenMediaApp` |
| Conversation list re-rendered every row (P4, partly) | all rows on any change | only the changed row | `ConversationRow` is `memo`; still not virtualized |
| First-page web JavaScript (P11) | 1.64 MB | 1.47 MB | Clips, Search, PersonProfile and Contacts are `lazyComponent`s, preloaded when idle |
| Fonts downloaded twice | 2× each Instrument Serif file | 1× | preload hints use the same `%40` spelling as expo-font |
| Worker script (cold isolate start-up; first API calls took 1.3–1.7 s) | 12.0 MB | 7.4 MB | `minify: true`; pdf.js (`unpdf`) loads only for PDF imports |
| Hashed JS waited for the Worker | Worker ran first | served directly | `run_worker_first: ["/*", "!/_expo/static/*"]` + `.web-dist/_headers` |
| Feed merges (P13) | O(n²) | O(n) | `withoutIds` in `useMixedFeed` |
| Bridge polls re-registered the Matrix user (P2, partly) | every 5 s | once per isolate | `registeredUsers` in `bridges.ts`; the full initial `/sync` remains |

## 2. Remaining performance and memory findings

| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| P1 | High | `src/data/openMediaService.ts:216-300`, `OpenMediaApp.tsx` realtime | Every message insert or reaction reloads **every message of every conversation**, with no limit. Four more requests run one after another, assembly is O(conversations × messages), and `mark_delivered` upserts a row per conversation. Past PostgREST's max-rows, history is silently cut off. | Load the last N messages per conversation (RPC or keyset), page older ones, apply realtime payloads incrementally, run the follow-up queries in parallel, and group with a `Map`. |
| P2 | High | `services/mail-sync/src/bridges.ts:116-199` | `/v1/bridges/conversations` (polled every 5 s per client) runs Matrix `/register` and a full **initial** `/sync` on every call. The filter changes every 15 s to defeat caching. | Store `next_batch` per user and use incremental or long-poll sync; set `lazy_load_members`; cache "user exists". |
| P3 | Med-High | `OpenMediaMessages.tsx:507, 805-966` | The composer state lives in the thread component, so every keystroke re-lays-out and re-renders the whole thread (`layoutThread` isn't memoized; ScrollView + map). | Move the composer into its own component, memoize the layout and rows, or use an inverted `FlatList`. |
| P4 | Medium | `OpenMediaMessages.tsx:271-313` | The conversation list is ScrollView + map with a PanResponder per row, for up to 500 mail threads. | `FlatList` and memoized rows. |
| P5 | Medium | `MediaPicker.tsx:324-400` | The GIF and sticker masonry appends animated images forever. `more()` has no abort, so a stale query's results can appear. | Virtualize, add a generation check or abort, and use static previews off screen. |
| P6 | Medium | `mailApiConnector.ts:109` | Each mail event refetches the 500 newest messages **with bodies** and normalizes them all again. | Fetch metadata and a snippet only, load bodies when a thread opens, and use a cursor. |
| P7 | Medium | `src/data/avatarFiles.ts` | iOS and Android upload the full cropped original (up to 5 MB) and show it at 32-48 px. | Resize to 512 px on native, like the web; consider `expo-image` for caching and downsampling. |
| P8 | Low-Med | `networkFeeds.ts:51,163`, `openNetworkFeeds.ts:96`, `interactionService.ts:89`, Worker `senderVerification.ts:34` | Module-level promise caches have no size cap. One has a TTL but never evicts. | A shared `LruMap(max, ttlMs)` used everywhere. |
| P9 | Low | `useUniversalSearch.ts:49-79` | Superseded searches aren't aborted. | Pass an `AbortSignal`. |
| P10 | Low | `OpenMediaApp.tsx` matrix mode | `refreshMessages` polls every 3 s and always sets state. | The same change-only rule as the bridged poll. |
| P11 | Low | `OpenMediaApp.tsx:45-61` | Clips, Search, Contacts, PersonProfile and Matrix are imported statically on the first page, against the AGENTS.md web rule. | `lazyComponent`. |
| P12 | Low | Supabase realtime `open-media-messages` | `postgres_changes` has no filter, so RLS is checked per subscriber for every insert. | Broadcast per conversation, or filter by `conversation_id`. |
| P13 | Low | `useMixedFeed.ts` | Merging is O(n²) (`.some` inside `.filter`) on every page and poll. | Deduplicate with a `Set` of ids. |

## 3. Security findings

No Critical or High issues. These are sound:

- RLS on every table;
- all 165 `SECURITY DEFINER` functions set `search_path=''`;
- HMAC webhooks checked in constant time;
- mail passwords stored with AES-GCM;
- strict CSP on server pages, and no HTML injection sinks;
- a checked fetch for feeds and imports;
- PKCE, Keychain `THIS_DEVICE_ONLY` and no WebView in the app.

| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| S1 | Medium | `supabase/migrations/20261123120000_contact_discovery.sql` | `open_media_discover_contacts` is granted to `authenticated` in `public`, so anyone can call it straight through PostgREST and skip the Worker's rate limit. It takes 500 values a call, discovery is on by default, and it returns handles for `handle_only` profiles. This enables enumeration from leaked email and phone lists. | Grant to `service_role` only, call through the Worker; add a per-user counter in the database; exclude `handle_only`; reconsider opt-in. |
| S2 | Medium | `worker.ts:56-74`, `accountOAuth.ts` | Dynamic client registration is open, and the `account` scope gives full read and write. An attacker can register a client named "Claude" with `redirect_uri=https://evil.example` and phish a consent. | Show the redirect host prominently with a warning for unknown hosts, make the account scope read-only by default with writes opted into, or require approved clients. |
| S3 | Medium (Plausible) | `PasskeyBridge.tsx`, `domain/passkeyBridge.ts` | The bridge signs any challenge in the URL fragment and returns it through the `openmedia://` custom scheme, which another app can claim. | Return through a universal or app link or an auth session, show the account and action, and bind an app nonce. |
| S4 | Medium | `src/connectors/publishing/deso.ts:35` | The DeSo identity state (the derived signing seed) is in AsyncStorage, not the Keychain. | `storageProvider: deviceSecretStorage()`. |
| S5 | Low-Med | `openNetworkFeeds.ts:72-136` (public `/v1/people/...`, `/open/mcp`) | The Mastodon and Nostr author lookups fetch any host from the handle with redirects and no public-address check. This is a server-side request forgery risk on self-hosted Node (`localServer.ts`). | Route through `fetchChecked` with `redirect:'manual'`. |
| S6 | Low | `senderIcons.ts:59-108` | The same server-side fetch issue for favicons. | `fetchChecked`. |
| S7 | Low | `securityHeaders.ts:45-57` | The CSP hashes every inline script in the rendered HTML, so a future injection would be allowed automatically. | Hash a fixed set of known scripts. |
| S8 | Low | `mailHandler.ts:360-363` | Raw `error.message` is returned to clients. | A generic message unless it is a `UserFacingError`. |
| S9 | Low | `ondc/http.ts`, `authEmail.ts` | No replay cache inside the signature window. | Remember seen ids in KV. |
| S10 | Low | `src/auth/supabase.ts:39` (web) | The session and network signers are in localStorage. The CSP mitigates this. | Document it; use non-extractable WebCrypto keys for signers. |
| S11 | Low | Migrations | `mail-attachments` has no MIME allow-list; `messages.edited_at` is client-settable; legacy `convo_*` grants remain. | Clean up. |
| S12 | Low (Plausible) | `post_videos.sql` | The public video bucket keeps URLs alive after removal. This is already documented. | A private bucket with signed URLs. |
| S13 | Low | `package.json` | Many `^`/`~` ranges, and GitHub dependencies pinned by tag. | `npm ci` in CI; pin by SHA. |

## 4. Architecture plan

The goal is that every class of issue above has **one place it can be done right** and **one check that fails when it is done wrong**, with a message that tells an agent the fix.

### Phase 1: the next sprint (high value, low risk)

**1. Lifecycle primitives in `src/ui/lifecycle/`.**

| Primitive | What it does |
|---|---|
| `usePolling(fn, { ms, when })` | Foreground and visible only, with backoff |
| `useAbortableEffect(signal => …)` | Effects whose requests are cancelled on cleanup |
| `useTimeout` | A timeout that is cleared on unmount |
| `LruMap(max, ttl)` | A bounded cache |
| `setIfChanged(setter, next, key)` | Sets state only when the value actually changed |

Move the bridged and matrix polls (P10), searches (P9) and every module cache (P8) onto these. Register them all with `trackResource` so `__openMedia.resources()` shows intervals, channels and cache sizes.

**2. Turn the hooks lint on for real.** The repo has 18 `eslint-disable react-hooks/exhaustive-deps` comments but no ESLint. Add ESLint with `react-hooks`, and add `no-restricted-syntax` rules for:

- `setInterval` outside `usePolling`;
- module-level `new Map` outside `LruMap`;
- `fetch(` outside an allow-listed client list in the Worker (for S5 and S6);
- `<ScrollView>` containing `.map(` over data.

Consider the React Compiler (React 19) to memoize automatically.

**3. Fix S1, S4, P1 and P2.** These are the highest-impact remaining items.

**4. CI.** There are no `.github/workflows`. Run `npm ci && npm run check` on every PR.

### Phase 2: structural

**5. A Worker route table.** Replace the regex `if` chains with a declared table:

```text
{ method, path, auth: public|user|agent|webhook|ondc, rateLimit, bodyLimit, handler }
```

A test fails if a route has no auth declaration. Outbound fetches must go through `fetchChecked` unless the host is fixed.

**6. A database grant lint** in `npm run test:db`. Every `public` function granted to `anon` or `authenticated` must be on an allow-list with a reason; every table has RLS; every function that takes a user id is service-role only; every list RPC has a `limit`.

**7. Messages data layer.**

- Paged queries, incremental realtime and a normalized store keyed by conversation (P1, P6, P12).
- A virtualized thread and list with the composer split out (P3, P4).

**8. Media pipeline.**

- `expo-image` with downsampling and a disk cache (P7, posters).
- The `usePlayback` owner extended to message media and the landing film.
- HLS transcoding for uploaded videos (README: "Videos are stored as uploaded").

### Phase 3: budgets that stop regressions

**9. Performance budgets in `npm run check`:**

- a first-page web chunk size limit;
- a Playwright idle test: on the Feed for 15 s, no network requests beyond the 20 s poll, no React commits, and `__openMedia.resources()` stays flat;
- a scroll test: after 100 cards, at most 30 cards in the DOM and at most 2 video players;
- an agent-device iOS run that samples memory before and after 50 clips and fails when growth is over 20%.

**10. A provider stability test.** Render each context provider twice with unchanged inputs and assert `Object.is(value)`. This would have caught the `PeopleProvider` problem.

**11. Threat model in the code.** A short section in `docs/SECURITY.md` per trust boundary (service-role users, OAuth scopes, ONDC, bridges), linked from those modules, so an agent sees the boundary where it edits.

## 5. How an agent finds and fixes these issues now

- **"Is something leaking?"**
  - Web: run `globalThis.__openMedia.resources()` in the console or Playwright before and after scrolling.
  - iOS: agent-device `perf memory` sample.

  A count that only grows is the leak.
- **"Where should media, polling or caches live?"** Media: `usePlayback`. Polling and caches: the Phase 1 primitives once built. The guard tests in `src/domain/performanceRules.test.ts` name the fix in their failure message.
- **"Which decisions apply?"** [ADR 0038](adrs/0038-bounded-media-and-virtualized-streams.md) and this file. Each finding has a file and line to start from.

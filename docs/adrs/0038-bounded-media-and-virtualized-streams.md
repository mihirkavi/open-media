# ADR 0038: Bounded video players, virtualized streams and resource counters

- Status: **accepted; built and verified locally** (2026-11-11) on the web (390 px, signed out) and the iOS Simulator (iPhone 17, signed in). Android not run (the Mac's JDK is too old). Nothing to deploy beyond the app.
- Review and roadmap this came from: [`docs/PERFORMANCE_SECURITY_REVIEW.md`](../PERFORMANCE_SECURITY_REVIEW.md).

## Context

The owner reported: "the scroll becomes really slow after I watch a few posts and clips; it hangs and stalls the app." Causes, from the code:

1. **Feed videos never gave their players back.** `FeedVideo` mounted `ClipVideo` on the first tap and kept it for the rest of the session. Each one holds an AVPlayer/ExoPlayer (or a `<video>` plus hls.js on the web) with decoders and buffers, and **kept playing after it scrolled away**. Every video watched added one more live player.
2. **Feed and Clips rendered every post ever loaded.** Both were `ScrollView` + `.map`. Infinite scroll kept adding cards, posters, overlays and translation hooks, and none of them unmounted.
3. **Every row re-rendered on every app render.** `PostCard` and `Clip` were not memoized, and `explainFeedPost` scored every post on every render. App-wide renders were frequent:
   - the bridged-chat poll replaced its state with a new array every 5 s, even when nothing changed (or `[]` when there are no bridges);
   - the contacts store (the `PeopleProvider` value) was a new object on every render, so every post header re-rendered too.
4. Each component instance built its own `StyleSheet` (`useMemo(() => createStyles(colors))` in 94 places, including every row), and translations were cached forever.

## Decision

- **One owner for inline video** (`src/domain/mediaPlayback.ts`, pure and tested; `src/ui/usePlayback.ts`):
  - one video plays at a time;
  - at most `maxLivePlayers` (2) players exist, and the least recently played one goes back to its poster;
  - lists report what is on screen through `reportVisibleMedia`, and a playing video that leaves the screen pauses;
  - a row that unmounts releases its player.
- **Streams are virtualized:**
  - Feed is a `FlatList` (window 7, batches of 6), with the header, composer and notices in `ListHeaderComponent`.
  - Clips is a paged `FlatList` with `getItemLayout` and a window of 3. Players still exist only for the active clip ±1.
- **Rows are memoized:** `PostCard` and `Clip` are `React.memo`, the row callbacks are stable, and "Why this?" is computed only when it is open.
- **App-wide renders are cut:**
  - the bridged-chat poll sets state only when the chats changed, skips while backgrounded or hidden, and waits a minute after "no bridges";
  - the contacts store value is memoized.
- **Styles are built once per theme:** `useThemedStyles(createStyles)` caches by factory and theme.
- **Translation cache bounded** to 600 entries, oldest first.
- **Resource counters** (`src/ui/diagnostics.ts`): `trackResource(kind)` counts live expensive resources. In development, `globalThis.__openMedia.resources()` and `.playback()` show the counts from the browser console, Playwright or a React Native debugger. Video players are tracked today.
- **Guard rails** (`src/domain/performanceRules.test.ts`) fail when:
  - a new screen renders `ClipVideo` outside the bounded owners;
  - Feed or Clips go back to `ScrollView`;
  - a component builds styles per instance;
  - `PostCard` or `Clip` loses `memo`.

## Verification (2026-11-11)

- `npm run check` passed: typecheck, 403 app tests, Worker tests, web export, packages. The new playback and guard tests pass.
- **Web, 390 px, Playwright:**
  - Feed scrolled to about 56,000 px with 15–24 cards in the page (about 600 DOM nodes), and 6 cards after returning to the top.
  - Clips through 20 clips: always exactly 3 players, 1 playing, about 180 DOM nodes.
  - A feed video started then scrolled away was paused and released (0 players).
- **iOS Simulator:**
  - Feed resident memory was 193 MB after 40 flings and 136 MB after 100 more, so it no longer grows.
  - Clips was 241 MB after 25 clips and 246 MB after 50.
  - The Clips overlay, player and "new clips" pill all work.
- **Not verified:** Android; a physical iPhone (frame-hitch sampling needs a device); feed-video playback with sound on the web (headless autoplay rules block it; a real tap is a user gesture).

## Consequences

- Scrolling back to a feed video more than two videos ago shows its poster again and starts from the beginning.
- Any new list that plays media must use `usePlayback` and report `onViewableItemsChanged` (the guard test says so).
- Future leaks show up as a number in `__openMedia.resources()` that only grows. Track any new expensive resource there.

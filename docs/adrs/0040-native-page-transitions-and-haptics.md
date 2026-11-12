# ADR 0040: Native page transitions, edge swipe back and haptics on phones

- Status: **accepted; built** (2026-11-11). Verified on the web at phone width: pushing, Back, the Messages thread over header and tabs, and the web export without the gesture library. On the iOS Simulator the push and pop and the first, JavaScript-driven swipe were seen working before the simulator stopped responding. The native swipe and haptics are to be checked on a real iPhone through TestFlight. Android not run.
- Builds on: [ADR 0038](0038-bounded-media-and-virtualized-streams.md) (playback store).

## Context

The owner asked for intuitive, native, responsive and performant transitions in the iPhone app. Screens were swapped by React state with no motion. Opening a profile, Settings, Contacts, Search or a chat also replaced the screen underneath, so Back lost its scroll position.

We checked Apple's guidance and React Native's options (2026-11-11):

- **iOS push and pop.** The new page comes in from the right while the page under it moves about a third to the left and dims. A swipe from the left edge follows the finger and completes or springs back by distance and speed. SwiftUI's default spring is 0.5 s with no bounce.
- **Tab bar.** Switching tabs doesn't animate. Each tab keeps its state.
- **Haptics.** Selection ticks for choices, light impacts for small commits, notifications for task results, and never for ordinary taps or scrolling.
- **Reduce Motion.** Cross-fade instead of slide.
- **React Native.** The native driver animates transform and opacity on the UI thread. A PanResponder gesture runs in JavaScript. Setting a natively driven value from JavaScript doesn't repaint under the New Architecture, and sending each finger position as an instant native animation left the page half a finger behind on the simulator.

## Decision

- **A page stack without a navigation library** (`src/ui/stack.tsx`):
  - On phones, the current tab is the base page. Profile, Settings, Contacts and Search are pushed on it, the Messages thread slides over the whole app (list, header and tabs alike, as Messages on iPhone does), and a person's profile goes on top.
  - Pages underneath stay mounted, so Back returns to the same scroll position. They are hidden from touch and VoiceOver while covered.
  - The motion is a critically damped spring settling in about 0.45 s, on the UI thread, with a 30% parallax, a 12% dim and a soft edge shadow. Reduce Motion cross-fades instead.
  - Desktop keeps its layout. On the web (phone width) the same stack runs, without the swipe, because browsers have their own.
- **Swipe back reads the finger on the UI thread.** It uses `react-native-gesture-handler` (bundled with Expo SDK 57) feeding React Native's own `Animated` through a native `Animated.event`, without Reanimated.
  - The swipe starts within 28 points of the left edge and only rightward.
  - It completes past half the width, counting a short glide at the release speed, or on a flick faster than 800 pt/s. Otherwise the page springs back.
  - The pages below follow the same value, so they move with the finger too.
  - The library lives only in `edgeSwipe.native.tsx`, so the web bundle doesn't include it.
- **The Messages thread draws through a slot.** The thread lives deep in Messages but has to cover the app's header and tabs. Messages writes it into a small external store, which only the slot view redraws.
- **Video pauses behind a pushed page.** Feed and Clips pause when a page covers them (`usePageActive`), as iOS does.
- **Haptics** (`src/ui/haptics.ts`, `expo-haptics`, loaded on first use, nothing on the web):
  - a selection tick for the Feed's Relevant/Raw switch, Messages filters and picking a reaction;
  - a light tap for likes, reshares, sending a message and pull-to-refresh;
  - a medium tap for the long press that opens tapbacks;
  - success or error once a post finishes publishing everywhere.
- **Android's back button** pops the top page.

## Consequences

- Two native modules join the app (`expo-haptics`, `react-native-gesture-handler`), so phones need a new build. TestFlight builds include them.
- A covered page stays mounted. That costs memory, but lists are virtualized and video pauses.
- The swipe is native, but the page stack is still React. Moving to `react-native-screens` native stack would give UIKit's own transitions, at the cost of replacing the state-based navigation.

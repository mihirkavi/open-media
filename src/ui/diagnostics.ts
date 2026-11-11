import { playbackSnapshot } from './usePlayback';

/**
 * Counts of live, expensive resources (video players, timers, subscriptions). Anything that holds
 * memory or native handles until released registers here, so a leak shows up as a number that only
 * grows. In development, `globalThis.__openMedia.resources()` returns the counts: read it from the
 * browser console, Playwright (`browser_evaluate`) or a React Native debugger after scrolling.
 */
const counts = new Map<string, number>();

/** Call when the resource is created; call the returned function (once) when it is released. */
export function trackResource(kind: string): () => void {
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts.set(kind, (counts.get(kind) ?? 1) - 1);
  };
}

export function resourceCounts(): Record<string, number> { return Object.fromEntries(counts); }

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  (globalThis as { __openMedia?: unknown }).__openMedia = { resources: resourceCounts, playback: playbackSnapshot };
}

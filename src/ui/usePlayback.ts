import { useCallback, useEffect, useSyncExternalStore } from 'react';

import * as playback from '../domain/mediaPlayback';

/**
 * The app-wide video playback store (rules in `src/domain/mediaPlayback.ts`). Components read
 * booleans for their own id, so a change re-renders only the videos it affects.
 */
let state: playback.PlaybackState = playback.idlePlayback;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(next: playback.PlaybackState) {
  if (next === state) return;
  state = next;
  listeners.forEach((notify) => notify());
}

/** Lists call this from `onViewableItemsChanged` with the ids on screen; videos that left are paused. */
export function reportVisibleMedia(ids: Iterable<string>) { update(playback.onScreen(state, new Set(ids))); }

/** Diagnostics: what the store holds now (used by `globalThis.__openMedia` in development). */
export function playbackSnapshot(): playback.PlaybackState { return state; }

export function usePlayback(id: string) {
  const playing = useSyncExternalStore(subscribe, () => state.playing === id, () => false);
  const live = useSyncExternalStore(subscribe, () => state.live.includes(id), () => false);
  // A row that unmounts (scrolled far away, or the screen closed) gives its player back.
  useEffect(() => () => update(playback.release(state, id)), [id]);
  const toggle = useCallback(() => update(state.playing === id ? playback.pause(state, id) : playback.play(state, id)), [id]);
  return { playing, live, toggle };
}

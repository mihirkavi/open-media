/**
 * One owner for every inline video player in the app (Feed videos today; any list that plays media
 * should use it). Pure state so it can be unit tested; `src/ui/usePlayback.ts` is the React side.
 *
 * Rules, which keep scrolling smooth however many videos someone watches:
 * - At most one video plays at a time. Starting one pauses the other.
 * - At most `maxLivePlayers` players exist at once. Each holds a decoder, network buffers and, on
 *   web, an HLS instance. The least recently played one is released and shows its poster again.
 * - A video that scrolls out of view is paused. Lists report what is on screen through `visible`.
 */
export const maxLivePlayers = 2;

export interface PlaybackState {
  /** The id of the one video playing now, if any. */
  readonly playing?: string;
  /** Ids whose player may exist, most recently played first. Never longer than `maxLivePlayers`. */
  readonly live: readonly string[];
}

export const idlePlayback: PlaybackState = { live: [] };

export function play(state: PlaybackState, id: string, limit = maxLivePlayers): PlaybackState {
  if (state.playing === id && state.live[0] === id) return state;
  return { playing: id, live: [id, ...state.live.filter((item) => item !== id)].slice(0, Math.max(1, limit)) };
}

export function pause(state: PlaybackState, id: string): PlaybackState {
  return state.playing === id ? { live: state.live } : state;
}

/** The video left the screen for good (its row unmounted): drop its player. */
export function release(state: PlaybackState, id: string): PlaybackState {
  if (state.playing !== id && !state.live.includes(id)) return state;
  return { playing: state.playing === id ? undefined : state.playing, live: state.live.filter((item) => item !== id) };
}

/** Pauses the playing video when it is no longer among the ids on screen. */
export function onScreen(state: PlaybackState, visible: ReadonlySet<string>): PlaybackState {
  return state.playing && !visible.has(state.playing) ? { live: state.live } : state;
}

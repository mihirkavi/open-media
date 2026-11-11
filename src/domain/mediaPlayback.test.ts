import assert from 'node:assert/strict';
import test from 'node:test';

import { idlePlayback, maxLivePlayers, onScreen, pause, play, release } from './mediaPlayback';

test('only one video plays at a time', () => {
  const state = play(play(idlePlayback, 'a'), 'b');
  assert.equal(state.playing, 'b');
  assert.deepEqual(state.live, ['b', 'a']);
});

test('players beyond the limit are released, least recently played first', () => {
  let state = idlePlayback;
  for (const id of ['a', 'b', 'c', 'd', 'e']) state = play(state, id);
  assert.equal(state.live.length, maxLivePlayers);
  assert.deepEqual(state.live, ['e', 'd']);
});

test('watching many videos never grows the number of players', () => {
  let state = idlePlayback;
  for (let index = 0; index < 500; index += 1) state = pause(play(state, `video-${index}`), `video-${index}`);
  assert.ok(state.live.length <= maxLivePlayers);
  assert.equal(state.playing, undefined);
});

test('replaying a live video keeps its player and moves it to the front', () => {
  const state = play(play(play(idlePlayback, 'a'), 'b'), 'a');
  assert.deepEqual(state.live, ['a', 'b']);
});

test('pause keeps the player so the video resumes where it stopped', () => {
  const state = pause(play(idlePlayback, 'a'), 'a');
  assert.equal(state.playing, undefined);
  assert.deepEqual(state.live, ['a']);
  assert.equal(pause(state, 'other'), state);
});

test('a video scrolled off screen is paused; one still on screen keeps playing', () => {
  const playing = play(idlePlayback, 'a');
  assert.equal(onScreen(playing, new Set(['a', 'b'])), playing);
  assert.equal(onScreen(playing, new Set(['b'])).playing, undefined);
  assert.deepEqual(onScreen(playing, new Set(['b'])).live, ['a']);
});

test('release drops the player and stops playback', () => {
  const state = release(play(play(idlePlayback, 'a'), 'b'), 'b');
  assert.equal(state.playing, undefined);
  assert.deepEqual(state.live, ['a']);
  assert.equal(release(state, 'missing'), state);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { rawLens, runLens } from './feedLenses';
import { aboveHorizon, feedHorizon, sourcesToLoad, stableOrder } from './feedMerge';
import { SocialPost } from './posts';

const now = Date.parse('2026-11-01T03:00:00Z');
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function post(id: string, source: string, minutes: number): SocialPost {
  return {
    id, author: { id, displayName: id, handle: `@${id}`, initials: 'X' }, body: '', kind: 'text', createdAt: minutesAgo(minutes), topics: [],
    provenance: { connectorId: source }, relevance: { followsAuthor: false, selectedInterestMatches: [] },
  };
}

// The live Feed on 2026-11-01: one Hive page covered ten minutes, one Farcaster page two days.
const hivePage1 = [post('h1', 'hive', 1), post('h2', 'hive', 4), post('h3', 'hive', 9)];
const hivePage2 = [post('h4', 'hive', 12), post('h5', 'hive', 20)];
const farcasterPage1 = [post('f1', 'farcaster', 3), post('f2', 'farcaster', 60 * 5), post('f3', 'farcaster', 60 * 48)];

test('Raw used to put an older Hive page above Farcaster posts the reader had already passed', () => {
  const firstScreen = runLens([...hivePage1, ...farcasterPage1], rawLens, { now }).map((item) => item.id);
  const afterMore = runLens([...hivePage1, ...farcasterPage1, ...hivePage2], rawLens, { now }).map((item) => item.id);
  // f2 (five hours old) was shown fifth; after loading more it moved down below h4 and h5.
  assert.equal(firstScreen.indexOf('f2'), 4);
  assert.ok(afterMore.indexOf('f2') > firstScreen.indexOf('f2'));
});

test('The horizon is the oldest time every source that still pages has reached', () => {
  const horizon = feedHorizon([
    { id: 'hive', oldest: Date.parse(minutesAgo(9)), hasMore: true },
    { id: 'farcaster', oldest: Date.parse(minutesAgo(60 * 48)), hasMore: true },
    { id: 'deso', oldest: Date.parse(minutesAgo(2)), hasMore: false },
    { id: 'lens', oldest: Date.parse(minutesAgo(1)), hasMore: true, failed: true },
    { id: 'open-media', hasMore: true },
  ]);
  // DeSo has no older pages, Lens failed and Open Media hasn't loaded, so only Hive and Farcaster count.
  assert.equal(horizon, Date.parse(minutesAgo(9)));
  assert.equal(feedHorizon([{ id: 'deso', oldest: 5, hasMore: false }]), 0);
});

test('With the horizon, loading more only ever adds posts below the ones already shown', () => {
  const sources = (hive: SocialPost[], hiveMore: boolean) => [
    { id: 'hive', oldest: Math.min(...hive.map((item) => Date.parse(item.createdAt))), hasMore: hiveMore },
    { id: 'farcaster', oldest: Date.parse(minutesAgo(60 * 48)), hasMore: true },
  ];
  const first = runLens(aboveHorizon([...hivePage1, ...farcasterPage1], feedHorizon(sources(hivePage1, true))), rawLens, { now }).map((item) => item.id);
  assert.deepEqual(first, ['h1', 'f1', 'h2', 'h3']);
  const loaded = [...hivePage1, ...hivePage2];
  const second = runLens(aboveHorizon([...loaded, ...farcasterPage1], feedHorizon(sources(loaded, false))), rawLens, { now }).map((item) => item.id);
  assert.deepEqual(second.slice(0, first.length), first);
  assert.deepEqual(second, ['h1', 'f1', 'h2', 'h3', 'h4', 'h5', 'f2', 'f3']);
});

test('Load more asks only the sources holding the horizon up', () => {
  const progress = [
    { id: 'hive', oldest: Date.parse(minutesAgo(9)), hasMore: true },
    { id: 'lens', oldest: Date.parse(minutesAgo(25)), hasMore: true },
    { id: 'farcaster', oldest: Date.parse(minutesAgo(60 * 48)), hasMore: true },
    { id: 'deso', oldest: Date.parse(minutesAgo(5)), hasMore: false },
  ];
  assert.deepEqual(sourcesToLoad(progress), ['hive', 'lens']);
});

test('Ranked lenses keep shown posts in place and add new ones below', () => {
  const shown = ['b', 'a', 'c'];
  const reranked = [{ id: 'd' }, { id: 'a' }, { id: 'b' }, { id: 'e' }];
  // c was removed (deleted or filtered); the rest keep their places and d, e follow.
  assert.deepEqual(stableOrder(shown, reranked).map((item) => item.id), ['b', 'a', 'd', 'e']);
  assert.deepEqual(stableOrder([], reranked), reranked);
});

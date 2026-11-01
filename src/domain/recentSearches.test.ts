import assert from 'node:assert/strict';
import test from 'node:test';

import { maxRecentSearches, recentSearchesKey, rememberSearch } from './recentSearches';

test('a search goes to the top once, tidied, and the list stays short', () => {
  let recent: string[] = [];
  for (const query of ['dinner', '  videos   about cooking ', 'Dinner', 'a', 'one', 'two', 'three', 'four']) recent = rememberSearch(recent, query);
  assert.deepEqual(recent, ['four', 'three', 'two', 'one', 'Dinner']);
  assert.equal(recent.length, maxRecentSearches);
  assert.deepEqual(rememberSearch(['dinner'], 'videos  about cooking'), ['videos about cooking', 'dinner']);
});

test('each person has their own list on a shared device', () => {
  assert.notEqual(recentSearchesKey('a'), recentSearchesKey('b'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { SocialPost } from './posts';
import { hiveTagFor, parseSearchQuery, postMatchesSearch } from './searchQuery';

const now = Date.UTC(2026, 9, 22, 12);

test('Plain-language searches are understood and shown back', () => {
  const parsed = parseSearchQuery('show me videos about Ethereum on Lens today', now);
  assert.equal(parsed.text, 'ethereum');
  assert.equal(parsed.media, 'video');
  assert.deepEqual(parsed.networks, ['lens']);
  assert.equal(parsed.sinceMs, now - 24 * 60 * 60 * 1000);
  assert.deepEqual(parsed.understood, ['Videos only', 'On Lens', 'Last 24 hours']);
});

test('Simple searches pass through unchanged', () => {
  const parsed = parseSearchQuery('dark mode');
  assert.equal(parsed.text, 'dark mode');
  assert.deepEqual(parsed.understood, []);
  assert.equal(parsed.networks, undefined);
});

const post = (overrides: Partial<SocialPost> = {}): SocialPost => ({
  id: 'p', author: { id: 'a', displayName: 'Ada', handle: '@ada', initials: 'A' }, body: 'Ethereum gas is low today', kind: 'text',
  createdAt: new Date(now - 60_000).toISOString(), topics: [], provenance: { connectorId: 'lens' }, relevance: { followsAuthor: false, selectedInterestMatches: [] },
  ...overrides,
});

test('Posts must satisfy every understood filter and keyword', () => {
  assert.ok(postMatchesSearch(post(), parseSearchQuery('ethereum on lens', now)));
  assert.equal(postMatchesSearch(post(), parseSearchQuery('ethereum on hive', now)), false);
  assert.equal(postMatchesSearch(post(), parseSearchQuery('ethereum videos', now)), false);
  assert.equal(postMatchesSearch(post({ createdAt: new Date(now - 3 * 86_400_000).toISOString() }), parseSearchQuery('ethereum today', now)), false);
  assert.ok(postMatchesSearch(post(), parseSearchQuery('#ethereum ada', now)));
});

test('Hive searches use the first usable word as a tag', () => {
  assert.equal(hiveTagFor(parseSearchQuery('Ethereum staking')), 'ethereum');
  assert.equal(hiveTagFor(parseSearchQuery('on hive today')), undefined);
});

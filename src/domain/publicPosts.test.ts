import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRelativeTime, initialsFor, isPublicPostRecord, socialPostFromPublic } from './publicPosts';

const record = {
  id: 'p1',
  body: 'Hello, open web',
  createdAt: '2026-09-27T10:00:00Z',
  author: { id: 'u1', handle: 'maya', displayName: 'Maya Chen', avatarUrl: null },
};

test('maps a public post record to the canonical post model', () => {
  const post = socialPostFromPublic(record);
  assert.equal(post.author.handle, '@maya');
  assert.equal(post.author.initials, 'MC');
  assert.equal(post.provenance.connectorId, 'open-media');
  assert.equal(post.engagement, undefined);
  assert.deepEqual(post.relevance, { followsAuthor: false, selectedInterestMatches: [] });
});

test('validates public post records', () => {
  assert.ok(isPublicPostRecord(record));
  assert.equal(isPublicPostRecord({ id: 'p1', body: 'x' }), false);
  assert.equal(isPublicPostRecord(null), false);
});

test('derives initials from display names', () => {
  assert.equal(initialsFor('tester'), 'T');
  assert.equal(initialsFor('  ada   lovelace byron '), 'AL');
  assert.equal(initialsFor(''), '?');
});

test('formats relative times in human units', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(formatRelativeTime('2026-09-27T11:59:30Z', now), 'now');
  assert.equal(formatRelativeTime('2026-09-27T11:45:00Z', now), '15m');
  assert.equal(formatRelativeTime('2026-09-27T07:00:00Z', now), '5h');
  assert.equal(formatRelativeTime('2026-09-24T12:00:00Z', now), '3d');
  assert.equal(formatRelativeTime('2026-08-15T12:00:00Z', now), 'Aug 15');
  assert.equal(formatRelativeTime('2025-08-15T12:00:00Z', now), 'Aug 15, 2025');
});

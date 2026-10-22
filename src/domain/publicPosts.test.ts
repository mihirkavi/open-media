import assert from 'node:assert/strict';
import test from 'node:test';

import { clipPosts } from './posts';
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

test('maps an attached video to a canonical video post that Clips can show', () => {
  const author = '10000000-0000-0000-0000-000000000001';
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const post = socialPostFromPublic({
    ...record,
    body: '',
    video: { path: `${author}/${id}.mp4`, posterPath: `${author}/${id}.jpg`, durationSeconds: 12.5, width: 720, height: 1280, contentType: 'video/mp4', sha256: 'b'.repeat(64) },
  }, 'http://127.0.0.1:54321');
  assert.equal(post.kind, 'video');
  assert.deepEqual(post.media?.[0], {
    kind: 'video',
    url: `http://127.0.0.1:54321/storage/v1/object/public/post-videos/${author}/${id}.mp4`,
    posterUrl: `http://127.0.0.1:54321/storage/v1/object/public/post-videos/${author}/${id}.jpg`,
    durationSeconds: 12.5,
    aspectRatio: 720 / 1280,
    altText: 'Video by Maya Chen',
    streaming: 'progressive',
    sha256: 'b'.repeat(64),
  });
  assert.deepEqual(clipPosts([post]), [post]);
  // Without a storage URL (or with an invalid record) the post is shown as text.
  assert.equal(socialPostFromPublic({ ...record, video: { path: '../x' } as never }, 'http://127.0.0.1:54321').kind, 'text');
});

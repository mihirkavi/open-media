import assert from 'node:assert/strict';
import test from 'node:test';

import { clipPosts, explainFeedPost, selectFeed, SocialPost } from './posts';

const posts: SocialPost[] = [
  { id: 'old-followed', author: { id: 'a', displayName: 'A', handle: '@a', initials: 'A' }, body: '', kind: 'text', createdAt: '2026-01-01T00:00:00Z', topics: [], provenance: { connectorId: 'open-media' }, engagement: { replies: 0, reposts: 0, likes: 0 }, relevance: { followsAuthor: true, selectedInterestMatches: ['design'] } },
  { id: 'new-video', author: { id: 'b', displayName: 'B', handle: '@b', initials: 'B' }, body: '', kind: 'video', createdAt: '2026-02-01T00:00:00Z', media: [{ kind: 'video', aspectRatio: 0.56, altText: 'Demo clip' }], topics: [], provenance: { connectorId: 'open-media' }, engagement: { replies: 0, reposts: 0, likes: 0 }, relevance: { followsAuthor: false, selectedInterestMatches: [] } },
];

test('Raw feed is reverse chronological', () => assert.deepEqual(selectFeed(posts, 'raw').map((post) => post.id), ['new-video', 'old-followed']));
test('Clips reuse canonical video posts', () => assert.equal(clipPosts(posts)[0], posts[1]));
test('Relevant explanations disclose signals and exclusions', () => {
  const explanation = explainFeedPost(posts[0], 'relevant');
  assert.ok(explanation.used.includes('You follow this author'));
  assert.ok(explanation.notUsed.includes('Private messages'));
});

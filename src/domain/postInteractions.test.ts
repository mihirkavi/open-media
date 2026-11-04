import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInteraction, engagementFromRecord, interactionLabel, interactionRoute, interactionTarget, postCommentFromRecord, webItemUrl } from './postInteractions';
import { SocialPost } from './posts';
import { socialPostFromPublic } from './publicPosts';

function post(connectorId: string, externalId: string, authorId: string, canonicalURL?: string): SocialPost {
  return {
    id: `${connectorId}:${externalId}`,
    author: { id: authorId, displayName: 'Ada', handle: '@ada', initials: 'A' },
    body: 'Hello',
    kind: 'text',
    createdAt: '2026-10-31T10:00:00Z',
    topics: [],
    provenance: { connectorId, externalId, canonicalURL },
    engagement: { replies: 1, reposts: 2, likes: 3 },
    relevance: { followsAuthor: false, selectedInterestMatches: [] },
  };
}

const castHash = `0x${'ab'.repeat(20)}`;
const farcaster = post('farcaster', castHash, 'farcaster:42', `https://farcaster.xyz/ada/${castHash.slice(0, 10)}`);
const hive = post('hive', 'ada/my-first-post', 'hive:ada', 'https://peakd.com/@ada/my-first-post');
const deso = post('deso', 'cd'.repeat(32), 'deso:BC1abc', `https://focus.xyz/post/${'cd'.repeat(32)}`);
const lens = post('lens', '1234abcd', 'lens:0xabc', 'https://hey.xyz/posts/1234abcd');
const native = post('open-media', '7f0c2c7e-7a1f-4c3a-9d7e-0c8d4b8c2a11', 'user-1');

test('each network post resolves to the identity its write API needs', () => {
  assert.deepEqual(interactionTarget(farcaster), { network: 'farcaster', fid: 42, hash: castHash });
  assert.deepEqual(interactionTarget(hive), { network: 'hive', author: 'ada', permlink: 'my-first-post' });
  assert.deepEqual(interactionTarget(deso), { network: 'deso', postHash: 'cd'.repeat(32) });
  assert.deepEqual(interactionTarget(lens), { network: 'lens', postId: '1234abcd' });
  assert.equal(interactionTarget(native), undefined);
  assert.equal(interactionTarget({ ...farcaster, author: { ...farcaster.author, id: 'farcaster:not-a-number' } }), undefined, 'a malformed author never targets the wrong cast');
  assert.equal(interactionTarget({ ...hive, provenance: { ...hive.provenance, externalId: 'ada/a/b' } }), undefined);
});

test('Open Media posts act in Open Media; signed out, likes ask to sign in but comments can be read', () => {
  assert.deepEqual(interactionRoute(native, 'like', { signedIn: true, connected: {} }), { via: 'open-media' });
  assert.deepEqual(interactionRoute(native, 'like', { signedIn: false, connected: {} }), { via: 'sign-in' });
  assert.deepEqual(interactionRoute(native, 'reshare', { signedIn: false, connected: {} }), { via: 'sign-in' });
  assert.deepEqual(interactionRoute(native, 'comment', { signedIn: false, connected: {} }), { via: 'open-media' });
});

test('network posts use the connected account, and otherwise open the post on its network', () => {
  const connected = { farcaster: '@me' };
  assert.deepEqual(interactionRoute(farcaster, 'like', { signedIn: true, connected }), { via: 'network', network: 'farcaster', target: { network: 'farcaster', fid: 42, hash: castHash }, handle: '@me' });
  assert.deepEqual(interactionRoute(hive, 'like', { signedIn: true, connected }), { via: 'open', url: 'https://peakd.com/@ada/my-first-post', name: 'Hive' });
  assert.deepEqual(interactionRoute(farcaster, 'comment', { signedIn: false, connected }), { via: 'open', url: farcaster.provenance.canonicalURL, name: 'Farcaster' }, 'signed out never posts to a network');
  assert.deepEqual(interactionRoute({ ...hive, provenance: { ...hive.provenance, canonicalURL: 'javascript:alert(1)' } }, 'like', { signedIn: true, connected }), { via: 'none' }, 'only HTTPS links are opened');
});

test('likes and reshares change the counts once, and can be taken back', () => {
  const start = { replies: 0, reposts: 4, likes: 9, liked: false, reshared: false };
  const liked = applyInteraction(start, 'like', true);
  assert.deepEqual(liked, { ...start, likes: 10, liked: true });
  assert.equal(applyInteraction(liked, 'like', true), liked, 'liking twice does nothing');
  assert.deepEqual(applyInteraction(liked, 'like', false), start);
  assert.deepEqual(applyInteraction(start, 'reshare', true), { ...start, reposts: 5, reshared: true });
  assert.equal(applyInteraction({ ...start, likes: 0, liked: true }, 'like', false).likes, 0, 'counts never go negative');
});

test('server counts are read defensively and travel with every Open Media post', () => {
  assert.deepEqual(engagementFromRecord({ replies: 2, reposts: 1, likes: 5, liked: true, reshared: false }), { replies: 2, reposts: 1, likes: 5, liked: true, reshared: false });
  assert.deepEqual(engagementFromRecord(null), { replies: 0, reposts: 0, likes: 0, liked: false, reshared: false });
  assert.deepEqual(engagementFromRecord({ likes: -3, replies: 'x' }), { replies: 0, reposts: 0, likes: 0, liked: false, reshared: false });
  const social = socialPostFromPublic({ id: 'p1', body: 'Hi', createdAt: '2026-10-31T10:00:00Z', author: { id: 'u1', handle: 'ada', displayName: 'Ada Lovelace', avatarUrl: null }, engagement: { replies: 1, reposts: 0, likes: 2, liked: true } });
  assert.deepEqual(social.engagement, { replies: 1, reposts: 0, likes: 2, liked: true, reshared: false });
});

test('comments are parsed with the author handle', () => {
  assert.deepEqual(postCommentFromRecord({ id: 'c1', postId: 'p1', body: 'Nice', createdAt: '2026-10-31T10:00:00Z', author: { id: 'u2', handle: 'bob', displayName: 'Bob Stone', avatarUrl: null, verified: true } }), {
    id: 'c1', body: 'Nice', createdAt: '2026-10-31T10:00:00Z', author: { id: 'u2', handle: '@bob', displayName: 'Bob Stone', initials: 'BS', verified: true },
  });
  assert.equal(postCommentFromRecord({ id: 'c1', body: 'Nice' }), undefined);
});

test('icons say what a tap does', () => {
  const engagement = { replies: 1, reposts: 0, likes: 1, liked: true };
  assert.equal(interactionLabel('like', engagement, { via: 'open-media' }), 'Liked, 1 like');
  assert.equal(interactionLabel('reshare', engagement, { via: 'open', url: 'https://peakd.com/@ada/x', name: 'Hive' }), '0 reshares. Opens the post on Hive');
  assert.equal(interactionLabel('comment', engagement, { via: 'network', network: 'farcaster', target: { network: 'farcaster', fid: 1, hash: castHash }, handle: '@me' }), 'Comments on Farcaster as @me, 1 comment');
});

test('web feed items are acted on in Open Media, keyed by their article link without tracking', () => {
  const item = post('rss', 'guid-1', 'rss:news.example.test', 'https://News.Example.test/story?id=7&utm_source=rss&fbclid=abc#top');
  assert.equal(webItemUrl(item), 'https://news.example.test/story?id=7');
  assert.deepEqual(interactionRoute(item, 'like', { signedIn: true, connected: {} }), { via: 'web', url: 'https://news.example.test/story?id=7' });
  assert.deepEqual(interactionRoute(item, 'like', { signedIn: false, connected: {} }), { via: 'sign-in' });
  assert.equal(interactionRoute(item, 'comment', { signedIn: false, connected: {} }).via, 'web', 'comments can be read signed out');
  assert.equal(webItemUrl(post('rss', 'guid-2', 'rss:x', 'http://insecure.example.test/a')), undefined, 'only https links');
  assert.equal(webItemUrl(post('farcaster', '0x' + 'a'.repeat(40), 'farcaster:1', 'https://warpcast.com/x')), undefined, 'only web feed items');
});

test('public events are acted on in Open Media too, keyed by their official page', () => {
  const event = { ...post('events', 'luma-1', 'event-organizer:Confluent', 'https://lu.ma/golden-gate-run'), event: { registrationUrl: 'https://www.Confluent.io/run?utm_campaign=x#join' } as SocialPost['event'] };
  assert.equal(webItemUrl(event), 'https://www.confluent.io/run');
  assert.deepEqual(interactionRoute(event, 'reshare', { signedIn: true, connected: {} }), { via: 'web', url: 'https://www.confluent.io/run' });
  assert.deepEqual(interactionRoute(event, 'like', { signedIn: false, connected: {} }), { via: 'sign-in' });
  assert.equal(interactionRoute(event, 'comment', { signedIn: false, connected: {} }).via, 'web', 'comments can be read signed out');
  assert.equal(webItemUrl({ ...event, event: { ...event.event!, registrationUrl: 'http://insecure.example.test/e' } }), undefined, 'only https pages');
});

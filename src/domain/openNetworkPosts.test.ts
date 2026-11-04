import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareCrossPost } from './crossPosting';
import {
  bech32Encode, blueskyFacets, fromHexString, mastodonServer, nostrPublicKey, socialPostFromBluesky, socialPostFromMastodon, socialPostFromNostr,
} from './openNetworkPosts';
import { interactionTarget } from './postInteractions';

const blueskyView = {
  uri: 'at://did:plc:abc123/app.bsky.feed.post/3mziq6rxmg22m', cid: 'bafyreig3v2wje6zzgegbtcc65c36wkj6x5xnec4z32bui2ie7ivcvwxmhe',
  author: { did: 'did:plc:abc123', handle: 'alex.bsky.social', displayName: 'Alex', avatar: 'https://cdn.bsky.app/a.jpg' },
  record: { text: 'Hello Bluesky', createdAt: '2026-11-04T10:00:00.000Z' },
  embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.bsky.app/full.jpg', alt: 'A cat' }] },
  likeCount: 3, repostCount: 1, quoteCount: 1, replyCount: 2,
};

test('Bluesky posts map with their link, image, counts and interaction target', () => {
  const post = socialPostFromBluesky(blueskyView)!;
  assert.equal(post.provenance.canonicalURL, 'https://bsky.app/profile/alex.bsky.social/post/3mziq6rxmg22m');
  assert.equal(post.media?.[0].url, 'https://cdn.bsky.app/full.jpg');
  assert.deepEqual(post.engagement, { replies: 2, reposts: 2, likes: 3, liked: false, reshared: false });
  assert.deepEqual(interactionTarget(post), { network: 'bluesky', uri: blueskyView.uri, cid: blueskyView.cid });
});

test('Bluesky hides replies, labelled posts and faceless accounts', () => {
  assert.equal(socialPostFromBluesky({ ...blueskyView, record: { ...blueskyView.record, reply: {} } }), undefined);
  assert.equal(socialPostFromBluesky({ ...blueskyView, labels: [{ val: 'porn' }] }), undefined);
  assert.equal(socialPostFromBluesky({ ...blueskyView, author: { ...blueskyView.author, avatar: undefined } }), undefined);
});

test('Bluesky facets use UTF-8 byte offsets', () => {
  const [link, tag] = blueskyFacets('héllo https://openmedia.site #open');
  assert.deepEqual(link.index, { byteStart: 7, byteEnd: 29 });
  assert.equal(link.features[0].uri, 'https://openmedia.site');
  assert.deepEqual(tag.index, { byteStart: 30, byteEnd: 35 });
});

const status = {
  id: '1', uri: 'https://fosstodon.org/users/sam/statuses/1', url: 'https://fosstodon.org/@sam/1', created_at: '2026-11-04T09:00:00.000Z',
  account: { id: '9', acct: 'sam@fosstodon.org', username: 'sam', display_name: 'Sam :blobcat:', avatar: 'https://cdn.masto/sam.png' },
  content: '<p>Hello <a href="https://mas.to/@kim" class="u-url mention">@<span>kim</span></a> fediverse!</p>', visibility: 'public',
  tags: [{ name: 'Open' }], favourites_count: 4, reblogs_count: 1, replies_count: 0,
};

test('Mastodon statuses map to plain text with the full handle', () => {
  const post = socialPostFromMastodon(status, 'mas.to')!;
  assert.equal(post.body, 'Hello @kim fediverse!');
  assert.equal(post.author.handle, '@sam@fosstodon.org');
  assert.equal(post.author.displayName, 'Sam');
  assert.deepEqual(post.topics, ['open']);
  assert.deepEqual(interactionTarget(post), { network: 'mastodon', uri: status.uri });
  assert.equal(socialPostFromMastodon({ ...status, spoiler_text: 'CW' }, 'mas.to'), undefined);
  assert.equal(socialPostFromMastodon({ ...status, account: { ...status.account, bot: true } }, 'mas.to'), undefined);
  assert.equal(socialPostFromMastodon({ ...status, account: { ...status.account, acct: 'sam' } }, 'mas.to')!.author.handle, '@sam@mas.to');
});

test('Mastodon server names are read the way people type them', () => {
  assert.equal(mastodonServer('https://Fosstodon.org/'), 'fosstodon.org');
  assert.equal(mastodonServer('@me@mas.to'), 'mas.to');
  assert.equal(mastodonServer('localhost'), undefined);
  assert.equal(mastodonServer('not a server'), undefined);
});

test('npub encoding and decoding match NIP-19', () => {
  const hex = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
  const npub = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';
  assert.equal(bech32Encode('npub', fromHexString(hex)), npub);
  assert.equal(nostrPublicKey(npub), hex);
  assert.equal(nostrPublicKey(`${npub.slice(0, -1)}x`), undefined);
});

test('Nostr notes need a named author and skip replies and content warnings', () => {
  const event = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1_793_000_000, kind: 1, tags: [['t', 'Nostr']], content: 'gm https://img.example/cat.jpg', sig: 'c'.repeat(128) };
  const profile = { name: 'satoshi', picture: 'https://img.example/me.png', nip05: 'sat@example.com' };
  const post = socialPostFromNostr(event, profile)!;
  assert.equal(post.body, 'gm');
  assert.equal(post.media?.[0].url, 'https://img.example/cat.jpg');
  assert.equal(post.author.handle, '@sat@example.com');
  assert.deepEqual(interactionTarget(post), { network: 'nostr', id: event.id, pubkey: event.pubkey });
  assert.equal(socialPostFromNostr(event, undefined), undefined);
  assert.equal(socialPostFromNostr({ ...event, tags: [['e', 'd'.repeat(64)]] }, profile), undefined);
  assert.equal(socialPostFromNostr({ ...event, tags: [['content-warning', '']] }, profile), undefined);
});

test('cross-posting fits Bluesky’s 300 characters and Mastodon’s 500', () => {
  assert.equal(prepareCrossPost('x'.repeat(300), 'bluesky').ok, true);
  const tooLong = prepareCrossPost('x'.repeat(301), 'bluesky');
  assert.equal(tooLong.ok, false);
  assert.equal(prepareCrossPost('👍🏽'.repeat(300), 'bluesky').ok, true);
  assert.equal(prepareCrossPost('x'.repeat(501), 'mastodon').ok, false);
  assert.equal(prepareCrossPost('x'.repeat(5000), 'nostr').ok, true);
});

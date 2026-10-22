import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collapseRepeatedPosts, DesoPostRecord, FarcasterCastMessage, farcasterProfileFromUserData, farcasterTimestamp, HivePostRecord, LensPostRecord,
  plainTextExcerpt, safeHttpsUrl, socialPostFromDeso, socialPostFromFarcaster, socialPostFromHive, socialPostFromLens, sourceName,
} from './networkPosts';
import { explainFeedPost } from './posts';

const channel = { id: 'farcaster', parentUrl: 'chain://eip155:7777777/erc721:0xabc' };
const cast = (overrides: Partial<NonNullable<FarcasterCastMessage['data']['castAddBody']>> = {}): FarcasterCastMessage => ({
  hash: '0x1234567890abcdef',
  data: { type: 'MESSAGE_TYPE_CAST_ADD', fid: 42, timestamp: 100, castAddBody: { text: 'Hello from a test cast', parentUrl: channel.parentUrl, parentCastId: null, embeds: [], ...overrides } },
});
const profile = { fid: 42, username: 'tester', displayName: 'Test Person', pfpUrl: 'https://example.com/pfp.png' };

test('Farcaster timestamps count from the 2021 Farcaster epoch', () => {
  assert.equal(farcasterTimestamp(0), '2021-01-01T00:00:00.000Z');
  assert.equal(farcasterTimestamp(86_400), '2021-01-02T00:00:00.000Z');
});

test('Farcaster user data collapses to the latest values', () => {
  const result = farcasterProfileFromUserData(42, [
    { data: { timestamp: 2, userDataBody: { type: 'USER_DATA_TYPE_USERNAME', value: 'newname' } } },
    { data: { timestamp: 1, userDataBody: { type: 'USER_DATA_TYPE_USERNAME', value: 'oldname' } } },
    { data: { timestamp: 1, userDataBody: { type: 'USER_DATA_TYPE_PFP', value: 'https://example.com/a.png' } } },
  ]);
  assert.equal(result.username, 'newname');
  assert.equal(result.pfpUrl, 'https://example.com/a.png');
});

test('Farcaster casts normalize with provenance, a link to the original, and disclosed filters', () => {
  const post = socialPostFromFarcaster(cast({ embeds: [{ url: 'https://imagedelivery.net/abc/original' }, { url: 'https://example.com/article' }] }), profile, channel)!;
  assert.equal(post.id, 'farcaster:0x1234567890abcdef');
  assert.equal(post.author.handle, '@tester');
  assert.equal(post.provenance.canonicalURL, 'https://farcaster.xyz/tester/0x12345678');
  assert.equal(post.media?.[0]?.url, 'https://imagedelivery.net/abc/original');
  assert.ok(post.body.endsWith('https://example.com/article'));
  assert.equal(post.engagement, undefined, 'Snapchain does not report counts here, so none are invented');
  const explanation = explainFeedPost(post, 'raw');
  assert.ok(explanation.used[0].includes('/farcaster channel'));
  assert.ok(explanation.filters.length > 0);
});

test('Farcaster hides replies, empty casts, and accounts without a username or photo', () => {
  assert.equal(socialPostFromFarcaster(cast({ parentCastId: { fid: 1, hash: '0x1' } }), profile, channel), undefined);
  assert.equal(socialPostFromFarcaster(cast({ text: '  ' }), profile, channel), undefined);
  assert.equal(socialPostFromFarcaster(cast(), { fid: 42, pfpUrl: profile.pfpUrl }, channel), undefined);
  assert.equal(socialPostFromFarcaster(cast(), { fid: 42, username: 'tester' }, channel), undefined);
});

const lens = (overrides: Partial<LensPostRecord> = {}): LensPostRecord => ({
  __typename: 'Post', id: '1', slug: 'abc123', timestamp: '2026-10-21T10:00:00+00:00',
  author: { address: '0xAbCdEf0000000000000000000000000000001234', score: 9500, username: { localName: 'lenstester' }, metadata: { name: 'Lens Tester', picture: 'https://example.com/l.png' } },
  stats: { comments: 2, reposts: 1, quotes: 1, reactions: 7 },
  metadata: { __typename: 'ImageMetadata', content: 'A picture', contentWarning: null, image: { item: 'https://example.com/i.png', altTag: 'A sunset' } },
  ...overrides,
});

test('Lens posts normalize with counts and alt text', () => {
  const post = socialPostFromLens(lens())!;
  assert.equal(post.provenance.canonicalURL, 'https://hey.xyz/posts/abc123');
  assert.deepEqual(post.engagement, { replies: 2, reposts: 2, likes: 7 });
  assert.equal(post.media?.[0]?.altText, 'A sunset');
  assert.equal(post.author.id, 'lens:0xabcdef0000000000000000000000000000001234');
});

test('Lens hides low-score accounts and content-warning posts', () => {
  assert.equal(socialPostFromLens(lens({ author: { ...lens().author, score: 100 } })), undefined);
  assert.equal(socialPostFromLens(lens({ metadata: { ...lens().metadata!, contentWarning: 'NSFW' } })), undefined);
});

const hive = (overrides: Partial<HivePostRecord> = {}): HivePostRecord => ({
  author: 'hivetester', permlink: 'my-first-post', url: '/hive-1/@hivetester/my-first-post', title: 'My first post',
  body: '![cover](https://example.com/c.jpg)\n\n# Hello\n\nThis is **bold** and a [link](https://example.com).\n\n<center>https://example.com/raw</center>',
  created: '2026-10-21T15:44:39', depth: 0, children: 3, reblogs: 1, stats: { gray: false, hide: false, total_votes: 12 },
  json_metadata: { tags: ['hive-1', 'travel'], image: ['https://example.com/c.jpg'] }, community_title: 'Travel',
  ...overrides,
});

test('Hive articles become a title plus a clean excerpt', () => {
  const post = socialPostFromHive(hive())!;
  assert.equal(post.title, 'My first post');
  assert.equal(post.body, 'Hello This is bold and a link.');
  assert.equal(post.createdAt, '2026-10-21T15:44:39Z');
  assert.deepEqual(post.topics, ['travel']);
  assert.equal(post.provenance.canonicalURL, 'https://peakd.com/@hivetester/my-first-post');
  assert.ok(post.eligibility?.selection.includes('Travel'));
});

test('Hive hides community-downvoted and NSFW posts', () => {
  assert.equal(socialPostFromHive(hive({ stats: { gray: true } })), undefined);
  assert.equal(socialPostFromHive(hive({ stats: { hide: true } })), undefined);
  assert.equal(socialPostFromHive(hive({ json_metadata: { tags: ['NSFW'] } })), undefined);
});

const deso = (overrides: Partial<DesoPostRecord> = {}): DesoPostRecord => ({
  PostHashHex: 'ff00', PosterPublicKeyBase58Check: 'BC1TEST', ParentStakeID: '', Body: 'Hello DeSo', ImageURLs: ['http://insecure.example/i.png'],
  TimestampNanos: 1_792_458_537_748_430_759, IsHidden: false, CommentCount: 1, LikeCount: 4, RepostCount: 2, QuoteRepostCount: 1,
  ProfileEntryResponse: { Username: 'desotester', ExtraData: { DisplayName: 'DeSo Tester' } },
  ...overrides,
});

test('DeSo posts normalize and drop non-HTTPS images', () => {
  const post = socialPostFromDeso(deso())!;
  assert.equal(post.author.displayName, 'DeSo Tester');
  assert.equal(post.media, undefined);
  assert.deepEqual(post.engagement, { replies: 1, reposts: 3, likes: 4 });
  assert.equal(new Date(post.createdAt).getUTCFullYear(), 2026);
});

test('DeSo hides hidden posts, replies, empty reposts, and accounts without a username', () => {
  assert.equal(socialPostFromDeso(deso({ IsHidden: true })), undefined);
  assert.equal(socialPostFromDeso(deso({ ParentStakeID: 'parent' })), undefined);
  assert.equal(socialPostFromDeso(deso({ Body: '', ImageURLs: [], RepostedPostEntryResponse: {} })), undefined);
  assert.equal(socialPostFromDeso(deso({ ProfileEntryResponse: null })), undefined);
});

test('Only HTTPS URLs are accepted from network data', () => {
  assert.equal(safeHttpsUrl('javascript:alert(1)'), undefined);
  assert.equal(safeHttpsUrl('http://example.com'), undefined);
  assert.equal(safeHttpsUrl('not a url'), undefined);
  assert.equal(safeHttpsUrl('https://example.com/a'), 'https://example.com/a');
});

test('Excerpts strip markup and stay within the limit', () => {
  assert.equal(plainTextExcerpt('<p>One</p><p>Two &amp; three</p>', 100), 'One Two & three');
  assert.ok(plainTextExcerpt('word '.repeat(200), 50).length <= 50);
});

test('Source names are human readable', () => {
  assert.equal(sourceName('open-media'), 'Open Media');
  assert.equal(sourceName('deso'), 'DeSo');
});

test('Excerpts drop Markdown comments and keep nested link text', () => {
  assert.equal(plainTextExcerpt('[//]: # (PLACEHOLDER)\nRead [[EN] My trip](/@a/b) today', 100), 'Read [EN] My trip today');
});

test('Identical posts by the same account collapse to the newest copy', () => {
  const first = socialPostFromFarcaster(cast(), profile, channel)!;
  const copy = { ...first, id: 'farcaster:0xother', createdAt: '2030-01-01T00:00:00Z' };
  const other = { ...first, id: 'farcaster:0xthird', body: 'Different text' };
  assert.deepEqual(collapseRepeatedPosts([first, copy, other]).map((post) => post.id), ['farcaster:0xother', 'farcaster:0xthird']);
});

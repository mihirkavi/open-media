import assert from 'node:assert/strict';
import test from 'node:test';

import { combineLinkEngagement, emptyLinkActivity, farcasterCopiesFromRecord, farcasterLinkComments, linkReplies, noCopies, reactionFids, withOwnAction } from './farcasterLinks';
import { FarcasterCastMessage } from './networkPosts';

const url = 'https://lu.ma/golden-gate-run';
const hash = (byte: string) => `0x${byte.repeat(20)}`;
const reply = (fid: number, h: string, text: string, timestamp = 100, parentUrl = url): FarcasterCastMessage => ({ hash: h, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid, timestamp, castAddBody: { text, parentUrl } } });
const openMedia = { likes: 2, reposts: 1, replies: 1, liked: true, reshared: false };

test('Farcaster likes, recasts and replies on a link add to Open Media’s, each person once', () => {
  const copies = { likes: [7], reshares: [], comments: [hash('aa')] };
  const farcaster = { likeFids: [7, 8, 9], recastFids: [10], replies: [reply(7, hash('aa'), 'copy of mine'), reply(8, hash('bb'), 'from another app')] };
  assert.deepEqual(combineLinkEngagement(openMedia, copies, farcaster, 7), { likes: 4, reposts: 2, replies: 2, liked: true, reshared: false }, 'the copied like and comment are counted once');
  assert.equal(combineLinkEngagement({ ...openMedia, liked: false }, noCopies, farcaster, 9).liked, true, 'a like from another Farcaster app shows as the viewer’s');
  assert.deepEqual(combineLinkEngagement(openMedia, noCopies, emptyLinkActivity), openMedia, 'nothing on Farcaster changes nothing');
});

test('Snapchain pages are read strictly', () => {
  assert.deepEqual(reactionFids({ messages: [{ data: { fid: 3, type: 'MESSAGE_TYPE_REACTION_ADD' } }, { data: { fid: 3, type: 'MESSAGE_TYPE_REACTION_ADD' } }, { data: { fid: -1, type: 'MESSAGE_TYPE_REACTION_ADD' } }, { data: { fid: 4, type: 'MESSAGE_TYPE_REACTION_REMOVE' } }] }), [3]);
  const page = { messages: [reply(1, hash('cc'), 'yes'), reply(2, hash('dd'), '   '), reply(3, hash('ee'), 'other link', 100, 'https://elsewhere.test/'), reply(4, 'nothex', 'bad hash')] };
  assert.deepEqual(linkReplies(page, url).map((item) => item.hash), [hash('cc')], 'only non-empty replies to this exact link');
  assert.deepEqual(farcasterCopiesFromRecord({ farcasterCopies: { likes: [5, 'x', 0], reshares: [6], comments: [hash('ab'), 'nope'] } }), { likes: [5], reshares: [6], comments: [hash('ab')] });
  assert.deepEqual(farcasterCopiesFromRecord(undefined), noCopies);
});

test('the viewer’s own Farcaster action shows before Snapchain reports it', () => {
  const after = withOwnAction({ likeFids: [1], recastFids: [], replies: [] }, 2, { kind: 'like', on: true });
  assert.deepEqual(after.likeFids, [1, 2]);
  assert.deepEqual(withOwnAction(after, 2, { kind: 'like', on: false }).likeFids, [1]);
  assert.deepEqual(withOwnAction(after, 2, { kind: 'reshare', on: true }).recastFids, [2]);
});

test('Farcaster replies become comments marked as from Farcaster, leaving out Open Media’s copies', () => {
  const profiles = new Map([[8, { fid: 8, username: 'ada', displayName: 'Ada', pfpUrl: 'https://img.test/ada.png' }]]);
  const comments = farcasterLinkComments([reply(9, hash('cd'), 'later', 200), reply(8, hash('bb'), ' first ', 100), reply(7, hash('aa'), 'copy', 50)], profiles, [hash('aa')]);
  assert.deepEqual(comments.map((comment) => [comment.author.handle, comment.body, comment.network]), [['@ada', 'first', 'farcaster'], ['fid:9', 'later', 'farcaster']]);
  assert.equal(comments[0].author.avatarUrl, 'https://img.test/ada.png');
  assert.equal(comments[0].createdAt, '2021-01-01T00:01:40.000Z');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { castWithMentions, followCountsLine, mentionCandidates, mentionedFids, quotedCast, textWithMentions } from './farcasterCasts';

const names = new Map([[3235, 'vitalik.eth'], [14124, 'safe']]);

test('mentions go back into the text at their byte offsets', () => {
  // The shape a live Snapchain node returns: the names are gaps in the text.
  const text = "On Ethereum privacy's last mile:  private balances with  sub accounts";
  const first = new TextEncoder().encode("On Ethereum privacy's last mile: ").length;
  const second = new TextEncoder().encode("On Ethereum privacy's last mile:  private balances with ").length;
  assert.equal(
    textWithMentions({ text, mentions: [3235, 14124], mentionsPositions: [first, second] }, names),
    "On Ethereum privacy's last mile: @vitalik.eth private balances with @safe sub accounts",
  );
});

test('offsets count UTF-8 bytes, so emoji and accents before a mention keep it in place', () => {
  const text = 'gm 👋 café  !';
  const at = new TextEncoder().encode('gm 👋 café ').length;
  assert.equal(textWithMentions({ text, mentions: [3235], mentionsPositions: [at] }, names), 'gm 👋 café @vitalik.eth !');
});

test('mentions out of order, at the start, and without a known name', () => {
  assert.equal(textWithMentions({ text: ' and  met', mentions: [14124, 999], mentionsPositions: [5, 0] }, names), '@fid:999 and @safe met');
});

test('a malformed mention list leaves the text as it is', () => {
  assert.equal(textWithMentions({ text: 'hello', mentions: [1, 2], mentionsPositions: [0] }, names), 'hello');
  assert.equal(textWithMentions({ text: 'hello', mentions: [1], mentionsPositions: [99] }, names), 'hello');
});

test('a quote cast names the cast it quotes', () => {
  assert.deepEqual(quotedCast({ embeds: [{ url: 'https://a.example' }, { castId: { fid: 13165, hash: '0xE7B90AA12082F288B368A76BD93B0698386BB7A8' } }] }), { fid: 13165, hash: '0xe7b90aa12082f288b368a76bd93b0698386bb7a8' });
  assert.equal(quotedCast({ embeds: [{ castId: { fid: 1, hash: 'nope' } }] }), undefined);
});

test('mentioned accounts are listed once', () => {
  assert.deepEqual(mentionedFids([{ mentions: [1, 2] }, undefined, { mentions: [2, 3, -1] }]), [1, 2, 3]);
});

test('@names become Farcaster mentions at byte offsets, and read back the same', () => {
  const fids = new Map([['alice', 11], ['vitalik.eth', 5650]]);
  assert.deepEqual(mentionCandidates('Hi @Alice and @vitalik.eth, mail me@example.com @alice'), ['alice', 'vitalik.eth']);
  const cast = castWithMentions('Hi @Alice and @vitalik.eth 👋 see @unknown', fids);
  assert.equal(cast.text, 'Hi  and  👋 see @unknown');
  assert.deepEqual(cast.mentions.map((item) => item.fid), [11, 5650]);
  // Round trip: what other apps show is what was written (in the account's own spelling).
  const shown = textWithMentions({ text: cast.text, mentions: cast.mentions.map((item) => item.fid), mentionsPositions: cast.mentions.map((item) => item.at) }, new Map([[11, 'alice'], [5650, 'vitalik.eth']]));
  assert.equal(shown, 'Hi @alice and @vitalik.eth 👋 see @unknown');
});

test('email addresses and words are never mentions, and only ten names are taken', () => {
  assert.deepEqual(mentionCandidates('write to ana@site.com or x@y'), []);
  const names = Array.from({ length: 12 }, (_, index) => `p${index}`);
  const cast = castWithMentions(names.map((name) => `@${name}`).join(' '), new Map(names.map((name, index) => [name, index + 1])));
  assert.equal(cast.mentions.length, 10);
  assert.match(cast.text, /@p10 @p11$/);
});

test('follow counts read naturally, with a cap shown as “+”', () => {
  assert.equal(followCountsLine({ followers: 1, following: 79, moreFollowers: false, moreFollowing: false }), '1 follower · 79 following');
  assert.equal(followCountsLine({ followers: 5000, following: 12, moreFollowers: true, moreFollowing: false }), '5,000+ followers · 12 following');
});

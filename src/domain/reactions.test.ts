import assert from 'node:assert/strict';
import test from 'node:test';

import { MessageReaction } from './models';
import { applyMyReaction, describeReaction, isReactionEmoji, myReaction, summarizeReactions, tapbacks } from './reactions';

const reaction = (emoji: string, personId: string, at: string, mine = false): MessageReaction => ({ emoji, personId, at, mine });

test('groups reactions by emoji in the order they first appeared', () => {
  const summary = summarizeReactions([
    reaction('😂', 'ben', '2026-11-04T10:02:00Z'),
    reaction('❤️', 'cat', '2026-11-04T10:00:00Z'),
    reaction('😂', 'me', '2026-11-04T10:03:00Z', true),
    reaction('😂', 'dan', '2026-11-04T10:04:00Z'),
  ]);
  assert.deepEqual(summary.map((item) => [item.emoji, item.count, item.mine]), [['❤️', 1, false], ['😂', 3, true]]);
  assert.deepEqual(summary[1].personIds, ['ben', 'dan', 'me']);
});

test('picking an emoji replaces your reaction, picking it again takes it off', () => {
  const start = [reaction('👍', 'ben', '2026-11-04T10:00:00Z')];
  const loved = applyMyReaction(start, 'me', '❤️', '2026-11-04T10:01:00Z');
  assert.equal(myReaction(loved), '❤️');
  assert.equal(loved.length, 2);
  const laughed = applyMyReaction(loved, 'me', '😂');
  assert.equal(myReaction(laughed), '😂');
  assert.equal(laughed.length, 2);
  assert.deepEqual(applyMyReaction(laughed, 'me', '😂'), start);
  assert.deepEqual(applyMyReaction(laughed, 'me', undefined), start);
});

test('describes reactions in words', () => {
  const names: Record<string, string> = { ben: 'Ben', cat: 'Cat' };
  const nameOf = (id: string) => names[id] ?? 'Someone';
  assert.equal(describeReaction(summarizeReactions([reaction('❤️', 'ben', 'x')])[0], nameOf), 'Ben loved this');
  assert.equal(describeReaction(summarizeReactions([reaction('👍', 'ben', 'x'), reaction('👍', 'me', 'y', true)])[0], nameOf), 'You and Ben liked this');
  assert.equal(describeReaction(summarizeReactions([reaction('🔥', 'ben', 'x'), reaction('🔥', 'cat', 'y'), reaction('🔥', 'me', 'z', true)])[0], nameOf), '3 people reacted with 🔥');
});

test('accepts emoji only', () => {
  for (const emoji of tapbacks) assert.ok(isReactionEmoji(emoji), emoji);
  assert.ok(isReactionEmoji('👍🏽'));
  assert.ok(isReactionEmoji('👩‍💻'));
  assert.ok(!isReactionEmoji('ok'));
  assert.ok(!isReactionEmoji('https://x'));
  assert.ok(!isReactionEmoji(''));
  assert.ok(!isReactionEmoji('1'));
});

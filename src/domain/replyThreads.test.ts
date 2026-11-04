import assert from 'node:assert/strict';
import test from 'node:test';

import { Message } from './models';
import { replyCountLabel, replyCounts, replyThread } from './replyThreads';

const message = (id: string, minute: number, replyTo?: string): Message => ({
  id, sourceMessageId: id, conversationId: 'c', senderPersonId: 'p', senderIdentityId: 'i', recipientPersonIds: [],
  sentAt: `2026-11-04T10:${String(minute).padStart(2, '0')}:00Z`, body: id, source: 'open_media', channel: 'native',
  direction: 'inbound', deliveryState: 'received', ...(replyTo ? { replyToMessageId: replyTo } : {}),
});

const messages = [
  message('a', 0),
  message('b', 1),
  message('c', 2, 'a'),
  message('d', 3),
  message('e', 4, 'c'),
  message('f', 5, 'a'),
  message('g', 6, 'missing'),
];

test('a thread is the original and every reply that leads back to it, oldest first', () => {
  assert.deepEqual(replyThread(messages, 'e').map((item) => item.id), ['a', 'c', 'e', 'f']);
  assert.deepEqual(replyThread(messages, 'a').map((item) => item.id), ['a', 'c', 'e', 'f']);
});

test('a message nobody replied to has no thread', () => {
  assert.deepEqual(replyThread(messages, 'b'), []);
  assert.deepEqual(replyThread(messages, 'g'), []);
  assert.deepEqual(replyThread(messages, 'nope'), []);
});

test('counts replies under each original', () => {
  assert.deepEqual([...replyCounts(messages)], [['a', 3]]);
  assert.equal(replyCountLabel(1), '1 Reply');
  assert.equal(replyCountLabel(3), '3 Replies');
});

test('a loop of replies does not hang', () => {
  const loop = [message('x', 0, 'y'), message('y', 1, 'x')];
  assert.ok(Array.isArray(replyThread(loop, 'x')));
  assert.ok(replyCounts(loop).size <= 2);
});

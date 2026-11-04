import assert from 'node:assert/strict';
import test from 'node:test';

import { Message } from './models';
import { applyReceipts, markUnreadTarget, receiptLabel, receiptOf, unreadCount } from './receipts';
import { Conversation } from './models';

const message = (id: string, direction: Message['direction'], sentAt: string, deliveryState: Message['deliveryState'] = direction === 'outbound' ? 'sent' : 'received'): Message => ({
  id, sourceMessageId: id, conversationId: 'c', senderPersonId: direction === 'outbound' ? 'me' : 'them', senderIdentityId: 'x',
  recipientPersonIds: [], sentAt, body: id, source: 'open_media', channel: 'native', direction, deliveryState,
});

test('a sent message moves to delivered, then read, as the other person fetches and opens it', () => {
  const messages = [message('a', 'outbound', '2026-11-03T10:00:00Z'), message('b', 'outbound', '2026-11-03T10:05:00Z')];
  assert.deepEqual(applyReceipts(messages, [{}]).map(receiptOf), ['sent', 'sent']);
  const delivered = applyReceipts(messages, [{ deliveredAt: '2026-11-03T10:02:00Z' }]);
  assert.deepEqual(delivered.map(receiptOf), ['delivered', 'sent'], 'only what was sent before they fetched is delivered');
  const read = applyReceipts(messages, [{ deliveredAt: '2026-11-03T10:06:00Z', readAt: '2026-11-03T10:06:00Z' }]);
  assert.deepEqual(read.map(receiptOf), ['read', 'read']);
  assert.equal(read[1].readAt, '2026-11-03T10:06:00.000Z');
});

test('in a group, delivered and read wait for everyone; hidden read receipts stop at delivered', () => {
  const messages = [message('a', 'outbound', '2026-11-03T10:00:00Z')];
  assert.equal(receiptOf(applyReceipts(messages, [{ deliveredAt: '2026-11-03T10:01:00Z', readAt: '2026-11-03T10:01:00Z' }, { deliveredAt: '2026-11-03T10:01:00Z' }])[0]), 'delivered');
  assert.equal(receiptOf(applyReceipts(messages, [{ readAt: '2026-11-03T10:01:00Z', deliveredAt: '2026-11-03T10:01:00Z' }, {}])[0]), 'sent');
});

test('sending, failed and received messages are left alone', () => {
  assert.equal(receiptOf(message('p', 'outbound', '2026-11-03T10:00:00Z', 'pending')), 'sending');
  assert.equal(receiptOf(message('f', 'outbound', '2026-11-03T10:00:00Z', 'failed')), 'failed');
  assert.equal(receiptOf(message('i', 'inbound', '2026-11-03T10:00:00Z')), undefined);
  assert.equal(receiptLabel('read', { readAt: '2026-11-03T10:06:00Z' }, () => '10:06 AM'), 'Read 10:06 AM');
});

test('unread counts what came in after the last read, or after your last reply before you ever opened it', () => {
  const messages = [message('a', 'inbound', '2026-11-03T09:00:00Z'), message('b', 'outbound', '2026-11-03T09:30:00Z'), message('c', 'inbound', '2026-11-03T10:00:00Z'), message('d', 'inbound', '2026-11-03T10:10:00Z')];
  assert.equal(unreadCount(messages, '2026-11-03T10:05:00Z'), 1);
  assert.equal(unreadCount(messages), 2, 'never opened: what came after your reply');
  assert.equal(unreadCount([message('a', 'inbound', '2026-11-03T09:00:00Z')]), 1);
});

test('marking unread lands on the channel of the newest message from someone else', () => {
  const channel = (id: string, messages: Message[]): Conversation => ({ id, participants: [], messages, sourceSummary: ['open_media'], lastMessageAt: '', preview: '', unreadCount: 0, labels: [] });
  const chat = channel('chat', [message('c1', 'inbound', '2026-11-03T09:00:00Z'), message('c2', 'outbound', '2026-11-03T12:00:00Z')]);
  const mail = channel('mail', [message('m1', 'inbound', '2026-11-03T10:00:00Z')]);
  const merged = { ...channel('merged', []), channels: [chat, mail] };
  const target = markUnreadTarget(merged);
  assert.equal(target?.channel.id, 'mail', 'your own newer reply does not count');
  assert.equal(target?.message.id, 'm1');
  // With nothing from them, the newest message of all.
  const mine = channel('mine', [message('o1', 'outbound', '2026-11-03T08:00:00Z'), message('o2', 'outbound', '2026-11-03T09:00:00Z')]);
  assert.equal(markUnreadTarget(mine)?.message.id, 'o2');
  assert.equal(markUnreadTarget(channel('empty', [])), undefined);
});

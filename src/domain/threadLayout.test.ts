import assert from 'node:assert/strict';
import test from 'node:test';

import { Message } from './models';
import { formatListTime, formatThreadTime, layoutThread, stripReplyPrefix } from './threadLayout';

const message = (id: string, sentAt: string, overrides: Partial<Message> = {}): Message => ({
  id, sourceMessageId: id, conversationId: 'c', senderPersonId: 'p', senderIdentityId: 'i', recipientPersonIds: ['me'],
  sentAt, body: id, source: 'imap', channel: 'email', direction: 'inbound', deliveryState: 'received', ...overrides,
});

test('shows a subject only when it changes, ignoring Re:/Fwd:', () => {
  const items = layoutThread([
    message('a', '2026-10-01T10:00:00Z', { emailContext: { providerThreadId: 'a', subject: 'Lunch on Thursday?' } }),
    message('b', '2026-10-01T10:02:00Z', { direction: 'outbound', senderPersonId: 'me', emailContext: { providerThreadId: 'b', subject: 'Re: Lunch on Thursday?' } }),
    message('c', '2026-10-01T10:03:00Z', { emailContext: { providerThreadId: 'c', subject: 'RE: Fwd: Weekend plans' } }),
  ]).filter((item) => item.kind === 'message');
  assert.deepEqual(items.map((item) => item.kind === 'message' && item.subject), ['Lunch on Thursday?', undefined, 'Weekend plans']);
});

test('adds time separators after an hour and groups nearby messages from the same side', () => {
  const items = layoutThread([
    message('a', '2026-10-01T10:00:00Z'),
    message('b', '2026-10-01T10:01:00Z'),
    message('c', '2026-10-01T10:02:00Z', { direction: 'outbound', senderPersonId: 'me' }),
    message('d', '2026-10-01T12:00:00Z'),
  ]);
  assert.deepEqual(items.map((item) => item.kind === 'time' ? 'time' : `${item.key}:${item.groupStart ? 'S' : ''}${item.groupEnd ? 'E' : ''}`), ['time', 'a:S', 'b:E', 'c:SE', 'time', 'd:SE']);
});

test('strips reply prefixes', () => {
  assert.equal(stripReplyPrefix('Re: RE: Fwd: Plans'), 'Plans');
  assert.equal(stripReplyPrefix('Re:'), 'Re:');
});

test('formats thread and list times relative to today', () => {
  const now = new Date(2026, 9, 16, 15, 0);
  assert.match(formatThreadTime(new Date(2026, 9, 16, 9, 2), now), /^Today 9:02\sAM$/);
  assert.match(formatThreadTime(new Date(2026, 9, 15, 21, 2), now), /^Yesterday 9:02\sPM$/);
  assert.match(formatThreadTime(new Date(2026, 9, 12, 8, 0), now), /^Monday 8:00\sAM$/);
  assert.match(formatThreadTime(new Date(2026, 8, 1, 8, 0), now), /^Sep 1 at 8:00\sAM$/);
  assert.equal(formatListTime(new Date(2026, 9, 15, 21, 0), now), 'Yesterday');
  assert.equal(formatListTime(new Date(2025, 0, 2), now), '1/2/25');
});

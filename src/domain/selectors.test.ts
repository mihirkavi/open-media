import assert from 'node:assert/strict';
import test from 'node:test';

import { mockConversations } from '../data/mockData';
import { filterConversations } from './selectors';

test('filters conversations by account and unread state', () => {
  const results = filterConversations(mockConversations, {
    accountId: 'account-icloud',
    query: '',
    unreadOnly: true,
  });

  assert.ok(results.length > 0);
  assert.ok(results.every((conversation) => conversation.accountId === 'account-icloud'));
  assert.ok(results.every((conversation) => conversation.unreadCount > 0));
});

test('searches subject, participants, address, and preview', () => {
  const results = filterConversations(mockConversations, {
    accountId: 'all',
    query: 'Saturday',
    unreadOnly: false,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].subject, 'Saturday trail plan');
});

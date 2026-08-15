import assert from 'node:assert/strict';
import test from 'node:test';

import { mockConversations, mockPeople } from '../data/mockData';
import { canMergeIdentity, suggestIdentityMatch } from './identityResolution';
import { filterConversations } from './selectors';

test('filters people-first conversations without splitting them by source', () => {
  const results = filterConversations(mockConversations, {
    peopleFilter: 'direct',
    query: 'Maya',
    unreadOnly: false,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'maya-direct');
  assert.deepEqual(results[0].sourceSummary, ['gmail', 'instagram', 'icloud']);
  assert.equal(results[0].participants[0].identities.length, 3);
});

test('keeps group conversations distinct from direct conversations', () => {
  const groups = filterConversations(mockConversations, {
    peopleFilter: 'groups',
    query: '',
    unreadOnly: false,
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupTitle, 'Weekend trail crew');
  assert.deepEqual(groups[0].participants.map((person) => person.id), ['maya', 'jon']);
});

test('searches identity values and email subjects inside unified timelines', () => {
  const byHandle = filterConversations(mockConversations, { peopleFilter: 'all', query: '@mayawanders', unreadOnly: false });
  const byTopic = filterConversations(mockConversations, { peopleFilter: 'all', query: 'Open Media interface notes', unreadOnly: false });

  assert.equal(byHandle[0].id, 'maya-direct');
  assert.equal(byTopic[0].id, 'maya-direct');
});

test('orders the merged person timeline chronologically', () => {
  const mayaConversation = mockConversations.find((conversation) => conversation.id === 'maya-direct');
  assert.ok(mayaConversation);

  const timestamps = mayaConversation.messages.map((message) => Date.parse(message.sentAt));
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => a - b));
  assert.equal(new Set(mayaConversation.messages.map((message) => message.source)).size, 3);
});

test('identity matching remains confidence-based and review-gated', () => {
  const candidate = { ...mockPeople.maya.identities[0], id: 'candidate-email', verifiedByUser: false };
  const suggestion = suggestIdentityMatch(candidate, 'maya', ['shared-verified-email', 'matching-name']);

  assert.equal(suggestion.confidence, 0.8);
  assert.equal(suggestion.status, 'review-required');
  assert.equal(canMergeIdentity(suggestion), false);
  assert.equal(canMergeIdentity({ ...suggestion, status: 'accepted' }), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { mockConversations, mockPeople } from '../data/mockData';
import { canMergeIdentity, suggestIdentityMatch } from './identityResolution';
import { aiConversationId } from './aiChat';
import { filterConversations, isBusinessNumber, openMediaNoticesId } from './selectors';

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

test('People leaves out company mail', () => {
  const person = mockConversations.find((conversation) => conversation.id === 'maya-direct')!;
  const company = { ...person, id: 'vivino', company: 'vivino.com' };
  const people = filterConversations([person, company], { peopleFilter: 'direct', query: '', unreadOnly: false });
  assert.deepEqual(people.map((conversation) => conversation.id), ['maya-direct']);
  const all = filterConversations([person, company], { peopleFilter: 'all', query: '', unreadOnly: false });
  assert.equal(all.length, 2, 'All still shows it');
});

test('People shows individuals only; Companies shows company mail and business texts', () => {
  const [person] = mockConversations.filter((conversation) => conversation.participants.length === 1);
  const as = (id: string, change: Partial<typeof person>, phone?: string) => ({
    ...person, id, ...change,
    participants: [{ ...person.participants[0], id, identities: phone ? [{ id: `${id}-phone`, personId: id, kind: 'phone' as const, value: phone, source: 'sms' as const, label: 'Mobile', verifiedByUser: false }] : person.participants[0].identities }],
  });
  const list = [
    as('friend', {}, '+91 98765 43210'),
    as('newsletter', { company: 'example.com' }),
    as('bank-short-code', {}, '57575'),
    as('bank-sender-id', {}, 'AX-HDFCBK'),
  ];
  const ids = (peopleFilter: 'direct' | 'companies') => filterConversations(list, { peopleFilter, query: '', unreadOnly: false }).map((item) => item.id);
  assert.deepEqual(ids('direct'), ['friend']);
  assert.deepEqual(ids('companies'), ['newsletter', 'bank-short-code', 'bank-sender-id']);
});

test('business numbers: short codes and named senders, never a full phone number', () => {
  assert.equal(isBusinessNumber('57575'), true);
  assert.equal(isBusinessNumber('VM-AMAZON'), true);
  assert.equal(isBusinessNumber('+1 555 010 0142'), false);
  assert.equal(isBusinessNumber('+91 98765 43210'), false);
  assert.equal(isBusinessNumber(''), false);
});

test('Open Media AI is not a person, and Open Media’s notices account is a company', () => {
  const [person] = mockConversations.filter((conversation) => conversation.participants.length === 1);
  const ai = { ...person, id: aiConversationId };
  const notices = { ...person, id: 'notices', participants: [{ ...person.participants[0], id: openMediaNoticesId }] };
  const ids = (peopleFilter: 'direct' | 'companies') => filterConversations([ai, notices], { peopleFilter, query: '', unreadOnly: false }).map((item) => item.id);
  assert.deepEqual(ids('direct'), []);
  assert.deepEqual(ids('companies'), ['notices']);
});

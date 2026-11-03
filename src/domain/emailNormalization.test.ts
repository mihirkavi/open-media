import assert from 'node:assert/strict';
import test from 'node:test';

import { StoredMailMessage } from '../connectors/mailApiConnector';
import { correspondentKey, emailConversationId, normalizeStoredEmail, subjectFromBody, unreadMailIn } from './emailNormalization';
import { receiptOf } from './receipts';

const base = { accountId: 'acct-1', accountEmail: 'me@gmail.com', mailbox: 'INBOX', to: ['me@gmail.com'] };
const mail = (overrides: Partial<StoredMailMessage>): StoredMailMessage => ({ ...base, sourceMessageId: 'id', subject: 'Plans', from: 'Ana <ana@example.com>', sentAt: '2026-10-01T10:00:00Z', text: 'hi', ...overrides });

test('groups inbound and sent email into one conversation per person', () => {
  const [conversation, ...rest] = normalizeStoredEmail([
    mail({ sourceMessageId: '<a@x>', sentAt: '2026-10-01T10:00:00Z', text: 'Dinner Friday?' }),
    mail({ sourceMessageId: '<b@x>', mailbox: 'Sent', from: 'me@gmail.com', to: ['ana@example.com'], sentAt: '2026-10-01T11:00:00Z', text: 'Yes!' }),
  ]);
  assert.equal(rest.length, 0);
  assert.equal(conversation.participants[0].name, 'Ana');
  assert.deepEqual(conversation.messages.map((message) => message.direction), ['inbound', 'outbound']);
  assert.equal(conversation.sourceSummary[0], 'gmail');
  assert.deepEqual(conversation.email, { accountId: 'acct-1', accountEmail: 'me@gmail.com', address: 'ana@example.com', latestSubject: 'Plans', latestMessageId: '<a@x>' }, 'replies thread to their latest message');
});

test('keeps different people and mailboxes apart and drops duplicates', () => {
  const conversations = normalizeStoredEmail([
    mail({ sourceMessageId: '<a@x>' }),
    mail({ sourceMessageId: '<a@x>' }),
    mail({ sourceMessageId: '<c@x>', from: 'bo@example.com' }),
    mail({ sourceMessageId: '<d@x>', accountId: 'acct-2', accountEmail: 'work@company.com', to: ['work@company.com'] }),
  ]);
  assert.equal(conversations.length, 2, 'the same person across two mailboxes is one chat');
  assert.ok(conversations.every((conversation) => new Set(conversation.messages.map((message) => message.sourceMessageId)).size === conversation.messages.length));
});

test('cleans quoted display names', () => {
  const [conversation] = normalizeStoredEmail([mail({ from: '"Priya Shah" <priya@example.com>' })]);
  assert.equal(conversation.participants[0].name, 'Priya Shah');
});

test('company mail joins one chat; people at a company stay separate', () => {
  assert.equal(correspondentKey('news@vivino.com').key, 'company:vivino.com');
  assert.equal(correspondentKey('orders@shop.vivino.com').key, 'company:vivino.com');
  assert.equal(correspondentKey('hello@news.vivino.com').key, 'company:vivino.com');
  assert.equal(correspondentKey('alice@acme.com').key, 'address:alice@acme.com');
  assert.equal(correspondentKey('alice@acme.com', true).key, 'company:acme.com');
  assert.equal(correspondentKey('friend@gmail.com').key, 'address:friend@gmail.com');
  const conversations = normalizeStoredEmail([
    mail({ sourceMessageId: '<v1@x>', from: 'Vivino <news@vivino.com>' }),
    mail({ sourceMessageId: '<v2@x>', from: 'Vivino Orders <orders@vivino.com>', sentAt: '2026-10-02T10:00:00Z' }),
  ]);
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].messages.length, 2);
  assert.equal(conversations[0].email?.address, 'orders@vivino.com', 'replies go to the latest sender');
  assert.equal(conversations[0].messages[0].emailContext?.address, 'news@vivino.com', 'each message keeps its own sender for replies');
});

test('links an email reply to the message it quotes', () => {
  const [conversation] = normalizeStoredEmail([
    mail({ sourceMessageId: '<q@x>', text: 'Lunch?' }),
    mail({ sourceMessageId: '<r@x>', mailbox: 'Sent', from: 'me@gmail.com', to: ['ana@example.com'], sentAt: '2026-10-01T11:00:00Z', text: 'Yes', inReplyTo: '<q@x>' }),
  ]);
  assert.equal(conversation.messages[1].replyToMessageId, conversation.messages[0].id);
  assert.equal(conversation.messages[0].replyToMessageId, undefined);
});

test('a sender stored without a name shows the company, not the address', () => {
  const [bare] = normalizeStoredEmail([mail({ from: 'Coursera@m.learn.coursera.org' })]);
  assert.equal(bare.participants[0].name, 'Coursera');
  const [named] = normalizeStoredEmail([
    mail({ sourceMessageId: '<old@x>', from: '"Bank of America" <onlinebanking@ealerts.bankofamerica.com>', sentAt: '2026-10-01T09:00:00Z' }),
    mail({ sourceMessageId: '<new@x>', from: 'onlinebanking@ealerts.bankofamerica.com', sentAt: '2026-10-01T10:00:00Z' }),
  ]);
  assert.equal(named.participants[0].name, 'Bank of America', 'an older message’s name is used when the newest has none');
});

test('an email with several people is a group with everyone in it', () => {
  const conversations = normalizeStoredEmail([
    mail({ sourceMessageId: '<g1@x>', from: '"Ana Lima" <ana@example.com>', to: ['me@gmail.com', '"Bo Chen" <bo@example.org>'], sentAt: '2026-10-01T10:00:00Z', text: 'Trip plans?' }),
    mail({ sourceMessageId: '<g2@x>', mailbox: 'Sent', from: 'me@gmail.com', to: ['ana@example.com', 'bo@example.org'], sentAt: '2026-10-01T11:00:00Z', text: 'I am in' }),
    mail({ sourceMessageId: '<g3@x>', from: 'Bo Chen <bo@example.org>', to: ['ana@example.com'], sentAt: '2026-10-01T12:00:00Z', text: 'Me too' }),
    mail({ sourceMessageId: '<d1@x>', from: 'Ana Lima <ana@example.com>', sentAt: '2026-10-01T09:00:00Z', text: 'Just us' }),
  ]);
  const group = conversations.find((conversation) => conversation.messages.some((message) => message.sourceMessageId === '<g1@x>'))!;
  assert.equal(group.groupTitle, 'Ana and Bo');
  assert.deepEqual(group.participants.map((person) => person.name), ['Ana Lima', 'Bo Chen']);
  assert.deepEqual(group.email?.recipients, ['ana@example.com', 'bo@example.org']);
  assert.deepEqual(group.messages.map((message) => message.sourceMessageId), ['<g1@x>', '<g2@x>', '<g3@x>'], 'Bo and Ana on a thread with me are the same group');
  assert.equal(group.preview, 'Bo: Me too', 'the preview says who wrote last');
  assert.equal(group.messages[2].senderPersonId, group.participants[1].id);
  const direct = conversations.find((conversation) => conversation.messages.some((message) => message.sourceMessageId === '<d1@x>'))!;
  assert.equal(direct.participants.length, 1);
  assert.equal(direct.participants[0].id, group.participants[0].id, 'Ana is one person in her chat and in the group');
});

test('your own aliases are never counted as another person', () => {
  const [conversation, ...rest] = normalizeStoredEmail([
    mail({ sourceMessageId: '<s@x>', mailbox: 'Sent', from: 'alias@mydomain.example', to: ['ana@example.com'], text: 'Hi' }),
    mail({ sourceMessageId: '<r@x>', from: 'Ana <ana@example.com>', to: ['me@gmail.com', 'alias@mydomain.example'], text: 'Hello both of you' }),
  ]);
  assert.equal(rest.length, 0);
  assert.equal(conversation.participants.length, 1);
});

test('a new email opens the conversation its recipients will be in', () => {
  const [conversation] = normalizeStoredEmail([mail({ from: 'Ana <ana@example.com>', to: ['me@gmail.com', 'bo@example.org'] })]);
  assert.equal(emailConversationId(['bo@example.org', 'Ana@Example.com']), conversation.id);
  const [direct] = normalizeStoredEmail([mail({})]);
  assert.equal(emailConversationId(['ana@example.com']), direct.id);
});

test('a new email takes its subject from the first line', () => {
  assert.equal(subjectFromBody('Dinner Friday?\nThe new place on Valencia'), 'Dinner Friday?');
  assert.equal(subjectFromBody('Here is a long first line that keeps going well past what fits in a subject line'), 'Here is a long first line that keeps going well past what…');
});

test('unread email counts come from the mail server\'s read state, and sent email only ever says Sent (ADR 0026)', () => {
  const stored = [
    mail({ sourceMessageId: '<a@x>', sentAt: '2026-10-01T10:00:00Z', unread: false }),
    mail({ sourceMessageId: '<b@x>', mailbox: 'Sent', from: 'me@gmail.com', to: ['ana@example.com'], sentAt: '2026-10-01T11:00:00Z' }),
    mail({ sourceMessageId: '<c@x>', sentAt: '2026-10-01T12:00:00Z', unread: true }),
    mail({ sourceMessageId: '<d@x>', accountId: 'acct-2', accountEmail: 'me@work.example', to: ['me@work.example'], sentAt: '2026-10-01T13:00:00Z', unread: true }),
  ];
  const [conversation] = normalizeStoredEmail(stored);
  assert.equal(conversation.unreadCount, 2);
  assert.equal(receiptOf(conversation.messages.find((message) => message.direction === 'outbound')!), 'sent');
  // Opening it marks exactly the unread mail read, per mailbox.
  assert.deepEqual([...unreadMailIn(conversation, stored)], [['acct-1', ['<c@x>']], ['acct-2', ['<d@x>']]]);
  assert.equal(normalizeStoredEmail(stored.map((item) => ({ ...item, unread: false })))[0].unreadCount, 0);
});

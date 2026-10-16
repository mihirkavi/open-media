import assert from 'node:assert/strict';
import test from 'node:test';

import { StoredMailMessage } from '../connectors/mailApiConnector';
import { correspondentKey, normalizeStoredEmail } from './emailNormalization';

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

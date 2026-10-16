import assert from 'node:assert/strict';
import test from 'node:test';

import { StoredMailMessage } from '../connectors/mailApiConnector';
import { normalizeStoredEmail } from './emailNormalization';

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
  assert.deepEqual(conversation.email, { accountId: 'acct-1', accountEmail: 'me@gmail.com', address: 'ana@example.com', latestSubject: 'Plans', latestMessageId: '<b@x>' });
});

test('keeps different people and mailboxes apart and drops duplicates', () => {
  const conversations = normalizeStoredEmail([
    mail({ sourceMessageId: '<a@x>' }),
    mail({ sourceMessageId: '<a@x>' }),
    mail({ sourceMessageId: '<c@x>', from: 'bo@example.com' }),
    mail({ sourceMessageId: '<d@x>', accountId: 'acct-2', accountEmail: 'work@company.com', to: ['work@company.com'] }),
  ]);
  assert.equal(conversations.length, 3);
  assert.ok(conversations.every((conversation) => new Set(conversation.messages.map((message) => message.sourceMessageId)).size === conversation.messages.length));
});

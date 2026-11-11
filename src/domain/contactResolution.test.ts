import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { StoredMailMessage } from '../connectors/mailApiConnector';
import { mapBridgeSnapshot } from './bridgedChats';
import { contactQueryFor, mergeByContact } from './contactMerge';
import { normalizeStoredEmail } from './emailNormalization';
import { Conversation } from './models';
import { ContactCard, discoveryRequest, linkDiscoveredAccounts, resolveContact, savedName } from './people';

/**
 * ADR 0037: one answer to "which of my contacts is this?". Whatever the app shows under a
 * contact's name must open that same contact.
 */

const now = '2026-11-10T12:00:00.000Z';
const card = (overrides: Partial<ContactCard> = {}): ContactCard => ({
  id: 'c1', source: 'manual', name: 'Priya Shah', nicknames: [], phones: [], emails: [], notes: '', links: [], rejected: [], updatedAt: now, ...overrides,
});
const mail = (overrides: Partial<StoredMailMessage>): StoredMailMessage => ({
  accountId: 'acct-1', accountEmail: 'me@example.com', mailbox: 'INBOX', to: ['me@example.com'], sourceMessageId: '<a@x>', subject: 'Plans',
  from: 'priya@example.com', sentAt: '2026-11-01T09:00:00Z', text: 'Lunch?', ...overrides,
});
const whatsapp = (id: string, displayName: string, at: number): Conversation[] => mapBridgeSnapshot({
  userId: '@me:x',
  rooms: [{ id: `!wa-${id}:x`, network: 'whatsapp', name: '', members: [{ id: `@whatsapp_${id}:x`, displayName }], events: [{ id: `$${id}-${at}`, sender: `@whatsapp_${id}:x`, body: 'On my way', timestamp: at }] }],
});
const openMedia = (handle: string, at: string): Conversation => ({
  id: `om-${handle}`,
  participants: [{ id: `user-${handle}`, name: handle, initials: 'P', avatarColor: '#000', identities: [{ id: 'i', personId: `user-${handle}`, kind: 'handle', value: `@${handle}`, source: 'open_media', label: 'Open Media', verifiedByUser: true }] }],
  messages: [{ id: `m-${handle}`, sourceMessageId: `m-${handle}`, conversationId: `om-${handle}`, senderPersonId: `user-${handle}`, senderIdentityId: 'i', recipientPersonIds: ['me'], sentAt: at, body: 'hey', source: 'open_media', channel: 'native', direction: 'inbound', deliveryState: 'received' }],
  sourceSummary: ['open_media'], lastMessageAt: at, preview: 'hey', unreadCount: 0, labels: [],
});

/** Every conversation shown under a contact opens that contact, and the profile shows its saved name. */
function assertOpensItsContact(shown: Conversation[], cards: ContactCard[]) {
  for (const conversation of shown) {
    if (!conversation.contactId) continue;
    const query = contactQueryFor(conversation);
    assert.ok(query, `${conversation.id} has an identity to open`);
    assert.equal(resolveContact(cards, query).card?.id, conversation.contactId, `${conversation.id} opens its contact`);
    // Even without the id (a stale link, a shared target), the identities alone find the same card.
    assert.equal(resolveContact(cards, { ...query, cardId: undefined }).card?.id, conversation.contactId, `${conversation.id} is found by its identities`);
  }
}

test('a conversation merged from email, WhatsApp and Open Media opens its contact', () => {
  const [email] = normalizeStoredEmail([mail({ sentAt: '2026-11-01T09:00:00Z' })]);
  const [chat] = whatsapp('15550001234', '', Date.parse('2026-11-01T10:00:00Z'));
  const om = openMedia('priya', '2026-11-01T08:00:00Z');
  const cards = [card({ emails: ['priya@example.com'], phones: ['(555) 000-1234'], handles: [{ network: 'open_media', handle: '@Priya' }] })];
  const shown = mergeByContact([email, chat, om], cards);
  assert.equal(shown[0].id, 'contact:c1');
  assertOpensItsContact(shown, cards);
});

test('a company thread from two mailboxes opens the contact saved with the other mailbox', () => {
  const [thread] = normalizeStoredEmail([
    mail({ sourceMessageId: '<s1@x>', from: 'hello@studio.example.com', sentAt: '2026-11-01T09:00:00Z' }),
    mail({ sourceMessageId: '<s2@x>', from: 'support@studio.example.com', sentAt: '2026-11-01T10:00:00Z' }),
  ]);
  const cards = [card({ name: 'Studio Ana', emails: ['hello@studio.example.com'] })];
  const shown = mergeByContact([thread], cards);
  assert.equal(shown[0].contactId, 'c1');
  assertOpensItsContact(shown, cards);
});

test('a contact linked by hand opens from every conversation it holds', () => {
  const [chat] = whatsapp('447700900123', 'Priya', 1);
  const om = openMedia('ps_designs', '2026-11-01T08:00:00Z');
  const linked = card({ links: [{ ref: { kind: 'open_media', handle: 'ps_designs' }, method: 'confirmed', evidence: 'You confirmed this', linkedAt: now }], phones: ['+44 7700 900123'] });
  const cards = [linked, card({ id: 'c2', name: 'Someone else', emails: ['else@example.com'] })];
  assertOpensItsContact(mergeByContact([chat, om], cards), cards);
});

test('a known contact id wins, and a deleted one falls back to the identities', () => {
  const cards = [card({ emails: ['priya@example.com'] }), card({ id: 'c2', name: 'Priya (work)' })];
  assert.equal(resolveContact(cards, { ref: { kind: 'email', address: 'priya@example.com' }, cardId: 'c2' }).card?.id, 'c2');
  assert.equal(resolveContact(cards, { ref: { kind: 'email', address: 'priya@example.com' }, cardId: 'gone' }).card?.id, 'c1');
});

test('your own addresses resolve to your own card and never give a contact name', () => {
  const cards = [card({ id: 'me', name: '', self: true, emails: ['me+alt@example.com'] }), card({ emails: ['priya@example.com'] })];
  const resolved = resolveContact(cards, { ref: { kind: 'email', address: 'me+alt@example.com' } });
  assert.equal(resolved.mine, true);
  assert.equal(resolved.card?.id, 'me');
  assert.equal(savedName(cards, { ref: { kind: 'email', address: 'me+alt@example.com' } }), '');
  assert.equal(savedName(cards, { ref: { kind: 'email', address: 'Priya@Example.com' } }), 'Priya Shah');
});

test('a contact saved by email connects to the Open Media account that uses that email', () => {
  const cards = [card({ emails: ['Priya@Example.com'] })];
  const om = openMedia('priya_s', '2026-11-01T08:00:00Z');
  assert.equal(mergeByContact([om], cards)[0].contactId, undefined, 'before discovery, nothing connects them');
  const { cards: linked, changed } = linkDiscoveredAccounts(cards, [{ kind: 'email', value: 'priya@example.com', handle: 'priya_s' }], now);
  assert.deepEqual(changed.map((item) => item.id), ['c1']);
  assert.equal(linked[0].links[0].evidence, 'Their Open Media account uses this email');
  const shown = mergeByContact([om], linked);
  assert.equal(shown[0].participants[0].name, 'Priya Shah', 'their Open Media chat shows the saved name');
  assertOpensItsContact(shown, linked);
  assert.equal(resolveContact(linked, { ref: { kind: 'open_media', handle: '@Priya_S' } }).card?.id, 'c1', 'their profile from the Feed opens the contact');
});

test('discovery never guesses: shared numbers, refused accounts and accounts already on a contact stay apart', () => {
  const match = { kind: 'phone' as const, value: '+15550001234', handle: 'sam' };
  const twins = [card({ phones: ['+1 555 000 1234'] }), card({ id: 'c2', name: 'Sam (old)', phones: ['(555) 000-1234'] })];
  assert.equal(linkDiscoveredAccounts(twins, [match], now).changed.length, 0, 'a number on two contacts links neither');
  const refused = [card({ phones: ['+1 555 000 1234'], rejected: ['open_media:sam'] })];
  assert.equal(linkDiscoveredAccounts(refused, [match], now).changed.length, 0, '“not this person” is respected');
  const taken = [card({ phones: ['+1 555 000 1234'] }), card({ id: 'c2', name: 'Sam', handles: [{ network: 'open_media', handle: 'sam' }] })];
  assert.equal(linkDiscoveredAccounts(taken, [match], now).changed.length, 0, 'an account already on a contact stays there');
  const mineToo = [card({ id: 'me', name: '', self: true, phones: ['+1 555 000 1234'] })];
  assert.equal(linkDiscoveredAccounts(mineToo, [match], now).changed.length, 0, 'your own card is never linked to someone else');
});

test('only contacts not yet connected are looked up, and numbers only with their country code', () => {
  const request = discoveryRequest([
    card({ emails: ['A@Example.com'], phones: ['+44 7700 900123', '555 0100'] }),
    card({ id: 'c2', emails: ['b@example.com'], handles: [{ network: 'open_media', handle: 'bee' }] }),
    card({ id: 'me', self: true, emails: ['me@example.com'] }),
  ]);
  assert.deepEqual(request, { emails: ['a@example.com'], phones: ['+447700900123'] });
});

test('screens never match contacts themselves: they ask resolveContact (ADR 0037)', () => {
  const ui = join(__dirname, '..', 'ui');
  const lowLevel = /\b(cardFor|holdsRef|holdsHandle|contactForConversation|linkedIdentities)\b/;
  const offenders = readdirSync(ui).filter((file) => /\.tsx?$/.test(file) && lowLevel.test(readFileSync(join(ui, file), 'utf8')));
  assert.deepEqual(offenders, [], 'use resolveContact, savedName or contactQueryFor from src/domain instead');
});

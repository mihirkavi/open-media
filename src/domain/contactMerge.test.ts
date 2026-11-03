import assert from 'node:assert/strict';
import test from 'node:test';

import { StoredMailMessage } from '../connectors/mailApiConnector';
import { mapBridgeSnapshot } from './bridgedChats';
import { applyDraft, canReply, channelOf, contactForConversation, defaultChannel, draftOf, draftProblems, fullerName, mergeByContact, sharedWith } from './contactMerge';
import { normalizeStoredEmail } from './emailNormalization';
import { Conversation } from './models';
import { cardFor, cardRefs, ContactCard, refKey, unlink } from './people';

const now = '2026-11-02T12:00:00.000Z';
const card = (overrides: Partial<ContactCard> = {}): ContactCard => ({
  id: 'c1', source: 'manual', name: 'Priya Shah', nicknames: [], phones: [], emails: [], notes: '', links: [], rejected: [], updatedAt: now, ...overrides,
});

const mail = (overrides: Partial<StoredMailMessage>): StoredMailMessage => ({
  accountId: 'acct-1', accountEmail: 'me@example.com', mailbox: 'INBOX', to: ['me@example.com'], sourceMessageId: '<a@x>', subject: 'Plans',
  from: 'priya@example.com', sentAt: '2026-11-01T09:00:00Z', text: 'Lunch?', ...overrides,
});

const whatsapp = (id: string, displayName: string, at: number, body = 'On my way', roomName = ''): Conversation[] => mapBridgeSnapshot({
  userId: '@me:x',
  rooms: [{ id: `!wa-${id}:x`, network: 'whatsapp', name: roomName, members: [{ id: `@whatsapp_${id}:x`, displayName }], events: [{ id: `$${id}-${at}`, sender: `@whatsapp_${id}:x`, body, timestamp: at }] }],
});

const openMedia = (handle: string, at: string): Conversation => ({
  id: `om-${handle}`,
  participants: [{ id: `user-${handle}`, name: handle, initials: 'P', avatarColor: '#000', identities: [{ id: 'i', personId: `user-${handle}`, kind: 'handle', value: `@${handle}`, source: 'open_media', label: 'Open Media', verifiedByUser: true }] }],
  messages: [{ id: `m-${handle}`, sourceMessageId: `m-${handle}`, conversationId: `om-${handle}`, senderPersonId: `user-${handle}`, senderIdentityId: 'i', recipientPersonIds: ['me'], sentAt: at, body: 'hey', source: 'open_media', channel: 'native', direction: 'inbound', deliveryState: 'received' }],
  sourceSummary: ['open_media'],
  lastMessageAt: at,
  preview: 'hey',
  unreadCount: 1,
  labels: [],
});

test('an email from an address saved on a contact shows the contact’s name', () => {
  const [email] = normalizeStoredEmail([mail({ from: 'P. Shah <Priya@Example.com>' })]);
  const [shown] = mergeByContact([email], [card({ emails: ['priya@example.com'] })]);
  assert.equal(shown.participants[0].name, 'Priya Shah');
  assert.equal(shown.participants[0].initials, 'PS');
  assert.equal(shown.id, email.id, 'a contact with one conversation keeps its id');
  assert.equal(shown.contactId, 'c1');
});

test('email, WhatsApp and Open Media from one contact become one conversation in time order', () => {
  const [email] = normalizeStoredEmail([mail({ sentAt: '2026-11-01T09:00:00Z' })]);
  const [chat] = whatsapp('15550001234', '', Date.parse('2026-11-01T10:00:00Z'));
  const om = openMedia('priya', '2026-11-01T08:00:00Z');
  const priya = card({ emails: ['priya@example.com'], phones: ['(555) 000-1234'], handles: [{ network: 'open_media', handle: '@Priya' }] });
  const result = mergeByContact([email, chat, om, openMedia('someone', '2026-11-01T07:00:00Z')], [priya]);
  assert.equal(result.length, 2);
  const [merged, other] = result;
  assert.equal(merged.id, 'contact:c1');
  assert.equal(merged.participants.length, 1, 'still a one-to-one conversation');
  assert.equal(merged.participants[0].name, 'Priya Shah');
  assert.deepEqual(merged.messages.map((message) => message.source), ['open_media', 'imap', 'whatsapp']);
  assert.deepEqual(merged.sourceSummary, ['whatsapp', 'imap', 'open_media'], 'newest channel first');
  assert.equal(merged.unreadCount, 1 + email.unreadCount);
  assert.deepEqual(merged.channels?.map((channel) => channel.id), [chat.id, email.id, om.id]);
  assert.equal(channelOf(merged, email.id)?.email?.address, 'priya@example.com');
  assert.equal(other.id, 'om-someone', 'people without a contact are untouched');
});

test('a WhatsApp handle saved on the contact matches even without a phone number', () => {
  const [chat] = whatsapp('447700900123', 'Priya', 1);
  assert.equal(contactForConversation([card({ handles: [{ network: 'whatsapp', handle: '+44 7700 900123' }] })], chat)?.id, 'c1');
  assert.equal(contactForConversation([card({ handles: [{ network: 'telegram', handle: '447700900123' }] })], chat), undefined, 'a handle only counts on its own network');
});

test('an identifier on two contacts merges into neither', () => {
  const [email] = normalizeStoredEmail([mail({})]);
  const cards = [card({ emails: ['priya@example.com'] }), card({ id: 'c2', name: 'Priya (work)', emails: ['priya@example.com'] })];
  const [shown] = mergeByContact([email], cards);
  assert.equal(shown.contactId, undefined);
  assert.equal(shown.participants[0].name, email.participants[0].name);
});

test('an explicit link wins over a shared identifier, and unlinking takes the chat back out', () => {
  const [email] = normalizeStoredEmail([mail({})]);
  const linked = card({ id: 'c2', name: 'Priya (work)', emails: ['priya@example.com'], links: [{ ref: { kind: 'email', address: 'priya@example.com' }, method: 'confirmed', evidence: 'You confirmed this', linkedAt: now }] });
  const cards = [card({ emails: ['priya@example.com'] }), linked];
  assert.equal(contactForConversation(cards, email)?.id, 'c2');
  const undone = [cards[0], unlink(linked, { kind: 'email', address: 'priya@example.com' }, now)];
  assert.equal(contactForConversation(undone, email)?.id, 'c1', 'the work card said no, so the other card is the only one left');
});

test('group chats and group emails never merge into one person', () => {
  const group = mapBridgeSnapshot({ userId: '@me:x', rooms: [{ id: '!g:x', network: 'whatsapp', name: 'Family', members: [{ id: '@whatsapp_15550001234:x', displayName: 'Priya' }, { id: '@whatsapp_15550009999:x', displayName: 'Dev' }], events: [] }] });
  const [groupEmail] = normalizeStoredEmail([mail({ to: ['me@example.com', 'dev@example.com'] })]);
  const priya = card({ emails: ['priya@example.com'], phones: ['5550001234'] });
  assert.equal(contactForConversation([priya], group[0]), undefined);
  assert.equal(contactForConversation([priya], groupEmail), undefined);
});

test('replies default to the channel they last wrote from, if it can take a reply', () => {
  const [email] = normalizeStoredEmail([mail({ sentAt: '2026-11-01T11:00:00Z' })]);
  const [chat] = whatsapp('15550001234', 'Priya', Date.parse('2026-11-01T10:00:00Z'));
  const [merged] = mergeByContact([email, chat], [card({ emails: ['priya@example.com'], phones: ['+15550001234'] })]);
  assert.equal(canReply(email), false, 'this mailbox has no outgoing mail');
  assert.equal(defaultChannel(merged).id, chat.id);
  const sendable = { ...email, email: { ...email.email!, canSend: true } };
  const [again] = mergeByContact([sendable, chat], [card({ emails: ['priya@example.com'], phones: ['+15550001234'] })]);
  assert.equal(defaultChannel(again).id, email.id, 'email was the latest thing they sent');
});

test('platforms’ full names beat handles, numbers and ids', () => {
  assert.equal(fullerName('+1 555 000 1234', 'Priya Shah'), 'Priya Shah');
  assert.equal(fullerName('whatsapp_15550001234', 'Priya'), 'Priya');
  assert.equal(fullerName('', 'priya@example.com'), 'priya@example.com', 'something is better than nothing');
  const [chat] = whatsapp('15550001234', '+15550001234', 1, 'hi', 'Priya Shah');
  assert.equal(chat.participants[0].name, 'Priya Shah', 'a bridged one-to-one chat takes the room’s name');
});

test('editing cleans, de-duplicates and checks, and keeps links', () => {
  const link = { ref: { kind: 'email' as const, address: 'priya@example.com' }, method: 'confirmed' as const, evidence: 'You added this', linkedAt: now };
  const draft = { ...draftOf(card({ links: [link] })), name: '  Priya   Shah ', emails: ['Priya@Example.com ', 'priya@example.com', ''], phones: ['+1 (555) 000-1234', '5550001234'], handles: [{ network: 'farcaster' as const, handle: '@PriyaS' }, { network: 'farcaster' as const, handle: 'priyas' }, { network: 'telegram' as const, handle: '' }] };
  assert.deepEqual(draftProblems(draft), []);
  const saved = applyDraft(card({ links: [link] }), draft, now);
  assert.equal(saved.name, 'Priya Shah');
  assert.deepEqual(saved.emails, ['priya@example.com']);
  assert.deepEqual(saved.phones, ['+1 (555) 000-1234']);
  assert.deepEqual(saved.handles, [{ network: 'farcaster', handle: 'PriyaS' }]);
  assert.deepEqual(saved.links, [link]);
  assert.deepEqual(cardRefs(saved).map(refKey), ['email:priya@example.com', 'network:farcaster:priyas']);
  assert.equal(cardFor([saved], { kind: 'network', network: 'farcaster', handle: 'priyas' })?.id, 'c1', 'a saved handle finds the contact from their posts');
  assert.deepEqual(draftProblems({ ...draft, name: ' ', emails: ['priya@'], phones: ['12'] }), ['Add a name.', '“priya@” isn’t an email address.', '“12” isn’t a full phone number.']);
});

test('the editor says when another contact already has an identifier', () => {
  const other = card({ id: 'c2', name: 'Dev', phones: ['+15550001234'] });
  assert.deepEqual(sharedWith([card(), other], 'c1', { ...draftOf(card()), phones: ['555 000 1234'] }), [{ value: '555 000 1234', contact: 'Dev' }]);
});

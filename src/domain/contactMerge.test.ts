import assert from 'node:assert/strict';
import test from 'node:test';

import { StoredMailMessage } from '../connectors/mailApiConnector';
import { mapBridgeSnapshot } from './bridgedChats';
import { applyDraft, canReply, channelOf, contactForConversation, defaultChannel, draftOf, draftProblems, fullerName, mergeByContact, recipientSuggestions, sharedWith } from './contactMerge';
import { normalizeStoredEmail } from './emailNormalization';
import { Conversation } from './models';
import { cardFor, cardRefs, ContactCard, isMine, reconcile, refKey, unlink } from './people';

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

// Saved email addresses must show the contact's name in every shape of real mail.

test('a bare-address email from a saved contact shows their name, even when you replied last', () => {
  const [thread] = normalizeStoredEmail([
    mail({ sourceMessageId: '<n1@x>', from: 'ada@example.com', sentAt: '2026-11-01T09:00:00Z' }),
    mail({ sourceMessageId: '<n2@x>', mailbox: 'Sent', from: 'me@example.com', to: ['Ada@Example.com'], sentAt: '2026-11-01T10:00:00Z' }),
  ]);
  assert.equal(thread.participants[0].name, 'ada@example.com', 'the platform only gave an address');
  const [shown] = mergeByContact([thread], [card({ name: 'Ada Lovelace', emails: ['ADA@example.com'] })]);
  assert.equal(shown.participants[0].name, 'Ada Lovelace');
});

test('a +tag alias or a Gmail address with dots is the same person', () => {
  const [alias] = normalizeStoredEmail([mail({ from: 'priya.shah+travel@example.com' })]);
  assert.equal(mergeByContact([alias], [card({ emails: ['priya.shah@example.com'] })])[0].participants[0].name, 'Priya Shah');
  const [gmail] = normalizeStoredEmail([mail({ from: 'Priya.Shah@googlemail.com' })]);
  assert.equal(mergeByContact([gmail], [card({ emails: ['priyashah@gmail.com'] })])[0].participants[0].name, 'Priya Shah');
  assert.equal(mergeByContact([alias], [card({ emails: ['priya.shahs@example.com'] })])[0].participants[0].name, 'priya.shah+travel@example.com', 'a different name is a different person');
});

test('in a group email, each saved person shows under their contact name, in the title, sender lines and preview', () => {
  const [group] = normalizeStoredEmail([
    mail({ sourceMessageId: '<g1@x>', from: 'priya.shah@example.com', to: ['me@example.com', 'dev@example.com'], sentAt: '2026-11-01T09:00:00Z' }),
    mail({ sourceMessageId: '<g2@x>', from: 'P. Shah <priya.shah@example.com>', to: ['me@example.com', 'dev@example.com'], sentAt: '2026-11-01T10:00:00Z', text: 'Count me in' }),
  ]);
  assert.equal(group.groupTitle, 'dev@example.com and P.');
  const [shown] = mergeByContact([group], [card({ emails: ['priya.shah@example.com'] }), card({ id: 'c2', name: 'Dev Mehta', emails: ['dev@example.com'] })]);
  assert.equal(shown.id, group.id, 'a group stays its own conversation');
  assert.deepEqual(shown.participants.map((person) => person.name).sort(), ['Dev Mehta', 'Priya Shah']);
  assert.equal(shown.groupTitle, 'Dev and Priya');
  assert.equal(shown.preview, 'Priya: Count me in');
  const sender = shown.participants.find((person) => person.id === shown.messages[1].senderPersonId);
  assert.equal(sender?.name, 'Priya Shah', 'the sender line reads the renamed person');
});

test('a bridged group keeps the name its members gave it, with contact names inside', () => {
  const [group] = mapBridgeSnapshot({ userId: '@me:x', rooms: [{ id: '!g:x', network: 'whatsapp', name: 'Climbing crew', members: [{ id: '@whatsapp_15550001234:x', displayName: '+1 555 000 1234' }, { id: '@whatsapp_15550009999:x', displayName: 'Dev' }], events: [] }] });
  const [shown] = mergeByContact([group], [card({ phones: ['+1 555 000 1234'] })]);
  assert.equal(shown.groupTitle, 'Climbing crew');
  assert.deepEqual(shown.participants.map((person) => person.name), ['Priya Shah', 'Dev']);
});

test('a company thread written from two mailboxes matches a contact saved with either one', () => {
  const [thread] = normalizeStoredEmail([
    mail({ sourceMessageId: '<s1@x>', from: 'hello@studio.example.com', sentAt: '2026-11-01T09:00:00Z' }),
    mail({ sourceMessageId: '<s2@x>', from: 'support@studio.example.com', sentAt: '2026-11-01T10:00:00Z' }),
  ]);
  assert.equal(mergeByContact([thread], [card({ name: 'Studio Ana', emails: ['hello@studio.example.com'] })])[0].participants[0].name, 'Studio Ana');
});

test('a contact whose “name” is only its email address shows the platform’s name and asks for a real one', () => {
  const [email] = normalizeStoredEmail([mail({ from: 'Maria López <maria@example.org>' })]);
  const unnamed = card({ name: 'maria@example.org', emails: ['maria@example.org'] });
  assert.equal(mergeByContact([email], [unnamed])[0].participants[0].name, 'Maria López');
  assert.equal(draftOf(unnamed).name, '', 'the editor starts with an empty name');
  assert.deepEqual(draftProblems(draftOf(unnamed)), ['Add a name.']);
});

test('the To field offers saved contacts by name, then people you emailed, each address once', () => {
  const emailed = [
    { address: 'priya.shah@example.com', name: 'P. Shah', initials: 'PS', avatarUrls: ['https://example.com/p.png'] },
    { address: 'dev@example.com', name: 'dev@example.com', initials: 'D', avatarUrls: [] },
    { address: 'news@shop.example.com', name: 'Shop', initials: 'S', avatarUrls: [] },
  ];
  const cards = [
    card({ emails: ['Priya.Shah@example.com', 'priya@work.example.com'] }),
    card({ id: 'c2', name: 'Dev Mehta', emails: ['dev@example.com'] }),
    card({ id: 'c3', name: 'ada@example.com', emails: ['ada@example.com'] }),
  ];
  const suggestions = recipientSuggestions(emailed, cards);
  assert.deepEqual(suggestions.map((item) => [item.address, item.name]), [
    ['ada@example.com', 'ada@example.com'],
    ['dev@example.com', 'Dev Mehta'],
    ['priya.shah@example.com', 'Priya Shah'],
    ['priya@work.example.com', 'Priya Shah'],
    ['news@shop.example.com', 'Shop'],
  ]);
  assert.deepEqual(suggestions[2].avatarUrls, ['https://example.com/p.png'], 'the picture from mail stays');
});

// Your own card ("My Card", ADR 0023).

const myCard = (overrides: Partial<ContactCard> = {}): ContactCard => card({ id: 'me', self: true, name: 'Sam Rivera', emails: ['sam.personal@example.com'], phones: ['+1 555 010 9999'], handles: [{ network: 'open_media', handle: 'samr' }], ...overrides });

test('mail from one of your own addresses is yours: sent by you, not a separate person', () => {
  const messages = [
    mail({ sourceMessageId: '<o1@x>', from: 'priya.shah@example.com', to: ['me@example.com'], sentAt: '2026-11-01T09:00:00Z' }),
    mail({ sourceMessageId: '<o2@x>', from: 'Sam <sam.personal@example.com>', to: ['priya.shah@example.com'], sentAt: '2026-11-01T10:00:00Z', text: 'Reply from my other address' }),
  ];
  assert.equal(normalizeStoredEmail(messages).length, 2, 'without your card, your other address looks like another person');
  const [thread, ...rest] = normalizeStoredEmail(messages, { alsoMine: ['sam.personal@example.com'] });
  assert.equal(rest.length, 0);
  assert.deepEqual(thread.messages.map((message) => message.direction), ['inbound', 'outbound']);
});

test('your own identities never match, merge into or get suggested for anyone else', () => {
  const [chat] = whatsapp('15550109999', 'Sam', 1);
  const priya = card({ phones: ['+1 555 010 9999'] });
  assert.equal(contactForConversation([priya], chat)?.id, 'c1', 'without your card the number would join Priya');
  assert.equal(contactForConversation([priya, myCard()], chat), undefined);
  const [shown] = mergeByContact([chat], [priya, myCard()], 'Sam Rivera');
  assert.equal(shown.participants[0].name, 'Sam Rivera (Me)', 'a chat with yourself is you');
  assert.equal(cardFor([myCard()], { kind: 'open_media', handle: 'samr' }), undefined, 'your own card is never “a contact” for your identities');
  assert.ok(isMine([myCard()], { kind: 'email', address: 'Sam.Personal+lists@example.com' }));
  const { cards, suggestions } = reconcile([myCard({ name: 'Sam Rivera' }), card({ id: 'c2', name: 'Sam Rivera' })], [{ ref: { kind: 'email', address: 'sam.personal@example.com' }, name: 'Sam Rivera' }], now);
  assert.equal(suggestions.length, 0);
  assert.ok(cards.every((item) => item.links.length === 0));
});

test('the To field lists your own addresses last, as “Name (Me)”', () => {
  const emailed = [{ address: 'sam.personal@example.com', name: 'Sam', initials: 'S', avatarUrls: [] }, { address: 'dev@example.com', name: 'Dev', initials: 'D', avatarUrls: [] }];
  assert.deepEqual(recipientSuggestions(emailed, [myCard()], 'Sam Rivera').map((item) => [item.address, item.name]), [
    ['dev@example.com', 'Dev'],
    ['sam.personal@example.com', 'Sam Rivera (Me)'],
  ]);
});

test('mail between your own addresses is a note to yourself, shown as “Name (Me)”', () => {
  const [note] = normalizeStoredEmail([mail({ from: 'Sam <sam.personal@example.com>', to: ['me@example.com'], text: 'Book the gym' })], { alsoMine: ['sam.personal@example.com'] });
  assert.equal(note.email?.address, 'me@example.com');
  assert.equal(note.messages[0].direction, 'outbound');
  assert.equal(note.email?.toSelf, true);
  const [shown] = mergeByContact([note], [myCard()], 'Sam Rivera');
  assert.equal(shown.participants[0].name, 'Sam Rivera (Me)');
});

test('every chat with yourself, from any of your addresses or networks, is one “Name (Me)” conversation', () => {
  const me = myCard({ emails: ['sam.personal@example.com', 'sam@work.example.com'] });
  const notes = normalizeStoredEmail([
    mail({ sourceMessageId: '<n1@x>', from: 'me@example.com', to: ['sam.personal@example.com'], sentAt: '2026-11-01T09:00:00Z', text: 'Book the gym' }),
    mail({ sourceMessageId: '<n2@x>', from: 'me@example.com', to: ['sam@work.example.com'], sentAt: '2026-11-01T10:00:00Z', text: 'Send the report' }),
    mail({ sourceMessageId: '<n3@x>', from: 'priya@example.com', to: ['me@example.com'], sentAt: '2026-11-01T11:00:00Z', text: 'Lunch?' }),
  ], { alsoMine: me.emails });
  const [self] = whatsapp('15550109999', 'Sam', Date.parse('2026-11-01T12:00:00Z'), 'Passport in the drawer');
  const shown = mergeByContact([...notes, self], [me], 'Sam Rivera');
  const mine = shown.filter((conversation) => conversation.participants[0].name === 'Sam Rivera (Me)');
  assert.equal(mine.length, 1, 'one conversation with yourself');
  assert.equal(mine[0].id, 'contact:me');
  assert.equal(mine[0].participants[0].initials, 'SR');
  assert.deepEqual(mine[0].messages.map((message) => message.body), ['Book the gym', 'Send the report', 'Passport in the drawer']);
  assert.equal(mine[0].channels?.length, 3, 'each address and network stays a channel to reply through');
  assert.ok(mine[0].channels?.every((channel) => channel.participants[0].name === 'Sam Rivera (Me)'));
  assert.equal(shown.length, 2, 'Priya keeps her own conversation');
});

test('a single chat with yourself keeps its own id', () => {
  const [note] = normalizeStoredEmail([mail({ from: 'me@example.com', to: ['sam.personal@example.com'], text: 'Book the gym' })], { alsoMine: ['sam.personal@example.com'] });
  const [shown] = mergeByContact([note], [myCard()], 'Sam Rivera');
  assert.equal(shown.id, note.id);
  assert.equal(shown.channels, undefined);
});

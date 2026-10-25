import assert from 'node:assert/strict';
import test from 'node:test';

import { cardFor, confirmLink, ContactCard, importDeviceContacts, linkedIdentities, reconcile, refKey, rejectSuggestion, samePhone, shownName, unlink } from './people';

const now = '2026-10-24T12:00:00.000Z';
const card = (overrides: Partial<ContactCard> = {}): ContactCard => ({
  id: 'c1', source: 'device', deviceId: 'd1', name: 'Rebecca', nicknames: [], phones: ['+15550001234'], emails: ['rebecca@example.com'], notes: '', links: [], rejected: [], updatedAt: now, ...overrides,
});

test('a verified name the person chose to show wins; the saved name stays a private alias', () => {
  assert.deepEqual(shownName({ disclosedLegalName: 'Rebecca Smith', declaredName: 'Bex' }, card()), { name: 'Rebecca Smith', alias: 'Rebecca' });
});

test('an anonymous person is never shown under a name they did not disclose', () => {
  // Tier 4: verified, legal name withheld, so it is never passed in; the handle is shown.
  assert.equal(shownName({ handle: 'nightowl' }, card({ name: 'Rebecca Smith' })).name, '@nightowl');
  assert.equal(shownName({ handle: 'nightowl' }, card({ name: 'Rebecca Smith' })).alias, 'Rebecca Smith');
});

test('phone numbers match with or without a country code, but not on short fragments', () => {
  assert.ok(samePhone('+1 (555) 000-1234', '15550001234'));
  assert.ok(samePhone('5550001234', '+15550001234'));
  assert.ok(!samePhone('+445550001234', '+15550001234'));
  assert.ok(!samePhone('1234', '01234'));
});

test('an exact email or phone links automatically, with its evidence', () => {
  const { cards, suggestions } = reconcile([card()], [{ ref: { kind: 'email', address: 'Rebecca@Example.com' } }, { ref: { kind: 'bridge', network: 'whatsapp', id: '15550001234' }, phones: ['15550001234'] }], now);
  assert.equal(suggestions.length, 0);
  assert.deepEqual(cards[0].links.map((link) => [refKey(link.ref), link.method, link.evidence]), [
    ['email:rebecca@example.com', 'auto', 'Same email address'],
    ['bridge:whatsapp:15550001234', 'auto', 'Same phone number'],
  ]);
});

test('names alone never link; an identifier shared by two contacts asks instead of guessing', () => {
  const twins = [card(), card({ id: 'c2', deviceId: 'd2', name: 'Rebecca Work' })];
  const { cards, suggestions } = reconcile(twins, [
    { ref: { kind: 'open_media', handle: 'rsmith' }, name: 'Rebecca Smith' },
    { ref: { kind: 'email', address: 'rebecca@example.com' } },
  ], now);
  assert.ok(cards.every((item) => item.links.length === 0));
  assert.equal(suggestions.length, 2);
  assert.ok(suggestions.every((item) => item.ref.kind === 'email'));
  const byName = reconcile([card({ name: 'Rebecca Smith' })], [{ ref: { kind: 'open_media', handle: 'rsmith' }, name: 'Rebecca Smith' }], now);
  assert.equal(byName.cards[0].links.length, 0);
  assert.equal(byName.suggestions[0].confidence, 0.3);
});

test('undo removes a wrong link, keeps the original card, and is not re-linked automatically', () => {
  const linked = reconcile([card()], [{ ref: { kind: 'email', address: 'rebecca@example.com' } }], now).cards[0];
  const undone = unlink(linked, { kind: 'email', address: 'rebecca@example.com' }, now);
  assert.equal(undone.links.length, 0);
  assert.deepEqual([undone.name, undone.phones, undone.emails], [linked.name, linked.phones, linked.emails]);
  assert.equal(reconcile([undone], [{ ref: { kind: 'email', address: 'rebecca@example.com' } }], now).cards[0].links.length, 0);
  // Confirming later brings it back.
  assert.equal(confirmLink(undone, { kind: 'email', address: 'rebecca@example.com' }, now).links[0].method, 'confirmed');
});

test('rejected suggestions stay rejected, and linked identities are found together', () => {
  const rejected = rejectSuggestion(card({ name: 'Rebecca Smith' }), { kind: 'open_media', handle: 'rsmith' }, now);
  assert.equal(reconcile([rejected], [{ ref: { kind: 'open_media', handle: 'rsmith' }, name: 'Rebecca Smith' }], now).suggestions.length, 0);
  const both = confirmLink(confirmLink(card(), { kind: 'open_media', handle: 'rsmith' }, now), { kind: 'network', network: 'farcaster', handle: 'becca' }, now);
  assert.equal(cardFor([both], { kind: 'open_media', handle: '@RSmith' })?.id, 'c1');
  assert.deepEqual(linkedIdentities([both], { kind: 'network', network: 'farcaster', handle: 'becca' }).map(refKey), ['open_media:rsmith', 'network:farcaster:becca']);
});

test('re-importing device contacts updates cards in place and keeps the viewer’s links and notes', () => {
  const existing = confirmLink(card({ notes: 'Met at the conference' }), { kind: 'open_media', handle: 'rsmith' }, now);
  const updated = importDeviceContacts([existing], [{ id: 'd1', fullName: 'Rebecca S', phones: [{ id: 'p', value: '+1 555 000 9999' }], emails: [] }], () => 'new', now);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].name, 'Rebecca S');
  assert.deepEqual(updated[0].phones, ['+15550009999']);
  assert.equal(updated[0].notes, 'Met at the conference');
  assert.equal(updated[0].links.length, 1);
  const fresh = importDeviceContacts([], [{ id: 'd9', fullName: '', phones: [], emails: [{ id: 'e', value: ' A@B.co ' }] }], () => 'new', now);
  assert.deepEqual([fresh[0].id, fresh[0].name, fresh[0].emails], ['new', 'Unnamed contact', ['a@b.co']]);
});

test('a conversation becomes an identity the viewer can link; group chats do not', async () => {
  const { encounterForConversation } = await import('./people');
  const person = (id: string, identities: { source: string; value: string }[] = []) => ({ id, name: 'Sam Lee', initials: 'SL', avatarColor: '#000', identities: identities.map((item, index) => ({ id: String(index), personId: id, kind: 'handle' as const, label: '', verifiedByUser: false, ...item })) as never });
  const base = { id: 'c', messages: [], lastMessageAt: now, preview: '', unreadCount: 0, labels: [] };
  assert.deepEqual(encounterForConversation({ ...base, participants: [person('u1', [{ source: 'open_media', value: '@samlee' }])], sourceSummary: ['open_media'] } as never)?.ref, { kind: 'open_media', handle: 'samlee' });
  assert.deepEqual(encounterForConversation({ ...base, participants: [person('m')], sourceSummary: ['imap'], email: { accountId: 'a', accountEmail: 'me@x.co', address: 'sam@example.com' } } as never)?.ref, { kind: 'email', address: 'sam@example.com' });
  const whatsapp = encounterForConversation({ ...base, participants: [person('@whatsapp_15550001234:openmedia.localhost')], sourceSummary: ['whatsapp'] } as never);
  assert.deepEqual([whatsapp?.ref, whatsapp?.phones], [{ kind: 'bridge', network: 'whatsapp', id: '15550001234' }, ['15550001234']]);
  assert.equal(encounterForConversation({ ...base, groupTitle: 'Family', participants: [person('a'), person('b')], sourceSummary: ['whatsapp'] } as never), undefined);
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { ContactCard } from '../../../src/domain/people';
import { contactsKey, openCard, sealCard, validCards } from './contactsStore.js';

const card: ContactCard = {
  id: '6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11', source: 'manual', name: 'Rebecca', nicknames: [], phones: ['+15550001234'], emails: ['rebecca@example.com'],
  notes: 'Met at the conference', links: [], rejected: [], updatedAt: '2026-10-24T12:00:00.000Z',
};
const mailKey = randomBytes(32).toString('base64');

test('contacts get their own key, never the mailbox key itself', () => {
  const key = contactsKey({ MAIL_CREDENTIALS_KEY: mailKey });
  assert.notEqual(key, mailKey);
  assert.equal(contactsKey({ MAIL_CREDENTIALS_KEY: mailKey }), key);
  assert.equal(contactsKey({ CONTACTS_KEY: 'dedicated', MAIL_CREDENTIALS_KEY: mailKey }), 'dedicated');
  assert.throws(() => contactsKey({}), /not configured/);
});

test('a sealed card hides every detail and opens only with the same key', () => {
  const key = contactsKey({ MAIL_CREDENTIALS_KEY: mailKey });
  const sealed = sealCard(card, key);
  for (const secret of ['Rebecca', '5550001234', 'example.com', 'conference']) assert.ok(!sealed.includes(secret), secret);
  assert.deepEqual(openCard(sealed, key), card);
  assert.equal(openCard(sealed, contactsKey({ MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') })), undefined);
});

test('malformed, oversized or too many cards are refused before anything is stored', () => {
  assert.equal(validCards([card]).length, 1);
  assert.throws(() => validCards([]), /1 to 500/);
  assert.throws(() => validCards(Array.from({ length: 501 }, () => card)), /1 to 500/);
  assert.throws(() => validCards([{ ...card, id: 'not-a-uuid' }]), /malformed/);
  assert.throws(() => validCards([{ ...card, phones: 'nope' }]), /malformed/);
  assert.throws(() => validCards([{ ...card, notes: 'x'.repeat(20_000) }]), /too large/);
});

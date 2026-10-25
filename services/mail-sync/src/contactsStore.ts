/**
 * Contact cards (ADR 0013): each person's private address book, synced across their devices.
 * Cards are encrypted here with a key the database never sees, then stored through the person's
 * own token, so row-level security limits every read and write to the card's owner.
 */
import { createHmac } from 'node:crypto';

import { ContactCard, isContactCard } from '../../../src/domain/people';
import { decryptSecret, encryptSecret } from './crypto.js';

export interface ContactsEnv {
  /** Optional dedicated key; otherwise one is derived from MAIL_CREDENTIALS_KEY. */
  CONTACTS_KEY?: string;
  MAIL_CREDENTIALS_KEY?: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const maxCardsPerRequest = 500;
const maxCardBytes = 16_000;

/** A separate key for contacts, so mailbox passwords and address books never share one. */
export function contactsKey(env: ContactsEnv): string {
  if (env.CONTACTS_KEY) return env.CONTACTS_KEY;
  if (!env.MAIL_CREDENTIALS_KEY) throw new Error('Contact sync is not configured on this server.');
  return createHmac('sha256', Buffer.from(env.MAIL_CREDENTIALS_KEY, 'base64')).update('open-media-contacts-v1').digest('base64');
}

export function sealCard(card: ContactCard, key: string): string {
  return encryptSecret(JSON.stringify(card), key);
}

export function openCard(ciphertext: string, key: string): ContactCard | undefined {
  try {
    const card = JSON.parse(decryptSecret(ciphertext, key)) as unknown;
    return isContactCard(card) ? card : undefined;
  } catch {
    return undefined;
  }
}

/** Checks cards sent by the app or an agent before they are encrypted and stored. */
export function validCards(value: unknown): ContactCard[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxCardsPerRequest) throw new Error(`Send 1 to ${maxCardsPerRequest} contact cards.`);
  return value.map((card) => {
    if (!isContactCard(card) || !uuid.test(card.id)) throw new Error('A contact card is malformed.');
    if (JSON.stringify(card).length > maxCardBytes) throw new Error('A contact card is too large.');
    return card;
  });
}

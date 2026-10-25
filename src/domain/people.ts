import { DeviceContactSnapshot, normalizeEmail, normalizePhone } from './contactCleaning';
import { BridgedNetwork, Conversation } from './models';
import { NetworkId } from './networkPosts';

/**
 * People across networks (ADR 0013). A person someone meets in Open Media can be an Open Media
 * account, an author on an open network, an email address, a phone number or a bridged chat.
 * The viewer's own contact cards add private details (their saved name, numbers, notes) and link
 * those identities together.
 *
 * Linking is the viewer's private bookkeeping: it never changes the original records, never
 * declares to anyone else that two accounts are the same person, and every link can be undone.
 * Only exact shared identifiers (an email address or phone number the viewer already holds) link
 * automatically; anything weaker becomes a suggestion the viewer confirms.
 */

export type IdentityRef =
  | { kind: 'open_media'; handle: string }
  | { kind: 'email'; address: string }
  | { kind: 'phone'; number: string }
  | { kind: 'network'; network: NetworkId; handle: string }
  | { kind: 'bridge'; network: BridgedNetwork; id: string };

export interface ContactLink {
  ref: IdentityRef;
  method: 'auto' | 'confirmed';
  /** Why it was linked, shown when the viewer inspects the link (“Same email address”). */
  evidence: string;
  linkedAt: string;
}

/** One of the viewer's own contacts. Private to its owner; stored encrypted (ADR 0013, 2.4). */
export interface ContactCard {
  id: string;
  source: 'device' | 'manual';
  /** The device contact this card was imported from, so re-imports update it in place. */
  deviceId?: string;
  /** The name the viewer saved, kept as a private, searchable alias. */
  name: string;
  nicknames: string[];
  phones: string[];
  emails: string[];
  notes: string;
  links: ContactLink[];
  /** Identities the viewer said are not this person; never suggested or linked again. */
  rejected: string[];
  updatedAt: string;
}

/** Someone the viewer has come across, with whatever identifiers that source reveals to them. */
export interface Encounter {
  ref: IdentityRef;
  name?: string;
  emails?: string[];
  phones?: string[];
}

export interface LinkSuggestion {
  cardId: string;
  ref: IdentityRef;
  reason: string;
  confidence: number;
}

export function refKey(ref: IdentityRef): string {
  switch (ref.kind) {
    case 'open_media': return `open_media:${ref.handle.replace(/^@/, '').toLowerCase()}`;
    case 'email': return `email:${normalizeEmail(ref.address)}`;
    case 'phone': return `phone:${normalizePhone(ref.number)}`;
    case 'network': return `network:${ref.network}:${ref.handle.replace(/^@/, '').toLowerCase()}`;
    case 'bridge': return `bridge:${ref.network}:${ref.id}`;
  }
}

/** Two numbers are the same when equal, or when one lacks a country code and the last 10 digits agree. */
export function samePhone(left: string, right: string): boolean {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  if (a.startsWith('+') && b.startsWith('+')) return digitsA === digitsB;
  return digitsA.length >= 10 && digitsB.length >= 10 && digitsA.slice(-10) === digitsB.slice(-10);
}

function emailsOf(encounter: Encounter): string[] {
  return [...(encounter.ref.kind === 'email' ? [encounter.ref.address] : []), ...(encounter.emails ?? [])].map(normalizeEmail);
}

function phonesOf(encounter: Encounter): string[] {
  return [...(encounter.ref.kind === 'phone' ? [encounter.ref.number] : []), ...(encounter.phones ?? [])];
}

function normalizedName(value: string | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Links encounters to the viewer's cards. Exact email or phone matches to exactly one card link
 * automatically; matches to several cards, or full-name-only matches, become suggestions.
 * Returns new cards (inputs are never mutated) and the open suggestions.
 */
export function reconcile(cards: ContactCard[], encounters: Encounter[], now = new Date().toISOString()): { cards: ContactCard[]; suggestions: LinkSuggestion[] } {
  const next = cards.map((card) => ({ ...card, links: [...card.links] }));
  const suggestions: LinkSuggestion[] = [];
  for (const encounter of encounters) {
    const key = refKey(encounter.ref);
    if (next.some((card) => card.links.some((link) => refKey(link.ref) === key))) continue;
    const eligible = next.filter((card) => !card.rejected.includes(key));
    const emails = emailsOf(encounter);
    const phones = phonesOf(encounter);
    const byIdentifier = eligible.flatMap((card) => {
      if (emails.some((email) => card.emails.map(normalizeEmail).includes(email))) return [{ card, evidence: 'Same email address' }];
      if (phones.some((phone) => card.phones.some((saved) => samePhone(saved, phone)))) return [{ card, evidence: 'Same phone number' }];
      return [];
    });
    if (byIdentifier.length === 1) {
      byIdentifier[0].card.links.push({ ref: encounter.ref, method: 'auto', evidence: byIdentifier[0].evidence, linkedAt: now });
      byIdentifier[0].card.updatedAt = now;
      continue;
    }
    if (byIdentifier.length > 1) {
      for (const match of byIdentifier) suggestions.push({ cardId: match.card.id, ref: encounter.ref, reason: `${match.evidence}, but it also matches another of your contacts`, confidence: 0.6 });
      continue;
    }
    const name = normalizedName(encounter.name);
    if (name.split(' ').length >= 2) {
      for (const card of eligible.filter((item) => normalizedName(item.name) === name)) {
        suggestions.push({ cardId: card.id, ref: encounter.ref, reason: 'Same name (names alone are never linked automatically)', confidence: 0.3 });
      }
    }
  }
  return { cards: next, suggestions };
}

export function confirmLink(card: ContactCard, ref: IdentityRef, now = new Date().toISOString()): ContactCard {
  const key = refKey(ref);
  return {
    ...card,
    rejected: card.rejected.filter((item) => item !== key),
    links: [...card.links.filter((link) => refKey(link.ref) !== key), { ref, method: 'confirmed', evidence: 'You confirmed this', linkedAt: now }],
    updatedAt: now,
  };
}

/** Undo or split: removes the link and remembers the choice. The card and the identity are unchanged. */
export function unlink(card: ContactCard, ref: IdentityRef, now = new Date().toISOString()): ContactCard {
  const key = refKey(ref);
  return { ...card, links: card.links.filter((link) => refKey(link.ref) !== key), rejected: [...new Set([...card.rejected, key])], updatedAt: now };
}

export function rejectSuggestion(card: ContactCard, ref: IdentityRef, now = new Date().toISOString()): ContactCard {
  return { ...card, rejected: [...new Set([...card.rejected, refKey(ref)])], updatedAt: now };
}

export function cardFor(cards: ContactCard[], ref: IdentityRef): ContactCard | undefined {
  const key = refKey(ref);
  return cards.find((card) => card.links.some((link) => refKey(link.ref) === key));
}

/** All identities the viewer has linked to the same card as `ref` (including `ref`). */
export function linkedIdentities(cards: ContactCard[], ref: IdentityRef): IdentityRef[] {
  const card = cardFor(cards, ref);
  return card ? card.links.map((link) => link.ref) : [ref];
}

/**
 * The name to show. A verified legal name only when its owner chose to show it, then the name
 * they declared, then their handle. The viewer's saved name is returned separately as a private
 * alias and never replaces a deliberately anonymous public identity.
 */
export function shownName(person: { disclosedLegalName?: string; declaredName?: string; handle?: string }, card?: ContactCard): { name: string; alias?: string } {
  const name = person.disclosedLegalName?.trim() || person.declaredName?.trim() || (person.handle ? `@${person.handle.replace(/^@/, '')}` : '') || card?.name || 'Someone';
  const alias = card && card.name && normalizedName(card.name) !== normalizedName(name) ? card.name : undefined;
  return { name, alias };
}

/** Imports device contacts into cards, keeping links, notes and choices on cards that already exist. */
export function importDeviceContacts(cards: ContactCard[], contacts: DeviceContactSnapshot[], newId: () => string, now = new Date().toISOString()): ContactCard[] {
  const byDevice = new Map(cards.filter((card) => card.deviceId).map((card) => [card.deviceId!, card]));
  const imported = contacts.map((contact): ContactCard => {
    const existing = byDevice.get(contact.id);
    const phones = [...new Set(contact.phones.map((item) => normalizePhone(item.value)).filter(Boolean))];
    const emails = [...new Set(contact.emails.map((item) => normalizeEmail(item.value)).filter(Boolean))];
    return existing
      ? { ...existing, name: contact.fullName || existing.name, phones, emails, updatedAt: now }
      : { id: newId(), source: 'device', deviceId: contact.id, name: contact.fullName || 'Unnamed contact', nicknames: [], phones, emails, notes: '', links: [], rejected: [], updatedAt: now };
  });
  const seen = new Set(contacts.map((contact) => contact.id));
  // Cards whose device contact was deleted keep only what the viewer added themselves.
  const kept = cards.filter((card) => card.source === 'manual' || (card.deviceId && !seen.has(card.deviceId) && (card.notes || card.links.some((link) => link.method === 'confirmed'))));
  return [...imported, ...kept.filter((card) => !card.deviceId || !seen.has(card.deviceId))];
}

/** Basic shape check for cards coming back from storage or an agent. */
export function isContactCard(value: unknown): value is ContactCard {
  const card = value as ContactCard;
  return Boolean(card) && typeof card.id === 'string' && typeof card.name === 'string' && Array.isArray(card.phones) && Array.isArray(card.emails)
    && Array.isArray(card.links) && Array.isArray(card.rejected) && Array.isArray(card.nicknames) && typeof card.notes === 'string';
}

const bridgedNetworks: BridgedNetwork[] = ['whatsapp', 'telegram', 'signal', 'gmessages', 'gvoice', 'instagram', 'messenger', 'linkedin', 'twitter', 'bluesky', 'slack', 'discord'];

/**
 * Who a one-to-one conversation is with, as an identity the viewer can link. Group chats have no
 * single person. WhatsApp chat ids are phone numbers, so they also carry that number.
 */
export function encounterForConversation(conversation: Conversation): Encounter | undefined {
  if (conversation.groupTitle || conversation.participants.length !== 1) return undefined;
  const person = conversation.participants[0];
  if (conversation.email) return { ref: { kind: 'email', address: conversation.email.address }, name: person.name, emails: [conversation.email.address] };
  const handle = person.identities.find((identity) => identity.source === 'open_media')?.value;
  if (handle) return { ref: { kind: 'open_media', handle: handle.replace(/^@/, '') }, name: person.name };
  const bridged = conversation.sourceSummary.find((source): source is BridgedNetwork => (bridgedNetworks as string[]).includes(source));
  if (bridged) {
    const id = person.id.replace(/^@/, '').split(':')[0].replace(new RegExp(`^${bridged}_`), '');
    return { ref: { kind: 'bridge', network: bridged, id }, name: person.name, phones: bridged === 'whatsapp' && /^\d{7,15}$/.test(id) ? [id] : [] };
  }
  return undefined;
}

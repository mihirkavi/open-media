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
  /**
   * A bridged chat. `phone` is the person's number when the chat reveals it but its id is not a
   * number (Signal and Google Messages name a one-to-one chat with the number; their ids are not).
   * It never changes the identity's key, so links and "not this person" choices stay put.
   */
  | { kind: 'bridge'; network: BridgedNetwork; id: string; phone?: string };

export interface ContactLink {
  ref: IdentityRef;
  method: 'auto' | 'confirmed';
  /** Why it was linked, shown when the viewer inspects the link (“Same email address”). */
  evidence: string;
  linkedAt: string;
}

/** Where a contact can be reached besides email and phone: an open network, Open Media or a bridged chat. */
export type HandleNetwork = NetworkId | 'open_media' | BridgedNetwork;

/** A handle the viewer saved on a contact (ADR 0023). On phone-number networks it is the number. */
export interface ContactHandle {
  network: HandleNetwork;
  handle: string;
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
  /** Handles on other networks (ADR 0023). Absent on cards saved before contacts were editable. */
  handles?: ContactHandle[];
  /**
   * The viewer's own card ("My Card", ADR 0023): their other addresses, numbers and accounts. Its
   * name always comes from their profile; it never stands for anyone else.
   */
  self?: boolean;
  /** A company, service or helpline rather than a person (ADR 0035): shown and exported as one. */
  company?: boolean;
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

/**
 * Two addresses are the same mailbox: case never matters, a "+tag" after the name is the same
 * inbox (priya+travel@ is priya@), and Gmail ignores dots in the name.
 */
export function sameEmail(left: string, right: string): boolean {
  const a = canonicalEmail(left);
  return Boolean(a) && a === canonicalEmail(right);
}

function canonicalEmail(value: string): string {
  const [local = '', domain = ''] = normalizeEmail(value).split('@');
  if (!local || !domain) return normalizeEmail(value);
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
  const name = local.split('+')[0] || local;
  return `${gmail ? name.replace(/\./g, '') : name}@${gmail ? 'gmail.com' : domain}`;
}

/**
 * Two numbers are the same when equal, or when one lacks a country code and the rest agree: the
 * last 10 digits, or a number written with its national trunk 0 (Israel's 052…, India's 098…, the
 * UK's 07…) that matches the end of the international form. Two numbers that both have a country
 * code must match exactly, so +1… and +91… with the same last digits stay different.
 */
export function samePhone(left: string, right: string): boolean {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  if (a.startsWith('+') && b.startsWith('+')) return digitsA === digitsB;
  if (digitsA.length >= 10 && digitsB.length >= 10 && digitsA.slice(-10) === digitsB.slice(-10)) return true;
  // A national number with its trunk 0 against an international one: 052 823 7744 is +972 52 823 7744.
  const [intl, local] = a.startsWith('+') ? [digitsA, digitsB] : b.startsWith('+') ? [digitsB, digitsA] : ['', ''];
  if (!intl || !/^0[1-9]/.test(local)) return false;
  const national = local.slice(1);
  const country = intl.slice(0, intl.length - national.length);
  return national.length >= 8 && intl.endsWith(national) && country.length >= 1 && country.length <= 3 && country[0] !== '0';
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
  // Links that point at one chat under two ids (ADR 0035) become one; the card counts as changed.
  const next = cards.map((card) => ({ ...card, links: oneLinkPerChat(card.links) }));
  const suggestions: LinkSuggestion[] = [];
  for (const encounter of encounters) {
    const key = refKey(encounter.ref);
    if (next.some((card) => card.links.some((link) => refKey(link.ref) === key || sameChat(link.ref, encounter.ref)) || (!card.rejected.includes(key) && holdsHandle(card, encounter.ref, { phones: false })))) continue;
    if (isMine(next, encounter.ref)) continue;
    const eligible = next.filter((card) => !card.self && !card.rejected.includes(key));
    const emails = emailsOf(encounter);
    const phones = phonesOf(encounter);
    const byIdentifier = eligible.flatMap((card) => {
      if (emails.some((email) => card.emails.some((saved) => sameEmail(saved, email)))) return [{ card, evidence: 'Same email address' }];
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

/** The number a bridged chat identity stands for: its own `phone`, or its id when the id is a number. */
function chatNumber(ref: IdentityRef): string | undefined {
  if (ref.kind !== 'bridge' || !phoneNetworks.has(ref.network)) return undefined;
  return ref.phone ?? (/^\+?\d{7,15}$/.test(ref.id) ? ref.id : undefined);
}

/**
 * Two identities are one chat: the same bridged network and the same id, or the same number (a
 * Signal chat first seen by its number, then by the person's own Signal id once they joined).
 */
export function sameChat(left: IdentityRef, right: IdentityRef): boolean {
  if (left.kind !== 'bridge' || right.kind !== 'bridge' || left.network !== right.network) return false;
  if (normalizeHandle(left.network, left.id) === normalizeHandle(right.network, right.id)) return true;
  const a = chatNumber(left);
  const b = chatNumber(right);
  return Boolean(a && b && samePhone(a, b));
}

/**
 * One link per chat. A link the viewer confirmed beats an automatic one; between equals, the
 * person's own chat id beats a number standing in for it. The number is kept on the link.
 */
function oneLinkPerChat(links: ContactLink[]): ContactLink[] {
  const out: ContactLink[] = [];
  for (const link of links) {
    const index = out.findIndex((kept) => sameChat(kept.ref, link.ref));
    if (index < 0) { out.push(link); continue; }
    const kept = out[index];
    const rank = (item: ContactLink) => (item.method === 'confirmed' ? 2 : 0) + (item.ref.kind === 'bridge' && !/^\+?\d{7,15}$/.test(item.ref.id) ? 1 : 0);
    const winner = rank(link) > rank(kept) ? link : kept;
    const number = chatNumber(kept.ref) ?? chatNumber(link.ref);
    out[index] = winner.ref.kind === 'bridge' && number && !winner.ref.phone && !/^\+?\d{7,15}$/.test(winner.ref.id) ? { ...winner, ref: { ...winner.ref, phone: number } } : winner;
  }
  return out;
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

/** Networks whose chat ids are phone numbers, so a saved phone number reaches the person there too. */
export const phoneNetworks: ReadonlySet<HandleNetwork> = new Set(['whatsapp', 'signal', 'gmessages', 'gvoice']);

/** A handle as it is compared: no leading @, lower case, and phone numbers in one format. */
export function normalizeHandle(network: HandleNetwork, value: string): string {
  const trimmed = value.trim().replace(/^@/, '');
  return phoneNetworks.has(network) && /^\+?[\d\s().-]{7,}$/.test(trimmed) ? normalizePhone(trimmed) : trimmed.toLowerCase();
}

/**
 * True when a handle saved on the card is this identity. With `phones`, a number saved on the card
 * also counts on networks whose chat ids are phone numbers.
 */
export function holdsHandle(card: ContactCard, ref: IdentityRef, { phones = true } = {}): boolean {
  if (ref.kind === 'phone' || ref.kind === 'email') return false;
  const network: HandleNetwork = ref.kind === 'open_media' ? 'open_media' : ref.network;
  const value = normalizeHandle(network, ref.kind === 'bridge' ? ref.id : ref.handle);
  if (!value) return false;
  if ((card.handles ?? []).some((item) => item.network === network && (normalizeHandle(network, item.handle) === value || (phoneNetworks.has(network) && samePhone(item.handle, value))))) return true;
  if (ref.kind !== 'bridge' || !phoneNetworks.has(network)) return false;
  // The chat's own number (a Signal chat named with it), saved as a handle on that network or, with `phones`, as a phone.
  const number = ref.phone && /^\+?\d{7,15}$/.test(normalizePhone(ref.phone)) ? ref.phone : undefined;
  if (number && (card.handles ?? []).some((item) => item.network === network && samePhone(item.handle, number))) return true;
  if (!phones) return false;
  return (/^\+?\d{7,15}$/.test(value) && card.phones.some((phone) => samePhone(phone, value))) || Boolean(number && card.phones.some((phone) => samePhone(phone, number)));
}

/** True when the card holds this identity directly: as an email, phone or handle saved on it. */
export function holdsRef(card: ContactCard, ref: IdentityRef): boolean {
  if (card.rejected.includes(refKey(ref))) return false;
  if (ref.kind === 'email') return card.emails.some((email) => sameEmail(email, ref.address));
  if (ref.kind === 'phone') return card.phones.some((phone) => samePhone(phone, ref.number));
  return holdsHandle(card, ref);
}

/**
 * The viewer's card for this identity: the one it is linked to, else the only card that holds it
 * as an email, phone or handle. When two cards hold it, neither is chosen (ADR 0023).
 */
export function cardFor(cards: ContactCard[], ref: IdentityRef): ContactCard | undefined {
  if (isMine(cards, ref)) return undefined;
  const others = cards.filter((card) => !card.self);
  const key = refKey(ref);
  const linked = others.find((card) => card.links.some((link) => refKey(link.ref) === key)) ?? others.find((card) => card.links.some((link) => sameChat(link.ref, ref)));
  if (linked) return linked;
  const holding = others.filter((card) => holdsRef(card, ref));
  return holding.length === 1 ? holding[0] : undefined;
}

/** The viewer's own card, if they made one. */
export function selfCard(cards: ContactCard[]): ContactCard | undefined {
  return cards.find((card) => card.self);
}

/**
 * True when this identity is the viewer's own: on their own card, as a link, email, number or
 * handle. Their own identities are never matched to anyone else, merged or suggested as a contact.
 */
export function isMine(cards: ContactCard[], ref: IdentityRef): boolean {
  const mine = selfCard(cards);
  if (!mine) return false;
  const key = refKey(ref);
  return mine.links.some((link) => refKey(link.ref) === key) || holdsRef(mine, ref);
}

/** The viewer's own email addresses from their card, so mail from them reads as sent by the viewer. */
export function ownEmails(cards: ContactCard[]): string[] {
  return (selfCard(cards)?.emails ?? []).map(normalizeEmail).filter(Boolean);
}

/** How the viewer's own card is shown: their profile name with "(Me)", as in Apple Contacts. */
export function selfLabel(profileName: string): string {
  return `${profileName.trim() || 'Me'} (Me)`;
}

const openNetworks: ReadonlySet<HandleNetwork> = new Set(['farcaster', 'lens', 'hive', 'deso']);

/** The identity a saved handle stands for. */
export function handleRef(item: ContactHandle): IdentityRef {
  const handle = item.handle.trim().replace(/^@/, '');
  if (item.network === 'open_media') return { kind: 'open_media', handle };
  if (openNetworks.has(item.network)) return { kind: 'network', network: item.network as NetworkId, handle };
  return { kind: 'bridge', network: item.network as BridgedNetwork, id: normalizeHandle(item.network, handle) };
}

/** Every identity on a card: its links, then the handles saved on it. */
export function cardRefs(card: ContactCard): IdentityRef[] {
  const refs = [...card.links.map((link) => link.ref), ...(card.handles ?? []).filter((item) => item.handle.trim()).map(handleRef)];
  const seen = new Set<string>();
  return refs.filter((ref) => !seen.has(refKey(ref)) && Boolean(seen.add(refKey(ref))));
}

/** All identities on the same card as `ref` (including `ref`). */
export function linkedIdentities(cards: ContactCard[], ref: IdentityRef): IdentityRef[] {
  const card = cardFor(cards, ref);
  const refs = card ? cardRefs(card) : [];
  return refs.some((item) => refKey(item) === refKey(ref)) ? refs : [ref, ...refs];
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

/**
 * The name the viewer gave a contact, or '' when they gave none: a card whose "name" is only an
 * email address or phone number (saved before they typed a name) has no name to show.
 */
export function contactName(card: ContactCard | undefined): string {
  const name = card?.name.trim() ?? '';
  return name && !name.includes('@') && !/^\+?[\d\s().-]{5,}$/.test(name) ? name : '';
}

/** How a contact is listed: its name, else its first email address or number. */
export function contactLabel(card: ContactCard): string {
  return contactName(card) || card.emails[0] || card.phones[0] || card.handles?.[0]?.handle || 'Unnamed contact';
}

/** Picks the fullest name a platform gives: a real name before a handle, number, id or address. */
export function fullerName(...candidates: (string | undefined)[]): string {
  const values = candidates.map((value) => value?.trim() ?? '').filter(Boolean);
  return values.find(looksLikeName) ?? values[0] ?? '';
}

function looksLikeName(value: string): boolean {
  return /\p{L}/u.test(value) && !value.includes('@') && !/^\+?[\d\s().-]{5,}$/.test(value) && !/^[a-z0-9_]+_\d{5,}$/i.test(value);
}

/** Basic shape check for cards coming back from storage or an agent. */
export function isContactCard(value: unknown): value is ContactCard {
  const card = value as ContactCard;
  return Boolean(card) && typeof card.id === 'string' && typeof card.name === 'string' && Array.isArray(card.phones) && Array.isArray(card.emails)
    && Array.isArray(card.links) && Array.isArray(card.rejected) && Array.isArray(card.nicknames) && typeof card.notes === 'string';
}

const bridgedNetworks: BridgedNetwork[] = ['whatsapp', 'telegram', 'signal', 'gmessages', 'gvoice', 'instagram', 'messenger', 'linkedin', 'twitter', 'bluesky', 'slack', 'discord'];

/**
 * The identity behind one person in a conversation: their email address in email, their chat id
 * on a bridged network, their handle on Open Media. Used for people in groups too.
 */
export function refForParticipant(conversation: Conversation, person: Conversation['participants'][number]): IdentityRef | undefined {
  const email = person.identities.find((identity) => identity.kind === 'email')?.value;
  if (conversation.email && email) return { kind: 'email', address: email };
  const handle = person.identities.find((identity) => identity.source === 'open_media')?.value;
  if (handle) return { kind: 'open_media', handle: handle.replace(/^@/, '') };
  const bridged = conversation.sourceSummary.find((source): source is BridgedNetwork => (bridgedNetworks as string[]).includes(source));
  if (bridged) return bridgeRef(bridged, person);
  return undefined;
}

/** A bridged chat person as an identity: their chat id, and their number when the chat gives one. */
function bridgeRef(network: BridgedNetwork, person: Conversation['participants'][number]): Extract<IdentityRef, { kind: 'bridge' }> {
  const id = person.id.replace(/^@/, '').split(':')[0].replace(new RegExp(`^${network}_`), '');
  const phone = phoneNetworks.has(network) ? person.identities.find((identity) => identity.kind === 'phone')?.value : undefined;
  return phone && normalizePhone(phone) !== normalizePhone(id) ? { kind: 'bridge', network, id, phone } : { kind: 'bridge', network, id };
}

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
    const ref = bridgeRef(bridged, person);
    const phones = [...(phoneNetworks.has(bridged) && /^\+?\d{7,15}$/.test(ref.id) ? [ref.id] : []), ...(ref.phone ? [ref.phone] : [])];
    return { ref, name: person.name, phones };
  }
  return undefined;
}

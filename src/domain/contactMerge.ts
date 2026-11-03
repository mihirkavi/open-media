import { normalizeEmail, normalizePhone } from './contactCleaning';
import { bridgedSourceOf } from './bridgedChats';
import { Conversation, MessageSource, Person } from './models';
import { cardFor, ContactCard, contactLabel, contactName, ContactHandle, encounterForConversation, HandleNetwork, normalizeHandle, refForParticipant, sameEmail, samePhone } from './people';

export { fullerName } from './people';

/**
 * One conversation per person (ADR 0023). Every one-to-one chat or email whose identity belongs to
 * exactly one of the viewer's contacts joins that contact's conversation. The original
 * conversations stay as its channels: replies go back through one of them, and nothing about the
 * originals changes.
 */

/** True when this conversation can take a reply from here. */
export function canReply(conversation: Conversation): boolean {
  return conversation.sourceSummary.includes('open_media')
    || conversation.sourceSummary.includes('matrix')
    || Boolean(bridgedSourceOf(conversation))
    || Boolean(conversation.email?.canSend);
}

/**
 * The contact a conversation belongs to, if it is one-to-one and exactly one contact holds it.
 * An email thread can carry several addresses of the same sender (a company writing from two
 * mailboxes, an alias): any of them counts, as long as they all point at the same contact.
 */
export function contactForConversation(cards: ContactCard[], conversation: Conversation): ContactCard | undefined {
  if (conversation.email?.recipients && conversation.email.recipients.length > 1) return undefined;
  const encounter = encounterForConversation(conversation);
  if (!encounter) return undefined;
  const direct = cardFor(cards, encounter.ref);
  if (direct || !conversation.email) return direct;
  const found = new Map<string, ContactCard>();
  for (const identity of conversation.participants[0].identities) {
    if (identity.kind !== 'email') continue;
    const card = cardFor(cards, { kind: 'email', address: identity.value });
    if (card) found.set(card.id, card);
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
}

/**
 * Group chats and group emails keep their own conversation, but each person in them who is one of
 * the viewer's contacts shows under the contact's name, in the title, the sender lines and the
 * preview. A group a person named themselves (a bridged room's name) keeps that name.
 */
function withContactNames(conversation: Conversation, cards: ContactCard[]): Conversation {
  if (conversation.participants.length < 2) return conversation;
  let changed = false;
  const renamed = new Map<string, { from: string; to: string }>();
  const participants = conversation.participants.map((person) => {
    const ref = refForParticipant(conversation, person);
    const name = ref ? contactName(cardFor(cards, ref)) : '';
    if (!name || name === person.name) return person;
    changed = true;
    renamed.set(person.id, { from: person.name, to: name });
    return { ...person, name, initials: initialsOf(name) };
  });
  if (!changed) return conversation;
  // Email groups are titled from their people; bridged groups carry the room's own name.
  const groupTitle = conversation.email && conversation.groupTitle ? titleFor(participants.map((person) => person.name)) : conversation.groupTitle;
  const latest = conversation.messages[conversation.messages.length - 1];
  const author = latest?.direction === 'inbound' ? renamed.get(latest.senderPersonId) : undefined;
  const oldPrefix = author ? `${firstName(author.from)}: ` : '';
  const preview = author && conversation.preview.startsWith(oldPrefix) ? `${firstName(author.to)}: ${conversation.preview.slice(oldPrefix.length)}` : conversation.preview;
  return { ...conversation, participants, groupTitle, preview };
}

function firstName(name: string): string {
  return name.includes('@') ? name : name.split(' ')[0];
}

/** "Ana, Bo and Cy", or "Ana, Bo and 3 others", from first names (as email groups are titled). */
function titleFor(names: string[]): string {
  const first = [...names].sort((a, b) => a.localeCompare(b)).map(firstName);
  if (first.length <= 3) return first.length === 2 ? first.join(' and ') : `${first.slice(0, -1).join(', ')} and ${first.at(-1)}`;
  return `${first.slice(0, 2).join(', ')} and ${first.length - 2} others`;
}

/**
 * Merges conversations by contact. A contact with one conversation keeps it (under the contact's
 * name); a contact with several gets one conversation, `contact:<id>`, holding all of their
 * messages in time order, with the originals as its channels. Groups are never merged.
 */
export function mergeByContact(conversations: Conversation[], cards: ContactCard[]): Conversation[] {
  if (!cards.length) return conversations;
  const byCard = new Map<string, { card: ContactCard; members: Conversation[] }>();
  const out: (Conversation | string)[] = [];
  for (const conversation of conversations) {
    const card = contactForConversation(cards, conversation);
    if (!card) { out.push(withContactNames(conversation, cards)); continue; }
    const group = byCard.get(card.id);
    if (group) group.members.push(conversation);
    else { byCard.set(card.id, { card, members: [conversation] }); out.push(card.id); }
  }
  return out.map((item) => {
    if (typeof item !== 'string') return item;
    const { card, members } = byCard.get(item)!;
    return members.length === 1 ? named(members[0], card) : merged(card, members);
  }).sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

function named(conversation: Conversation, card: ContactCard): Conversation {
  const name = contactName(card);
  if (!name) return { ...conversation, contactId: card.id };
  return { ...conversation, contactId: card.id, participants: conversation.participants.map((person) => ({ ...person, name, initials: initialsOf(name) })) };
}

function merged(card: ContactCard, members: Conversation[]): Conversation {
  const channels = [...members].sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  const latest = channels[0];
  const people = channels.map((channel) => channel.participants[0]).filter(Boolean);
  const name = contactName(card) || people[0]?.name || 'Someone';
  // A person's picture, not a company's: Open Media and chat pictures before email logos.
  const pictured = people.find((person) => person.avatarUrls?.length && !person.verifiedDomain) ?? people.find((person) => person.avatarUrls?.length);
  const person: Person = {
    ...people[0],
    name,
    initials: initialsOf(name),
    identities: people.flatMap((item) => item.identities),
    avatarUrls: pictured?.avatarUrls,
    verified: people.some((item) => item.verified),
    // A company's verified mark belongs to its mail, not to a person's merged conversation.
    verifiedDomain: undefined,
    favorite: people.some((item) => item.favorite),
  };
  const sources: MessageSource[] = [];
  for (const channel of channels) for (const source of channel.sourceSummary) if (!sources.includes(source)) sources.push(source);
  return {
    id: `contact:${card.id}`,
    contactId: card.id,
    participants: [person],
    // Each message keeps the channel it belongs to, so a reply to it goes back the same way.
    messages: channels.flatMap((channel) => channel.messages.map((message) => message.conversationId === channel.id ? message : { ...message, conversationId: channel.id })).sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)),
    sourceSummary: sources,
    lastMessageAt: latest.lastMessageAt,
    preview: latest.preview,
    unreadCount: channels.reduce((total, channel) => total + channel.unreadCount, 0),
    starred: channels.some((channel) => channel.starred) || undefined,
    labels: [...new Set(channels.flatMap((channel) => channel.labels))],
    channels,
  };
}

/** The channel a conversation is in, by the original conversation's id. */
export function channelOf(conversation: Conversation, conversationId: string): Conversation | undefined {
  return conversation.channels?.find((channel) => channel.id === conversationId) ?? (conversation.id === conversationId ? conversation : undefined);
}

/**
 * Where a reply goes by default: the channel the person last wrote from, among those that can
 * take a reply; else the most recent channel that can; else the most recent.
 */
export function defaultChannel(conversation: Conversation): Conversation {
  const channels = conversation.channels ?? [conversation];
  const lastInbound = (channel: Conversation) => Math.max(0, ...channel.messages.filter((message) => message.direction === 'inbound').map((message) => Date.parse(message.sentAt)));
  const replyable = channels.filter(canReply);
  const pool = replyable.length ? replyable : channels;
  return [...pool].sort((a, b) => lastInbound(b) - lastInbound(a) || Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))[0];
}

function initialsOf(name: string): string {
  return name.replace(/^@/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

// Editing a contact (ADR 0023): what the person typed, cleaned up and checked.

export interface ContactDraft {
  name: string;
  emails: string[];
  phones: string[];
  handles: ContactHandle[];
  notes: string;
}

export function draftOf(card: ContactCard): ContactDraft {
  return { name: contactName(card), emails: [...card.emails], phones: [...card.phones], handles: (card.handles ?? []).map((item) => ({ ...item })), notes: card.notes };
}

const emailPattern = /^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/;

/** Problems that stop a draft from saving, in the order they appear on screen. */
export function draftProblems(draft: ContactDraft): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push('Add a name.');
  for (const email of draft.emails) if (email.trim() && !emailPattern.test(email.trim())) problems.push(`“${email.trim()}” isn’t an email address.`);
  for (const phone of draft.phones) if (phone.trim() && normalizePhone(phone).replace(/\D/g, '').length < 7) problems.push(`“${phone.trim()}” isn’t a full phone number.`);
  for (const item of draft.handles) if (item.handle.trim() && /\s/.test(item.handle.trim().replace(/^@/, '')) && !/^\+?[\d\s().-]+$/.test(item.handle.trim())) problems.push(`“${item.handle.trim()}” has a space in it.`);
  return problems;
}

/** Applies a draft: trims, normalizes and removes duplicates and empty rows. Links and choices are kept. */
export function applyDraft(card: ContactCard, draft: ContactDraft, now = new Date().toISOString()): ContactCard {
  const unique = <T>(values: T[], key: (value: T) => string) => { const seen = new Set<string>(); return values.filter((value) => { const id = key(value); if (!id || seen.has(id)) return false; seen.add(id); return true; }); };
  const handles = unique(
    draft.handles.map((item) => ({ network: item.network, handle: cleanHandle(item.network, item.handle) })),
    (item) => item.handle ? `${item.network}:${normalizeHandle(item.network, item.handle)}` : '',
  );
  return {
    ...card,
    name: draft.name.trim().replace(/\s+/g, ' '),
    emails: unique(draft.emails.map(normalizeEmail), (value) => value),
    phones: unique(draft.phones.map((value) => value.trim()).filter(Boolean), (value) => normalizePhone(value).replace(/\D/g, '').slice(-10)),
    handles,
    notes: draft.notes.trim(),
    updatedAt: now,
  };
}

/** Kept as typed, without a leading @; comparisons use normalizeHandle. */
function cleanHandle(_network: HandleNetwork, value: string): string {
  return value.trim().replace(/^@/, '');
}

/** Which other contacts already hold an identifier in this draft, so the editor can say so. */
export function sharedWith(cards: ContactCard[], cardId: string, draft: ContactDraft): { value: string; contact: string }[] {
  const out: { value: string; contact: string }[] = [];
  for (const other of cards) {
    if (other.id === cardId) continue;
    for (const email of draft.emails) if (email.trim() && other.emails.some((saved) => normalizeEmail(saved) === normalizeEmail(email))) out.push({ value: email.trim(), contact: contactLabel(other) });
    for (const phone of draft.phones) if (phone.trim() && other.phones.some((saved) => samePhone(saved, phone))) out.push({ value: phone.trim(), contact: contactLabel(other) });
    for (const item of draft.handles) if (item.handle.trim() && (other.handles ?? []).some((saved) => saved.network === item.network && normalizeHandle(saved.network, saved.handle) === normalizeHandle(item.network, item.handle))) out.push({ value: item.handle.trim(), contact: contactLabel(other) });
  }
  return out;
}

// Suggestions for a new email's To field (ADR 0023).

export interface RecipientSuggestion { address: string; name: string; initials: string; avatarUrls: string[] }

/**
 * Who the To field offers: every email address on the viewer's contacts, under the contact's
 * name, then the people they have emailed with. Someone in both appears once, under the contact's
 * name and with their picture from mail. A contact with no name is offered by address.
 */
export function recipientSuggestions(emailed: RecipientSuggestion[], cards: ContactCard[]): RecipientSuggestion[] {
  const out: RecipientSuggestion[] = [];
  const seen = new Set<string>();
  const add = (item: RecipientSuggestion) => {
    const address = normalizeEmail(item.address);
    if (!address || seen.has(address)) return;
    seen.add(address);
    out.push({ ...item, address });
  };
  const named = [...cards].filter((card) => card.emails.length).sort((a, b) => contactLabel(a).localeCompare(contactLabel(b)));
  for (const card of named) {
    const name = contactName(card);
    for (const address of card.emails) {
      const known = emailed.find((item) => sameEmail(item.address, address));
      const shown = name || known?.name || address;
      add({ address, name: shown, initials: initialsOf(shown), avatarUrls: known?.avatarUrls ?? [] });
    }
  }
  for (const item of emailed) {
    const name = contactName(cardFor(cards, { kind: 'email', address: item.address }));
    add(name ? { ...item, name, initials: initialsOf(name) } : item);
  }
  return out;
}

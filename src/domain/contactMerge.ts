import { normalizeEmail, normalizePhone } from './contactCleaning';
import { bridgedSourceOf } from './bridgedChats';
import { Conversation, MessageSource, Person } from './models';
import { cardFor, ContactCard, ContactHandle, encounterForConversation, HandleNetwork, normalizeHandle, samePhone } from './people';

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

/** The contact a conversation belongs to, if it is one-to-one and exactly one contact holds it. */
export function contactForConversation(cards: ContactCard[], conversation: Conversation): ContactCard | undefined {
  if (conversation.email?.recipients && conversation.email.recipients.length > 1) return undefined;
  const encounter = encounterForConversation(conversation);
  return encounter ? cardFor(cards, encounter.ref) : undefined;
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
    if (!card) { out.push(conversation); continue; }
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
  const name = card.name.trim();
  if (!name) return { ...conversation, contactId: card.id };
  return { ...conversation, contactId: card.id, participants: conversation.participants.map((person) => ({ ...person, name, initials: initialsOf(name) })) };
}

function merged(card: ContactCard, members: Conversation[]): Conversation {
  const channels = [...members].sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  const latest = channels[0];
  const people = channels.map((channel) => channel.participants[0]).filter(Boolean);
  const name = card.name.trim() || people[0]?.name || 'Someone';
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
  return { name: card.name, emails: [...card.emails], phones: [...card.phones], handles: (card.handles ?? []).map((item) => ({ ...item })), notes: card.notes };
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
    for (const email of draft.emails) if (email.trim() && other.emails.some((saved) => normalizeEmail(saved) === normalizeEmail(email))) out.push({ value: email.trim(), contact: other.name });
    for (const phone of draft.phones) if (phone.trim() && other.phones.some((saved) => samePhone(saved, phone))) out.push({ value: phone.trim(), contact: other.name });
    for (const item of draft.handles) if (item.handle.trim() && (other.handles ?? []).some((saved) => saved.network === item.network && normalizeHandle(saved.network, saved.handle) === normalizeHandle(item.network, item.handle))) out.push({ value: item.handle.trim(), contact: other.name });
  }
  return out;
}

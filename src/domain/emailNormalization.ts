import { StoredMailMessage } from '../connectors/mailApiConnector';
import { emailPreview } from './emailBody';
import { Conversation, MessageSource, Person } from './models';
import { isPersonalMailDomain, senderIconUrls } from './senderIcons';

/** Mailbox names companies send from; mail from these joins one chat per company. */
const roleAddress = /^(no-?reply|do-?not-?reply|news(letter)?s?|info|hello|hi|team|support|help|care|service|notifications?|notify|alerts?|updates?|orders?|billing|receipts?|accounts?|marketing|offers?|deals|promo(tions)?|mail(er)?|contact|feedback|community|digest|security|bounce|reply|members?)([._+-].*)?$/i;

/** Who a message is with: one chat per person, or one per company for company mail. */
export function correspondentKey(address: string, verified = false): { key: string; company?: string } {
  const [local = '', domain = ''] = address.toLowerCase().split('@');
  if (!domain) return { key: `address:${address.toLowerCase()}` };
  const organization = domain.split('.').slice(-2).join('.');
  if (isPersonalMailDomain(domain)) return { key: `address:${address.toLowerCase()}` };
  const subdomainSender = domain !== organization;
  if (verified || roleAddress.test(local) || subdomainSender) return { key: `company:${organization}`, company: organization };
  return { key: `address:${address.toLowerCase()}` };
}

/**
 * Turns stored email (inbound and sent, across every connected mailbox) into
 * people-first conversations: one per person, one per company for company
 * mail, and one group per set of people when an email includes several (To and
 * Cc), with both directions in order.
 */
export function normalizeStoredEmail(messages: StoredMailMessage[], { iconService, alsoMine = [] }: { iconService?: string; alsoMine?: string[] } = {}): Conversation[] {
  // Your own other addresses (from your own contact card, ADR 0023) are you, not someone you write to.
  const own = ownAddresses(messages);
  for (const address of alsoMine) if (address.trim()) own.add(address.trim().toLowerCase());
  const names = knownNames(messages);
  const groups = new Map<string, { key: string; company?: string; people: string[]; toSelf: boolean; items: Array<StoredMailMessage & { address: string }> }>();
  for (const message of messages) {
    const outbound = own.has(extractEmail(message.from));
    const people = othersIn(message, own);
    // A group is everyone else on the email; a direct chat is the one other person (or company).
    const group = people.length > 1;
    // Mail only between your own addresses is a note to yourself, kept under the address it went to.
    const toSelf = outbound && !people.length ? [...message.to, message.from].map(extractEmail).find(Boolean) : undefined;
    const address = (outbound ? people[0] ?? toSelf : extractEmail(message.from) || message.from) || (outbound ? 'unknown-recipient' : 'unknown-sender');
    const { key, company } = group ? { key: groupKey(people), company: undefined } : correspondentKey(address, Boolean(message.senderVerified));
    const entry = groups.get(key) ?? { key, company, people: group ? people : [], toSelf: true, items: [] };
    entry.toSelf &&= Boolean(toSelf);
    entry.items.push({ ...message, address });
    groups.set(key, entry);
  }

  return [...groups.values()].map(({ key, company, people, toSelf, items }) => {
    const unique = [...new Map(items.map((item) => [`${item.accountId}:${item.sourceMessageId}`, item])).values()];
    const ordered = unique.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    const isOutbound = (item: StoredMailMessage) => own.has(extractEmail(item.from));
    const inboundItems = ordered.filter((item) => !isOutbound(item));
    const latestInbound = inboundItems.at(-1);
    const latest = ordered.at(-1)!;
    const replyTarget = latestInbound ?? latest;
    const source: MessageSource = /@(icloud|me|mac)\.com$/i.test(replyTarget.accountEmail) ? 'icloud' : /@(gmail|googlemail)\.com$/i.test(replyTarget.accountEmail) ? 'gmail' : 'imap';
    const conversationId = `mail-conversation-${stableID(key)}`;
    const identity = (personId: string, value: string) => ({ id: `mail-identity-${stableID(value)}`, personId, kind: 'email' as const, value, source, label: replyTarget.accountEmail, verifiedByUser: false });

    let participants: Person[];
    let personFor: (address: string) => string;
    if (people.length) {
      participants = people.map((address) => {
        const personId = personIdFor(address);
        const verified = [...inboundItems].reverse().find((item) => item.address === address && item.senderVerified);
        const name = names.get(address) || address;
        return {
          id: personId, name, initials: initialsFor(name), avatarColor: colorFor(address), identities: [identity(personId, address)],
          ...(verified ? { verifiedDomain: address.split('@')[1] } : {}),
          avatarUrls: senderIconUrls(address, verified?.senderLogoUrl, iconService),
        };
      });
      // A stable order, so the group's name doesn't change with whoever wrote last.
      participants.sort((first, second) => first.name.localeCompare(second.name));
      personFor = personIdFor;
    } else {
      const verified = [...inboundItems].reverse().find((item) => item.senderVerified);
      // The newest name the sender gave; mail stored as a bare address falls back to the company or address.
      const givenName = [...inboundItems].reverse().map((item) => extractName(item.from)).find(Boolean) || names.get(replyTarget.address);
      const name = givenName || (company ? brandName(company) : replyTarget.address);
      const personId = `mail-person-${stableID(key)}`;
      participants = [{
        id: personId, name, initials: initialsFor(name), avatarColor: colorFor(key),
        identities: [...new Set(ordered.map((item) => item.address))].map((value) => identity(personId, value)),
        ...(verified ? { verifiedDomain: verified.address.split('@')[1] } : {}),
        avatarUrls: senderIconUrls(replyTarget.address, verified?.senderLogoUrl, iconService),
      }];
      personFor = () => personId;
    }
    const byId = new Map(participants.map((person) => [person.id, person]));
    const latestText = emailPreview(latest.text, '') || attachmentPreview(latest);
    // In a group, the preview says who wrote last, like iMessage.
    const latestAuthor = people.length && !isOutbound(latest) ? byId.get(personFor(extractEmail(latest.from)))?.name.split(' ')[0] : undefined;
    return {
      id: conversationId,
      participants, sourceSummary: [source], lastMessageAt: latest.sentAt,
      ...(people.length ? { groupTitle: groupTitle(participants) } : {}),
      preview: latestAuthor ? `${latestAuthor}: ${latestText}` : latestText, unreadCount: inboundItems.filter((item) => item.unread).length, labels: [],
      email: {
        accountId: replyTarget.accountId, accountEmail: replyTarget.accountEmail, address: replyTarget.address, latestSubject: replyTarget.subject, latestMessageId: replyTarget.sourceMessageId,
        ...(people.length ? { recipients: people } : {}),
        ...(toSelf ? { toSelf: true } : {}),
      },
      messages: linkReplies(ordered.map((message) => {
        const outbound = isOutbound(message);
        const senderPersonId = outbound ? 'me' : personFor(message.address);
        return {
          id: `mail-message-${stableID(`${message.accountId}:${message.sourceMessageId}`)}`, sourceMessageId: message.sourceMessageId,
          conversationId, senderPersonId, senderIdentityId: outbound ? 'me' : `mail-identity-${stableID(message.address)}`,
          recipientPersonIds: outbound ? participants.map((person) => person.id) : ['me'], sentAt: message.sentAt, body: message.text, source, channel: 'email' as const,
          emailContext: { providerThreadId: message.sourceMessageId, subject: message.subject || '(No subject)', address: message.address, accountId: message.accountId, accountEmail: message.accountEmail },
          attachments: (message.attachments ?? []).map((item) => ({ name: item.filename, contentType: item.contentType, size: item.size, storagePath: item.storagePath, inline: item.inline })),
          remoteImages: message.remoteImages ?? [],
          direction: outbound ? 'outbound' as const : 'inbound' as const, deliveryState: outbound ? 'sent' as const : 'received' as const,
          inReplyTo: message.inReplyTo,
        };
      })),
    };
  });
}

/** Unread mail in a conversation's email channels, by mailbox, for marking it read when opened (ADR 0026). */
export function unreadMailIn(conversation: Conversation, stored: StoredMailMessage[]): Map<string, string[]> {
  const unread = new Set(stored.filter((message) => message.unread).map((message) => `${message.accountId}:${message.sourceMessageId}`));
  const byAccount = new Map<string, string[]>();
  for (const channel of conversation.channels ?? [conversation]) {
    if (!channel.email) continue;
    for (const message of channel.messages) {
      const accountId = message.emailContext?.accountId;
      if (message.direction !== 'inbound' || !accountId || !unread.has(`${accountId}:${message.sourceMessageId}`)) continue;
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), message.sourceMessageId]);
    }
  }
  return byAccount;
}

/** The conversation an email to these addresses lands in, so a new message can open it. */
export function emailConversationId(addresses: string[]): string {
  const people = [...new Set(addresses.map((address) => extractEmail(address)).filter(Boolean))];
  return `mail-conversation-${stableID(people.length > 1 ? groupKey(people) : correspondentKey(people[0] ?? '').key)}`;
}

/** A subject for a new email written like a message: its first line, cut at a word. */
export function subjectFromBody(body: string): string {
  const line = body.trim().split('\n')[0].trim();
  if (line.length <= 60) return line || 'Message';
  return `${line.slice(0, 60).replace(/\s+\S*$/, '')}…`;
}

/** Every address that is you: each connected mailbox, and whoever sent your Sent mail (aliases). */
function ownAddresses(messages: StoredMailMessage[]): Set<string> {
  const own = new Set(messages.map((message) => message.accountEmail.toLowerCase()));
  for (const message of messages) if (message.mailbox === 'Sent') own.add(extractEmail(message.from));
  own.delete('');
  return own;
}

/** Everyone else on an email, sender first, then To and Cc. */
function othersIn(message: StoredMailMessage, own: Set<string>): string[] {
  return [...new Set([message.from, ...message.to].map((value) => extractEmail(value)).filter((address) => address && !own.has(address)))];
}

/** The newest display name seen for each address, from senders and recipients alike. */
function knownNames(messages: StoredMailMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  const ordered = [...messages].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  for (const message of ordered) {
    for (const value of [message.from, ...message.to]) {
      const name = extractName(value);
      if (name) names.set(extractEmail(value), name);
    }
  }
  return names;
}

function groupKey(addresses: string[]): string {
  return `group:${[...addresses].sort().join(',')}`;
}

function personIdFor(address: string): string {
  // The same id as this person's one-to-one chat, so they are one person everywhere.
  return `mail-person-${stableID(correspondentKey(address).key)}`;
}

/** "Ana, Bo and Cy", or "Ana, Bo and 3 others", from first names. */
function groupTitle(people: Person[]): string {
  const first = people.map((person) => (person.name.includes('@') ? person.name : person.name.split(' ')[0]));
  if (first.length <= 3) return first.length === 2 ? first.join(' and ') : `${first.slice(0, -1).join(', ')} and ${first.at(-1)}`;
  return `${first.slice(0, 2).join(', ')} and ${first.length - 2} others`;
}

/** Points each reply at the message it quotes (by Message-ID) when that message is in the same chat. */
function linkReplies<T extends { id: string; sourceMessageId: string; inReplyTo?: string }>(messages: T[]): Array<Omit<T, 'inReplyTo'> & { replyToMessageId?: string }> {
  const bySource = new Map(messages.map((message) => [message.sourceMessageId, message.id]));
  return messages.map(({ inReplyTo, ...message }) => {
    const replyTo = inReplyTo ? bySource.get(inReplyTo) : undefined;
    return replyTo && replyTo !== message.id ? { ...message, replyToMessageId: replyTo } : message;
  });
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim() || '(No subject)';
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function extractEmail(value: string): string { return value.match(/<([^>]+)>/)?.[1]?.trim().toLocaleLowerCase() ?? (value.includes('@') ? value.trim().toLocaleLowerCase() : ''); }
function attachmentPreview(message: StoredMailMessage): string {
  const count = message.attachments?.length ?? 0;
  if (!count) return message.subject;
  const images = message.attachments!.filter((item) => item.contentType.startsWith('image/')).length;
  return images === count ? (count === 1 ? 'Photo' : `${count} photos`) : (count === 1 ? 'Attachment' : `${count} attachments`);
}
function brandName(organization: string): string { const label = organization.split('.')[0]; return label.charAt(0).toUpperCase() + label.slice(1); }
/** The display name in "Name <address>", or '' when there is only an address. */
function extractName(value: string): string { const name = value.replace(/<[^>]+>/, '').trim().replace(/^['"]|['"]$/g, '').trim(); return name.includes('@') ? '' : name; }
function initialsFor(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'; }
function stableID(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0).toString(36); }
function colorFor(value: string): string { const colors = ['#7B61FF','#EB5757','#F2994A','#27AE60','#2F80ED','#9B51E0']; return colors[parseInt(stableID(value), 36) % colors.length]; }

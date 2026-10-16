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
 * people-first conversations: one per person, or one per company for company
 * mail, with both directions in order.
 */
export function normalizeStoredEmail(messages: StoredMailMessage[]): Conversation[] {
  const groups = new Map<string, { key: string; company?: string; items: Array<StoredMailMessage & { address: string }> }>();
  for (const message of messages) {
    const own = message.accountEmail.toLowerCase();
    const outbound = extractEmail(message.from) === own;
    const address = outbound
      ? extractEmail(message.to.find((recipient) => extractEmail(recipient) !== own) ?? message.to[0] ?? '') || 'unknown-recipient'
      : extractEmail(message.from) || message.from || 'unknown-sender';
    const { key, company } = correspondentKey(address, Boolean(message.senderVerified));
    const group = groups.get(key) ?? { key, company, items: [] };
    group.items.push({ ...message, address });
    groups.set(key, group);
  }

  return [...groups.values()].map(({ key, company, items }) => {
    const unique = [...new Map(items.map((item) => [`${item.accountId}:${item.sourceMessageId}`, item])).values()];
    const ordered = unique.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    const inboundItems = ordered.filter((item) => extractEmail(item.from) !== item.accountEmail.toLowerCase());
    const latestInbound = inboundItems.at(-1);
    const latest = ordered.at(-1)!;
    const replyTarget = latestInbound ?? latest;
    const verified = [...inboundItems].reverse().find((item) => item.senderVerified);
    const name = (latestInbound && extractName(latestInbound.from)) || (company ? brandName(company) : replyTarget.address);
    const source: MessageSource = /@(icloud|me|mac)\.com$/i.test(replyTarget.accountEmail) ? 'icloud' : /@(gmail|googlemail)\.com$/i.test(replyTarget.accountEmail) ? 'gmail' : 'imap';
    const personId = `mail-person-${stableID(key)}`;
    const conversationId = `mail-conversation-${stableID(key)}`;
    const addresses = [...new Set(ordered.map((item) => item.address))];
    const person: Person = {
      id: personId, name, initials: initialsFor(name), avatarColor: colorFor(key),
      identities: addresses.map((value) => ({ id: `mail-identity-${stableID(value)}`, personId, kind: 'email' as const, value, source, label: replyTarget.accountEmail, verifiedByUser: false })),
      ...(verified ? { verifiedDomain: verified.address.split('@')[1] } : {}),
      avatarUrls: senderIconUrls(replyTarget.address, verified?.senderLogoUrl),
    };
    return {
      id: conversationId,
      participants: [person], sourceSummary: [source], lastMessageAt: latest.sentAt,
      preview: emailPreview(latest.text, '') || attachmentPreview(latest), unreadCount: 0, labels: [],
      email: { accountId: replyTarget.accountId, accountEmail: replyTarget.accountEmail, address: replyTarget.address, latestSubject: replyTarget.subject, latestMessageId: replyTarget.sourceMessageId },
      messages: linkReplies(ordered.map((message) => {
        const outbound = extractEmail(message.from) === message.accountEmail.toLowerCase();
        const identityId = `mail-identity-${stableID(message.address)}`;
        return {
          id: `mail-message-${stableID(`${message.accountId}:${message.sourceMessageId}`)}`, sourceMessageId: message.sourceMessageId,
          conversationId, senderPersonId: outbound ? 'me' : personId, senderIdentityId: outbound ? 'me' : identityId,
          recipientPersonIds: outbound ? [personId] : ['me'], sentAt: message.sentAt, body: message.text, source, channel: 'email' as const,
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
function extractName(value: string): string { return value.replace(/<[^>]+>/, '').trim().replace(/^['"]|['"]$/g, '').trim(); }
function initialsFor(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'; }
function stableID(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0).toString(36); }
function colorFor(value: string): string { const colors = ['#7B61FF','#EB5757','#F2994A','#27AE60','#2F80ED','#9B51E0']; return colors[parseInt(stableID(value), 36) % colors.length]; }

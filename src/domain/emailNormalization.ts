import { StoredMailMessage } from '../connectors/mailApiConnector';
import { emailPreview } from './emailBody';
import { Conversation, MessageSource, Person } from './models';

/**
 * Turns stored email (inbound and sent) into people-first conversations: one
 * conversation per mailbox and other person, with both directions in order.
 */
export function normalizeStoredEmail(messages: StoredMailMessage[]): Conversation[] {
  const grouped = new Map<string, { accountId: string; accountEmail: string; address: string; items: StoredMailMessage[] }>();
  for (const message of messages) {
    const own = message.accountEmail.toLowerCase();
    const outbound = extractEmail(message.from) === own;
    const address = outbound
      ? extractEmail(message.to.find((recipient) => extractEmail(recipient) !== own) ?? message.to[0] ?? '') || 'unknown-recipient'
      : extractEmail(message.from) || message.from || 'unknown-sender';
    const key = `${message.accountId}:${address}`;
    const group = grouped.get(key) ?? { accountId: message.accountId, accountEmail: message.accountEmail, address, items: [] };
    group.items.push(message);
    grouped.set(key, group);
  }

  return [...grouped.values()].map(({ accountId, accountEmail, address, items }) => {
    const source: MessageSource = /@(icloud|me|mac)\.com$/i.test(accountEmail) ? 'icloud' : /@(gmail|googlemail)\.com$/i.test(accountEmail) ? 'gmail' : 'imap';
    const unique = [...new Map(items.map((item) => [item.sourceMessageId, item])).values()];
    const ordered = unique.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    const inbound = ordered.find((item) => extractEmail(item.from) !== accountEmail.toLowerCase());
    const name = (inbound && extractName(inbound.from)) || address;
    const verified = [...ordered].reverse().find((item) => item.senderVerified && extractEmail(item.from) === address);
    const personId = `mail-person-${stableID(address)}`;
    const identityId = `mail-identity-${stableID(address)}`;
    const conversationId = `mail-conversation-${stableID(`${accountId}:${address}`)}`;
    const person: Person = {
      id: personId, name, initials: initialsFor(name), avatarColor: colorFor(address),
      ...(verified ? { verifiedDomain: address.split('@')[1], avatarUrl: verified.senderLogoUrl } : {}),
      identities: [{ id: identityId, personId, kind: 'email', value: address, source, label: accountEmail, verifiedByUser: false }],
    };
    const latest = ordered.at(-1);
    return {
      id: conversationId,
      participants: [person], sourceSummary: [source], lastMessageAt: latest?.sentAt ?? new Date().toISOString(),
      preview: latest ? emailPreview(latest.text, latest.subject) : '', unreadCount: 0, labels: [],
      email: { accountId, accountEmail, address, latestSubject: latest?.subject ?? '', latestMessageId: latest?.sourceMessageId },
      messages: ordered.map((message) => {
        const outbound = extractEmail(message.from) === accountEmail.toLowerCase();
        return {
          id: `mail-message-${stableID(`${accountId}:${message.sourceMessageId}`)}`, sourceMessageId: message.sourceMessageId,
          conversationId, senderPersonId: outbound ? 'me' : personId, senderIdentityId: outbound ? 'me' : identityId,
          recipientPersonIds: outbound ? [personId] : ['me'], sentAt: message.sentAt, body: message.text || '(No plain-text body)', source, channel: 'email' as const,
          emailContext: { providerThreadId: message.sourceMessageId, subject: message.subject || '(No subject)' },
          direction: outbound ? 'outbound' as const : 'inbound' as const, deliveryState: outbound ? 'sent' as const : 'received' as const,
        };
      }),
    };
  });
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim() || '(No subject)';
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function extractEmail(value: string): string { return value.match(/<([^>]+)>/)?.[1]?.trim().toLocaleLowerCase() ?? (value.includes('@') ? value.trim().toLocaleLowerCase() : ''); }
function extractName(value: string): string { return value.replace(/<[^>]+>/, '').trim().replace(/^['"]|['"]$/g, '').trim(); }
function initialsFor(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'; }
function stableID(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0).toString(36); }
function colorFor(value: string): string { const colors = ['#7B61FF','#EB5757','#F2994A','#27AE60','#2F80ED','#9B51E0']; return colors[parseInt(stableID(value), 36) % colors.length]; }

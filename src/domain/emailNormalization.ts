import { ConnectedMailAccount, SyncedMailMessage } from '../connectors/mailApiConnector';
import { Conversation, MessageSource, Person } from './models';

export function normalizeSyncedEmail(account: ConnectedMailAccount, messages: SyncedMailMessage[]): Conversation[] {
  const source: MessageSource = /@(icloud|me|mac)\.com$/i.test(account.email) ? 'icloud' : 'imap';
  const grouped = new Map<string, SyncedMailMessage[]>();
  for (const message of messages) {
    const key = extractEmail(message.from) || message.from || 'unknown-sender';
    grouped.set(key, [...(grouped.get(key) ?? []), message]);
  }

  return [...grouped.entries()].map(([address, items]) => {
    const ordered = [...items].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    const name = extractName(items[0].from) || address;
    const personId = `mail-person-${stableID(address)}`;
    const identityId = `mail-identity-${stableID(address)}`;
    const person: Person = {
      id: personId, name, initials: initialsFor(name), avatarColor: colorFor(address),
      identities: [{ id: identityId, personId, kind: 'email', value: address, source, label: account.email, verifiedByUser: false }],
    };
    return {
      id: `mail-conversation-${stableID(`${account.id}:${address}`)}`,
      participants: [person], sourceSummary: [source], lastMessageAt: ordered.at(-1)?.sentAt ?? new Date().toISOString(),
      preview: ordered.at(-1)?.text || ordered.at(-1)?.subject || '', unreadCount: 0, labels: [],
      messages: ordered.map((message, index) => ({
        id: `mail-message-${stableID(`${account.id}:${message.sourceMessageId}`)}`, sourceMessageId: message.sourceMessageId,
        conversationId: `mail-conversation-${stableID(`${account.id}:${address}`)}`, senderPersonId: personId, senderIdentityId: identityId,
        recipientPersonIds: ['me'], sentAt: message.sentAt, body: message.text || '(No plain-text body)', source, channel: 'email' as const,
        emailContext: { providerThreadId: message.sourceMessageId || String(index), subject: message.subject || '(No subject)' },
        direction: 'inbound' as const, deliveryState: 'received' as const,
      })),
    };
  });
}

function extractEmail(value: string): string { return value.match(/<([^>]+)>/)?.[1]?.trim().toLocaleLowerCase() ?? (value.includes('@') ? value.trim().toLocaleLowerCase() : ''); }
function extractName(value: string): string { return value.replace(/<[^>]+>/, '').replace(/^['"]|['"]$/g, '').trim(); }
function initialsFor(name: string): string { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'; }
function stableID(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0).toString(36); }
function colorFor(value: string): string { const colors = ['#7B61FF','#EB5757','#F2994A','#27AE60','#2F80ED','#9B51E0']; return colors[parseInt(stableID(value), 36) % colors.length]; }

import { Message } from './models';

/**
 * Message receipts (ADR 0026). Each channel says only what it can truly know:
 * - Open Media: sent, delivered (their app fetched it), read (they opened the conversation).
 * - Bridged chats: what the bridge reports (WhatsApp, Signal and others send read receipts).
 * - Email: sent (your mail server accepted it). Email has no reliable delivered or read signal,
 *   and Open Media never adds tracking pixels, so it never claims either.
 */
export type Receipt = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Each other member's last delivery and read time in a conversation. */
export interface MemberReceipt { deliveredAt?: string; readAt?: string }

export function receiptOf(message: Message): Receipt | undefined {
  if (message.direction !== 'outbound') return undefined;
  if (message.deliveryState === 'failed') return 'failed';
  if (message.deliveryState === 'pending') return 'sending';
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
}

const at = (iso?: string) => (iso ? Date.parse(iso) : Number.NaN);

/**
 * Marks the caller's messages delivered or read once every other member has fetched or opened the
 * conversation since they were sent (so in a group, "Read" means read by everyone). A member who
 * hides read receipts has no read time, so their messages stop at delivered.
 */
export function applyReceipts(messages: Message[], others: MemberReceipt[]): Message[] {
  if (!others.length) return messages;
  const earliest = (key: keyof MemberReceipt) => {
    const times = others.map((member) => at(member[key]));
    return times.some(Number.isNaN) ? undefined : new Date(Math.min(...times)).toISOString();
  };
  const delivered = earliest('deliveredAt');
  const read = earliest('readAt');
  return messages.map((message) => {
    if (message.direction !== 'outbound' || message.deliveryState !== 'sent') return message;
    const sent = at(message.sentAt);
    const readAt = read && at(read) >= sent ? read : undefined;
    const deliveredAt = readAt ?? (delivered && at(delivered) >= sent ? delivered : undefined);
    return readAt || deliveredAt ? { ...message, ...(deliveredAt ? { deliveredAt } : {}), ...(readAt ? { readAt } : {}) } : message;
  });
}

/**
 * Messages from others the viewer hasn't seen: those after their last read time. Before they have
 * opened a conversation at all, a reply of theirs counts as having read what came before it.
 */
export function unreadCount(messages: Message[], readAt?: string): number {
  const since = readAt ? at(readAt) : Math.max(-Infinity, ...messages.filter((message) => message.direction === 'outbound').map((message) => at(message.sentAt)));
  return messages.filter((message) => message.direction === 'inbound' && at(message.sentAt) > since).length;
}

/** Words for the receipt under a message: "Read 9:41 PM", "Delivered", "Sent", "Sending…". */
export function receiptLabel(receipt: Receipt, message: Pick<Message, 'readAt'>, time: (iso: string) => string): string {
  switch (receipt) {
    case 'read': return message.readAt ? `Read ${time(message.readAt)}` : 'Read';
    case 'delivered': return 'Delivered';
    case 'sent': return 'Sent';
    case 'sending': return 'Sending…';
    case 'failed': return 'Not sent';
  }
}

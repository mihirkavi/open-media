import { Message } from './models';

/** The message a chain of replies starts from: follow "in reply to" up until it stops. */
export function threadRootId(byId: Map<string, Message>, messageId: string): string {
  let current = messageId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current)?.replyToMessageId;
    if (!parent || !byId.has(parent)) return current;
    current = parent;
  }
  return current;
}

/**
 * A reply thread, the way iMessage shows it when you tap a reply: the original, then every reply
 * to it (and replies to those), oldest first. Empty when the message is in no thread.
 */
export function replyThread(messages: Message[], messageId: string): Message[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  if (!byId.has(messageId)) return [];
  const root = threadRootId(byId, messageId);
  const members = messages.filter((message) => message.id === root || (message.replyToMessageId && threadRootId(byId, message.id) === root));
  return members.length > 1 ? [...members].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)) : [];
}

/** How many replies each thread's original has, for the "2 Replies" line under it. */
export function replyCounts(messages: Message[]): Map<string, number> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (!message.replyToMessageId || !byId.has(message.replyToMessageId)) continue;
    const root = threadRootId(byId, message.id);
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return counts;
}

/** "1 Reply", "3 Replies". */
export function replyCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'Reply' : 'Replies'}`;
}

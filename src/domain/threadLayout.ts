import { Message } from './models';

/** One row in a conversation thread, laid out the way iMessage does it. */
export type ThreadItem =
  | { kind: 'time'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      message: Message;
      /** Bold first line inside the bubble; only when the subject changes. */
      subject?: string;
      /** First and last bubble of a run from the same side, for spacing and the tail. */
      groupStart: boolean;
      groupEnd: boolean;
    };

const timeGapMs = 60 * 60 * 1000;
const groupGapMs = 5 * 60 * 1000;

export function layoutThread(messages: Message[], now = new Date()): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastSubject = '';
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const at = Date.parse(message.sentAt);
    if (!previous || at - Date.parse(previous.sentAt) > timeGapMs) {
      items.push({ kind: 'time', key: `time-${message.id}`, label: formatThreadTime(new Date(at), now) });
    }
    const subject = message.emailContext?.subject?.trim();
    const normalized = normalizeSubject(subject ?? '');
    const showSubject = Boolean(subject) && normalized !== '' && normalized !== '(no subject)' && normalized !== lastSubject;
    if (normalized) lastSubject = normalized;
    items.push({
      kind: 'message',
      key: message.id,
      message,
      subject: showSubject ? stripReplyPrefix(subject!) : undefined,
      groupStart: !previous || !sameRun(previous, message),
      groupEnd: !next || !sameRun(message, next),
    });
  });
  return items;
}

function sameRun(first: Message, second: Message): boolean {
  return first.direction === second.direction
    && first.senderPersonId === second.senderPersonId
    && Date.parse(second.sentAt) - Date.parse(first.sentAt) <= groupGapMs;
}

/** "Re: Fwd: Lunch?" → "Lunch?" */
export function stripReplyPrefix(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|aw|sv|tr)\s*(\[\d+\])?\s*:\s*)+/i, '').trim() || subject.trim();
}

export function normalizeSubject(subject: string): string {
  return stripReplyPrefix(subject).replace(/\s+/g, ' ').toLowerCase();
}

/** "Today 9:02 PM", "Yesterday 9:02 PM", "Monday 9:02 PM", "Oct 1 at 9:02 PM". */
export function formatThreadTime(date: Date, now = new Date()): string {
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date)} ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = new Intl.DateTimeFormat('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  return `${day} at ${time}`;
}

/** Short time for the conversation list: "9:02 PM", "Yesterday", "Monday", "10/1/26". */
export function formatListTime(date: Date, now = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }).format(date);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

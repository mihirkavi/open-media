import { Message } from './models';

/** One row in a conversation thread, laid out the way iMessage does it. */
export type ThreadItem =
  /** A time between messages, iMessage style: the day in bold ("Today"), then the time. */
  | { kind: 'time'; key: string; label: string; day: string; time: string }
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
      const parts = threadTimeParts(new Date(at), now);
      items.push({ kind: 'time', key: `time-${message.id}`, label: formatThreadTime(new Date(at), now), ...parts });
    }
    const subject = message.emailContext?.subject?.trim();
    const normalized = normalizeSubject(subject ?? '');
    // Emails written here take their subject from the first line; don't say it twice.
    const firstLine = message.body.trim().split('\n')[0].replace(/\s+/g, ' ').toLowerCase();
    const repeatsBody = Boolean(normalized) && firstLine.startsWith(normalized.replace(/…$/, ''));
    const showSubject = Boolean(subject) && normalized !== '' && normalized !== '(no subject)' && normalized !== lastSubject && !repeatsBody;
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
  // A person's merged conversation (ADR 0023) starts a new run when the channel changes, so each run is marked with its source.
  return first.direction === second.direction
    && first.senderPersonId === second.senderPersonId
    && first.source === second.source
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
  const { day, time } = threadTimeParts(date, now);
  return /^\p{L}+$/u.test(day) ? `${day} ${time}` : `${day} at ${time}`;
}

/** The two halves of a thread time: { day: "Today", time: "9:02 PM" }, { day: "Sat, Oct 1", time: "9:02 PM" }. */
export function threadTimeParts(date: Date, now = new Date()): { day: string; time: string } {
  const time = formatClockTime(date);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return { day: 'Today', time };
  if (days === 1) return { day: 'Yesterday', time };
  if (days > 1 && days < 7) return { day: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date), time };
  const sameYear = date.getFullYear() === now.getFullYear();
  return { day: new Intl.DateTimeFormat('en-US', sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date), time };
}

/** "9:02 PM", for the time beside a single message. */
export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
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

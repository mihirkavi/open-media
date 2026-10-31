/**
 * Pacing for live mail. The app keeps one waiting sync open per mailbox: the service answers as
 * soon as new mail arrives (IMAP IDLE) or after about 25 seconds, and the app asks again.
 */

/** How long to pause before the next waiting sync. */
export function nextMailPoll({ elapsedMs, newMessages, failures }: { elapsedMs: number; newMessages: number; failures: number }): number {
  // Back off after errors (the service or the mail server is unreachable): 15 s, 30 s, then every minute.
  if (failures > 0) return Math.min(15_000 * 2 ** (failures - 1), 60_000);
  // New mail: ask again right away, in case more is on its way.
  if (newMessages > 0) return 0;
  // An empty answer that came back quickly means the server can't wait (no IDLE): poll gently.
  return elapsedMs < 5_000 ? 15_000 : 0;
}

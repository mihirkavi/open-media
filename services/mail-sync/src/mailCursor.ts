/**
 * Where a mailbox's last sync left off, so a live sync with nothing new can stop after a few
 * short commands instead of reading every header again (ADR 0025).
 *
 * The app holds the cursor as an opaque string and sends it back with the next sync. It is only
 * a hint: a missing, stale or edited cursor makes the sync read the folders as before, and the
 * stored Message-IDs still keep mail from being saved twice. It never holds addresses or content.
 */

/** An IMAP folder's UIDVALIDITY and UIDNEXT. */
export interface FolderMark {
  validity: string;
  next: number;
}

export interface ImapCursor {
  inbox?: FolderMark;
  sent?: FolderMark;
}

/** A POP mailbox's message count and the unique id (UIDL) of its newest message. */
export interface PopCursor {
  count: number;
  last: string;
}

export type MailCursor = { kind: 'imap'; imap: ImapCursor } | { kind: 'pop'; pop: PopCursor };

const maxLength = 200;

export function formatCursor(cursor: MailCursor): string {
  if (cursor.kind === 'pop') return `p1.${cursor.pop.count}.${encodeURIComponent(cursor.pop.last)}`;
  const mark = (folder?: FolderMark) => (folder ? `${folder.validity}.${folder.next}` : '.');
  return `i1.${mark(cursor.imap.inbox)}.${mark(cursor.imap.sent)}`;
}

/** Reads a cursor the app sent back; anything malformed is ignored. */
export function parseCursor(value: string | null | undefined): MailCursor | undefined {
  if (!value || value.length > maxLength) return undefined;
  const imap = value.match(/^i1\.(\d*)\.(\d*)\.(\d*)\.(\d*)$/);
  if (imap) {
    // Each folder is either absent (both parts empty) or a complete, plausible mark.
    const mark = (validity: string, next: string): FolderMark | undefined | false =>
      !validity && !next ? undefined : validity.length <= 20 && next.length <= 10 && validity && next ? { validity, next: Number(next) } : false;
    const inbox = mark(imap[1], imap[2]);
    const sent = mark(imap[3], imap[4]);
    if (inbox === false || sent === false || (!inbox && !sent)) return undefined;
    return { kind: 'imap', imap: { inbox, sent } };
  }
  const pop = value.match(/^p1\.(\d{1,10})\.(.*)$/);
  if (pop) {
    try {
      const last = decodeURIComponent(pop[2]);
      // RFC 1939: a unique-id is 1 to 70 printable characters.
      if (/^[\x21-\x7e]{0,70}$/.test(last)) return { kind: 'pop', pop: { count: Number(pop[1]), last } };
    } catch { /* malformed escape */ }
  }
  return undefined;
}

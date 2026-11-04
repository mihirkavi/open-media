import { FetchMessageObject, ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { UserFacingError } from './errors.js';
import { collectAttachments, collectRemoteImages } from './mailMedia.js';
import { verifySender } from './senderVerification.js';
import { FolderMark, ImapCursor } from './mailCursor.js';
import { MailAccountInput, StoredPeople, SyncedMessage } from './types.js';

function clientFor(input: MailAccountInput): ImapFlow {
  const client = new ImapFlow({
    host: input.host, port: input.port, secure: input.allowPlaintext ? false : input.secure,
    ...(input.allowPlaintext ? { doSTARTTLS: false } : {}),
    auth: { user: input.username, pass: input.password },
    logger: false, tls: { rejectUnauthorized: true, servername: input.tlsServername ?? input.host },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
    disableCompression: true,
  });
  // Late socket errors (e.g. a timeout after a failed login) must not crash the process.
  client.on('error', () => undefined);
  keepReadingQueuedResponses(client);
  return client;
}

type ImapFlowInternals = {
  reader: () => Promise<void>;
  isClosed: boolean;
  socketReadable?: () => void;
  streamer?: { readableLength: number };
};

/**
 * ImapFlow ignores 'readable' while its reader loop runs and clears that flag a
 * tick after the loop ends. On Workers, process.nextTick is a microtask, so the
 * event for the second line of a reply (iCloud sends "* CAPABILITY" and "2 OK"
 * together) fires inside that window and is lost, and sign-in hangs until the
 * socket timeout. When a loop ends, read again if a reply is already waiting.
 */
function keepReadingQueuedResponses(client: ImapFlow): void {
  const internals = client as unknown as ImapFlowInternals;
  const reader = internals.reader.bind(client);
  internals.reader = async () => {
    try { await reader(); }
    finally {
      // A macrotask runs after ImapFlow's own flag has been cleared.
      setTimeout(() => {
        if (!internals.isClosed && (internals.streamer?.readableLength ?? 0) > 0) internals.socketReadable?.();
      }, 0);
    }
  };
}

export async function testImap(input: MailAccountInput): Promise<void> {
  if (!input.secure && !input.allowPlaintext) throw new Error('Unencrypted IMAP is disabled. Use TLS on port 993.');
  const client = clientFor(input);
  try { await client.connect(); }
  catch (error) { throw new UserFacingError(describeMailError(error, input, 'IMAP')); }
  finally { await logoutQuietly(client); }
}

/** Logging out is a courtesy: a slow or failed LOGOUT must never turn finished work into an error. */
async function logoutQuietly(client: ImapFlow): Promise<void> {
  if (client.usable) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([client.logout(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 3_000); })]).catch(() => undefined);
    clearTimeout(timer);
  }
  client.close();
}

/** Plain-language reason a mail server connection failed; never includes the password. */
export function describeMailError(error: unknown, input: Pick<MailAccountInput, 'host' | 'port' | 'tlsServername'>, kind: 'IMAP' | 'POP'): string {
  const detail = error as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  const server = `${input.tlsServername ?? input.host}:${input.port}`;
  const text = `${detail.responseText ?? ''} ${detail.message ?? ''}`;
  if (detail.authenticationFailed || /auth|login|credential|password|invalid user|-ERR/i.test(text)) {
    return `The ${kind} server ${server} rejected the username or password. Most providers need an app password, not your normal password.`;
  }
  if (/timeout|timed out/i.test(text) || detail.code === 'ETIMEDOUT') return `The ${kind} server ${server} did not respond. Check the server and port.`;
  if (/certificate|tls|ssl/i.test(text)) return `Could not make a secure connection to ${server}. Check the server and port (usually 993 for IMAP or 995 for POP).`;
  return `Could not connect to the ${kind} server ${server}. Check the server and port.`;
}

/** How many of the newest messages a sync reads from each folder. */
export const syncLimits = { INBOX: 50, Sent: 25 };
/** Larger messages keep their sender and subject, but their body isn't downloaded. */
const maxSourceBytes = 10 * 1024 * 1024;
/** Bodies are downloaded this many at a time (and at most this many bytes), and parsed only once a batch has fully arrived. */
const sourceBatch = 10;
const sourceBatchBytes = 12 * 1024 * 1024;

/** Saves one parsed batch, attachment bytes included, before the next batch is downloaded. */
export type SaveBatch = (messages: SyncedMessage[]) => Promise<void>;

export interface SyncOptions {
  limits?: { INBOX: number; Sent: number };
  save?: SaveBatch;
  /** Stored sender and recipients for these Message-IDs, so only new mail (or mail saved before names and Cc were kept) is downloaded. */
  known?: (sourceMessageIds: string[]) => Promise<Map<string, StoredPeople>>;
  /** When nothing new arrived, wait up to this long for new INBOX mail (IMAP IDLE) and fetch it. */
  waitMs?: number;
  /** Where the last sync left each folder: a folder that hasn't moved on is skipped without reading its headers. */
  cursor?: ImapCursor;
  /** Called once the whole sync has finished, with where it left each folder. */
  onCursor?: (cursor: ImapCursor) => void;
  /**
   * Called after INBOX is read, with the read (\Seen) and unread Message-IDs of the newest messages,
   * after any new ones are saved, so read state set in other mail apps reaches Open Media (ADR 0026).
   */
  onSeen?: OnSeen;
}

export type OnSeen = (state: { seen: string[]; unseen: string[] }) => Promise<void>;

/** A save failure: unlike a dropped connection, it must not be reported as a partial sync. */
class SaveFailed {
  constructor(readonly cause: unknown) {}
}

/**
 * Reads the newest messages from INBOX and the Sent folder, so threads show both sides.
 *
 * Bodies come in small batches that finish downloading before anything is parsed: parsing and
 * the sender checks wait on the network, and pausing ImapFlow's stream that long on Workers
 * could stall it until the socket timed out ("Connection not available"). If the connection
 * still drops partway, the messages that already arrived are kept.
 *
 * With `save`, each batch is stored as soon as it is parsed and its attachment bytes are then
 * dropped. A Worker has 128 MB: holding every attachment of every message until the end ran out
 * of memory, and Cloudflare ended the request without a reply ("Can't reach the mail service").
 *
 * With `known`, only mail that isn't stored yet is downloaded, so a sync with nothing new takes
 * about a second. With `waitMs`, the request then stays open in IDLE, so the app sees new mail
 * moments after it arrives, like a chat. With `cursor`, a folder whose UIDVALIDITY and UIDNEXT
 * haven't changed is not read at all, so a live sync that finds nothing costs one sign-in and a few
 * short commands before it waits.
 */
export async function syncImap(input: MailAccountInput, { limits = syncLimits, save, known, waitMs, cursor, onCursor, onSeen }: SyncOptions = {}): Promise<SyncedMessage[]> {
  const client = clientFor(input);
  const messages: SyncedMessage[] = [];
  const started = Date.now();
  let stage = 'connect';
  try {
    await client.connect();
    stage = 'list';
    const folders = await client.list();
    const sent = folders.find((folder) => folder.specialUse === '\\Sent')?.path;
    const reached: ImapCursor = {};
    stage = 'INBOX';
    reached.inbox = await fetchRecent(client, 'INBOX', 'INBOX', limits.INBOX, messages, save, known, cursor?.inbox, onSeen);
    if (sent) {
      stage = 'Sent';
      reached.sent = await fetchRecent(client, sent, 'Sent', limits.Sent, messages, save, known, cursor?.sent);
    }
    if (waitMs && !messages.length) {
      stage = 'wait';
      const opened = await client.mailboxOpen('INBOX', { readOnly: true });
      // Mail that arrived after INBOX was read but before IDLE began is fetched now, not after the wait.
      const missed = Boolean(reached.inbox && opened.uidNext && opened.uidNext > reached.inbox.next);
      // Mail read or marked unread in another app also ends the wait, so its read state is updated.
      if (missed || await changeIn(client, opened.exists, waitMs)) {
        stage = 'INBOX';
        reached.inbox = await fetchRecent(client, 'INBOX', 'INBOX', limits.INBOX, messages, save, known, undefined, onSeen);
      }
    }
    logSync('done', started, messages.length);
    onCursor?.(reached);
    return messages;
  } catch (error) {
    if (error instanceof SaveFailed) { logSync('save', started, messages.length, error.cause); throw error.cause; }
    logSync(stage, started, messages.length, error);
    if (messages.length) return messages;
    throw new UserFacingError(describeMailError(error, input, 'IMAP'));
  } finally { await logoutQuietly(client); }
}

/**
 * Waits in IDLE until the open mailbox grows past `exists` or a message's flags change, or `ms`
 * pass, or the connection closes. Deleted mail lowers the count first, so a new message after a
 * deletion still counts as new.
 */
function changeIn(client: ImapFlow, exists: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let count = exists;
    const finish = (changed: boolean) => {
      clearTimeout(timer);
      client.off('exists', onExists);
      client.off('expunge', onExpunge);
      client.off('flags', onFlags);
      client.off('close', onClose);
      resolve(changed);
    };
    const onExists = (update: { count: number }) => { if (update.count > count) finish(true); };
    const onExpunge = () => { count = Math.max(0, count - 1); };
    const onFlags = () => finish(true);
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), ms);
    client.on('exists', onExists);
    client.on('expunge', onExpunge);
    client.on('flags', onFlags);
    client.on('close', onClose);
    client.idle().catch(() => finish(false));
  });
}

/** One line per sync for Workers Logs: the step, timing and counts, never addresses or content. */
function logSync(stage: string, started: number, count: number, error?: unknown): void {
  const detail = error as { code?: string; message?: string } | undefined;
  console.log(JSON.stringify({ event: 'imap_sync', stage, ms: Date.now() - started, messages: count, ...(error ? { errorCode: detail?.code, error: detail?.message?.slice(0, 120) } : {}) }));
}

/** Reads one folder's new mail and returns where it now stands (undefined when the server gives no UIDNEXT). */
async function fetchRecent(client: ImapFlow, path: string, mailbox: string, limit: number, into: SyncedMessage[], save?: SaveBatch, known?: SyncOptions['known'], since?: FolderMark, onSeen?: OnSeen): Promise<FolderMark | undefined> {
  const opened = await client.mailboxOpen(path, { readOnly: true });
  const mark = opened.uidNext && opened.uidValidity !== undefined ? { validity: String(opened.uidValidity), next: opened.uidNext } : undefined;
  // Nothing was added since the last sync: no UID at or past the old UIDNEXT exists yet.
  if (mark && since && since.validity === mark.validity && mark.next <= since.next) return mark;
  if (!opened.exists) return mark;
  const first = Math.max(1, opened.exists - limit + 1);
  // Headers and sizes first. They are small, so the stream never waits on our work.
  const fetched: FetchMessageObject[] = [];
  for await (const item of client.fetch(`${first}:*`, { uid: true, envelope: true, internalDate: true, size: true, flags: Boolean(onSeen) })) fetched.push(item);
  const stored = known ? await known(fetched.map((item) => messageIdOf(item, mailbox))) : new Map<string, StoredPeople>();
  // New mail, plus mail saved before names and Cc were kept: downloading it again adds them and
  // re-checks the verified badge. Newest first, so a sync cut short keeps recent mail.
  const items = fetched.filter((item) => !samePeople(stored.get(messageIdOf(item, mailbox)), item)).sort((a, b) => b.uid - a.uid);
  for (const batch of batches(items)) {
    const wanted = batch.filter((item) => (item.size ?? 0) <= maxSourceBytes).map((item) => item.uid);
    const sources = new Map<number, Buffer>();
    if (wanted.length) {
      for await (const item of client.fetch(wanted.join(','), { uid: true, source: true }, { uid: true })) {
        if (item.source) sources.set(item.uid, item.source);
      }
    }
    const parsed: SyncedMessage[] = [];
    for (const item of batch) {
      parsed.push(await toSyncedMessage(item, sources.get(item.uid), mailbox));
      sources.delete(item.uid);
    }
    if (save) {
      try { await save(parsed); } catch (error) { throw new SaveFailed(error); }
      for (const message of parsed) message.attachments = message.attachments?.map(({ content: _content, ...metadata }) => metadata);
    }
    into.push(...parsed);
  }
  if (onSeen && fetched.length) {
    const ids = (seen: boolean) => fetched.filter((item) => Boolean(item.flags?.has('\\Seen')) === seen).map((item) => messageIdOf(item, mailbox));
    await onSeen({ seen: ids(true), unseen: ids(false) }).catch(() => undefined);
  }
  return mark;
}

/**
 * Marks these INBOX messages read (\Seen) on the mail server, as opening them in any mail app
 * would (ADR 0026). Messages are found by Message-ID; ones stored without one by their UID.
 * With `seen` false it takes \Seen off instead: marking the mail unread. Returns how many were found.
 */
export async function markSeenImap(input: MailAccountInput, sourceMessageIds: string[], seen = true): Promise<number> {
  const client = clientFor(input);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = sourceMessageIds.map((id) => id.match(/^imap-INBOX-(\d+)$/)?.[1]).filter((uid): uid is string => Boolean(uid));
    const headers = sourceMessageIds.filter((id) => !/^imap-/.test(id));
    const found = new Set<number>();
    for (let start = 0; start < headers.length; start += 25) {
      const terms = headers.slice(start, start + 25).map((id) => ({ header: { 'message-id': id } }));
      const result = await client.search(terms.length === 1 ? terms[0] : { or: terms }, { uid: true });
      for (const uid of result || []) found.add(uid);
    }
    for (const uid of uids) found.add(Number(uid));
    if (found.size) {
      const range = [...found].join(',');
      if (seen) await client.messageFlagsAdd(range, ['\\Seen'], { uid: true });
      else await client.messageFlagsRemove(range, ['\\Seen'], { uid: true });
    }
    return found.size;
  } catch (error) {
    throw new UserFacingError(describeMailError(error, input, 'IMAP'));
  } finally { await logoutQuietly(client); }
}

/** Groups messages so each download stays under both the count and the byte budget. */
function batches(items: FetchMessageObject[]): FetchMessageObject[][] {
  const groups: FetchMessageObject[][] = [];
  let current: FetchMessageObject[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = (item.size ?? 0) <= maxSourceBytes ? item.size ?? 0 : 0;
    if (current.length && (current.length === sourceBatch || bytes + size > sourceBatchBytes)) { groups.push(current); current = []; bytes = 0; }
    current.push(item);
    bytes += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

function messageIdOf(item: FetchMessageObject, mailbox: string): string {
  return item.envelope?.messageId ?? `imap-${mailbox}-${item.uid}`;
}

function senderOf(item: FetchMessageObject): string {
  return item.envelope?.from?.map(formatAddress).filter(Boolean).join(', ') ?? '';
}

/** To, then Cc: everyone in the conversation, so mail with several people becomes a group. */
function recipientsOf(item: FetchMessageObject): string[] {
  return [...(item.envelope?.to ?? []), ...(item.envelope?.cc ?? [])].map(formatAddress).filter(Boolean);
}

function samePeople(stored: StoredPeople | undefined, item: FetchMessageObject): boolean {
  if (!stored || stored.sender !== senderOf(item)) return false;
  const recipients = recipientsOf(item);
  return stored.recipients.length === recipients.length && stored.recipients.every((recipient, index) => recipient === recipients[index]);
}

/** "Name <address>" when the sender gave a name, so chats show "Coursera", not the address. */
function formatAddress({ name, address }: { name?: string; address?: string }): string {
  const display = name?.replace(/["<>\r\n]/g, '').trim();
  if (!address) return display ?? '';
  return display && display.toLowerCase() !== address.toLowerCase() ? `"${display}" <${address}>` : address;
}

async function toSyncedMessage(item: FetchMessageObject, source: Buffer | undefined, mailbox: string): Promise<SyncedMessage> {
  const parsed = source ? await simpleParser(source) : undefined;
  const fromAddress = item.envelope?.from?.[0]?.address ?? '';
  const brand = parsed && mailbox !== 'Sent' ? await verifySender(fromAddress, parsed.headerLines) : { verified: false };
  return {
    sourceMessageId: messageIdOf(item, mailbox),
    mailbox, subject: item.envelope?.subject ?? '',
    from: senderOf(item),
    to: recipientsOf(item),
    sentAt: new Date(item.envelope?.date ?? item.internalDate ?? Date.now()).toISOString(),
    text: parsed?.text?.slice(0, 50_000) ?? '',
    senderVerified: brand.verified,
    senderLogoUrl: brand.logoUrl,
    remoteImages: collectRemoteImages(parsed?.html),
    attachments: collectAttachments(parsed?.attachments),
    inReplyTo: parsed?.inReplyTo,
  };
}

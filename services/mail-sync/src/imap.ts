import { FetchMessageObject, ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { UserFacingError } from './errors.js';
import { collectAttachments, collectRemoteImages } from './mailMedia.js';
import { verifySender } from './senderVerification.js';
import { MailAccountInput, SyncedMessage } from './types.js';

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
  /** Stored senders for these Message-IDs, so only new mail (or mail saved without the sender's name) is downloaded. */
  known?: (sourceMessageIds: string[]) => Promise<Map<string, string>>;
  /** When nothing new arrived, wait up to this long for new INBOX mail (IMAP IDLE) and fetch it. */
  waitMs?: number;
}

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
 * moments after it arrives, like a chat.
 */
export async function syncImap(input: MailAccountInput, { limits = syncLimits, save, known, waitMs }: SyncOptions = {}): Promise<SyncedMessage[]> {
  const client = clientFor(input);
  const messages: SyncedMessage[] = [];
  const started = Date.now();
  let stage = 'connect';
  try {
    await client.connect();
    stage = 'list';
    const folders = await client.list();
    const sent = folders.find((folder) => folder.specialUse === '\\Sent')?.path;
    for (const [path, mailbox, limit] of [['INBOX', 'INBOX', limits.INBOX], ...(sent ? [[sent, 'Sent', limits.Sent] as const] : [])] as const) {
      stage = mailbox;
      await fetchRecent(client, path, mailbox, limit, messages, save, known);
    }
    if (waitMs && !messages.length) {
      stage = 'wait';
      const opened = await client.mailboxOpen('INBOX', { readOnly: true });
      if (await newMailIn(client, opened.exists, waitMs)) {
        stage = 'INBOX';
        await fetchRecent(client, 'INBOX', 'INBOX', limits.INBOX, messages, save, known);
      }
    }
    logSync('done', started, messages.length);
    return messages;
  } catch (error) {
    if (error instanceof SaveFailed) { logSync('save', started, messages.length, error.cause); throw error.cause; }
    logSync(stage, started, messages.length, error);
    if (messages.length) return messages;
    throw new UserFacingError(describeMailError(error, input, 'IMAP'));
  } finally { await logoutQuietly(client); }
}

/** Waits in IDLE until the open mailbox grows past `exists`, or `ms` pass, or the connection closes. */
function newMailIn(client: ImapFlow, exists: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (arrived: boolean) => {
      clearTimeout(timer);
      client.off('exists', onExists);
      client.off('close', onClose);
      resolve(arrived);
    };
    const onExists = (update: { count: number }) => { if (update.count > exists) finish(true); };
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), ms);
    client.on('exists', onExists);
    client.on('close', onClose);
    client.idle().catch(() => finish(false));
  });
}

/** One line per sync for Workers Logs: the step, timing and counts, never addresses or content. */
function logSync(stage: string, started: number, count: number, error?: unknown): void {
  const detail = error as { code?: string; message?: string } | undefined;
  console.log(JSON.stringify({ event: 'imap_sync', stage, ms: Date.now() - started, messages: count, ...(error ? { errorCode: detail?.code, error: detail?.message?.slice(0, 120) } : {}) }));
}

async function fetchRecent(client: ImapFlow, path: string, mailbox: string, limit: number, into: SyncedMessage[], save?: SaveBatch, known?: SyncOptions['known']): Promise<void> {
  const opened = await client.mailboxOpen(path, { readOnly: true });
  if (!opened.exists) return;
  const first = Math.max(1, opened.exists - limit + 1);
  // Headers and sizes first. They are small, so the stream never waits on our work.
  const fetched: FetchMessageObject[] = [];
  for await (const item of client.fetch(`${first}:*`, { uid: true, envelope: true, internalDate: true, size: true })) fetched.push(item);
  const stored = known ? await known(fetched.map((item) => messageIdOf(item, mailbox))) : new Map<string, string>();
  // New mail, plus mail saved before senders' names were kept: downloading it again adds the
  // name and re-checks the verified badge. Newest first, so a sync cut short keeps recent mail.
  const items = fetched.filter((item) => stored.get(messageIdOf(item, mailbox)) !== senderOf(item)).sort((a, b) => b.uid - a.uid);
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
    to: item.envelope?.to?.map((address) => address.address ?? address.name ?? '').filter(Boolean) ?? [],
    sentAt: new Date(item.envelope?.date ?? item.internalDate ?? Date.now()).toISOString(),
    text: parsed?.text?.slice(0, 50_000) ?? '',
    senderVerified: brand.verified,
    senderLogoUrl: brand.logoUrl,
    remoteImages: collectRemoteImages(parsed?.html),
    attachments: collectAttachments(parsed?.attachments),
    inReplyTo: parsed?.inReplyTo,
  };
}

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
/** Bodies are downloaded this many at a time, and parsed only once a batch has fully arrived. */
const sourceBatch = 10;

/**
 * Reads the newest messages from INBOX and the Sent folder, so threads show both sides.
 *
 * Bodies come in small batches that finish downloading before anything is parsed: parsing and
 * the sender checks wait on the network, and pausing ImapFlow's stream that long on Workers
 * could stall it until the socket timed out ("Connection not available"). If the connection
 * still drops partway, the messages that already arrived are kept.
 */
export async function syncImap(input: MailAccountInput, limits = syncLimits): Promise<SyncedMessage[]> {
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
      await fetchRecent(client, path, mailbox, limit, messages);
    }
    logSync('done', started, messages.length);
    return messages;
  } catch (error) {
    logSync(stage, started, messages.length, error);
    if (messages.length) return messages;
    throw new UserFacingError(describeMailError(error, input, 'IMAP'));
  } finally { await logoutQuietly(client); }
}

/** One line per sync for Workers Logs: the step, timing and counts, never addresses or content. */
function logSync(stage: string, started: number, count: number, error?: unknown): void {
  const detail = error as { code?: string; message?: string } | undefined;
  console.log(JSON.stringify({ event: 'imap_sync', stage, ms: Date.now() - started, messages: count, ...(error ? { errorCode: detail?.code, error: detail?.message?.slice(0, 120) } : {}) }));
}

async function fetchRecent(client: ImapFlow, path: string, mailbox: string, limit: number, into: SyncedMessage[]): Promise<void> {
  const opened = await client.mailboxOpen(path, { readOnly: true });
  if (!opened.exists) return;
  const first = Math.max(1, opened.exists - limit + 1);
  // Headers and sizes first. They are small, so the stream never waits on our work.
  const items: FetchMessageObject[] = [];
  for await (const item of client.fetch(`${first}:*`, { uid: true, envelope: true, internalDate: true, size: true })) items.push(item);
  // Newest first, so a sync that is cut short keeps the most recent mail.
  items.sort((a, b) => b.uid - a.uid);
  for (let index = 0; index < items.length; index += sourceBatch) {
    const batch = items.slice(index, index + sourceBatch);
    const wanted = batch.filter((item) => (item.size ?? 0) <= maxSourceBytes).map((item) => item.uid);
    const sources = new Map<number, Buffer>();
    if (wanted.length) {
      for await (const item of client.fetch(wanted.join(','), { uid: true, source: true }, { uid: true })) {
        if (item.source) sources.set(item.uid, item.source);
      }
    }
    for (const item of batch) into.push(await toSyncedMessage(item, sources.get(item.uid), mailbox));
  }
}

async function toSyncedMessage(item: FetchMessageObject, source: Buffer | undefined, mailbox: string): Promise<SyncedMessage> {
  const parsed = source ? await simpleParser(source) : undefined;
  const fromAddress = item.envelope?.from?.[0]?.address ?? '';
  const brand = parsed && mailbox !== 'Sent' ? await verifySender(fromAddress, parsed.headerLines) : { verified: false };
  return {
    sourceMessageId: item.envelope?.messageId ?? `imap-${mailbox}-${item.uid}`,
    mailbox, subject: item.envelope?.subject ?? '',
    from: item.envelope?.from?.map((address) => address.address ?? address.name ?? '').filter(Boolean).join(', ') ?? '',
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

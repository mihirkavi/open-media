import net from 'node:net';
import tls from 'node:tls';

import { simpleParser } from 'mailparser';
import { UserFacingError } from './errors.js';
import { describeMailError } from './imap.js';
import { collectAttachments, collectRemoteImages } from './mailMedia.js';
import { verifySender } from './senderVerification.js';
import { PopCursor } from './mailCursor.js';
import { MailAccountInput, StoredPeople, SyncedMessage } from './types.js';

interface PopConnection {
  command(command: string, multiline?: boolean): Promise<string>;
  close(): void;
}

export async function testPop3(input: MailAccountInput): Promise<void> {
  let connection: PopConnection;
  try { connection = await connectPop3(input); }
  catch (error) { throw new UserFacingError(describeMailError(error, input, 'POP')); }
  try {
    await connection.command(`USER ${input.username}`);
    await connection.command(`PASS ${input.password}`);
    await connection.command('STAT');
    await connection.command('QUIT');
  } catch (error) {
    throw new UserFacingError(describeMailError(error, input, 'POP'));
  } finally { connection.close(); }
}

export interface PopSyncOptions {
  /** Where the last sync left the mailbox: unchanged means nothing is downloaded. */
  cursor?: PopCursor;
  /** Called after a finished sync with where it left the mailbox. */
  onCursor?: (cursor: PopCursor) => void;
  /** Stored Message-IDs, so only mail that isn't stored yet is returned. */
  known?: (sourceMessageIds: string[]) => Promise<Map<string, StoredPeople>>;
}

/**
 * Downloads the newest messages. POP has no way to wait for mail, so the app asks again every few
 * seconds; with a cursor, a mailbox that hasn't changed costs a sign-in, STAT and UIDL, and only
 * messages after the last one seen are downloaded. With `known`, only unstored mail is returned.
 */
export async function syncPop3(input: MailAccountInput, limit = 50, { cursor, onCursor, known }: PopSyncOptions = {}): Promise<SyncedMessage[]> {
  const connection = await connectPop3(input);
  try {
    await connection.command(`USER ${input.username}`);
    await connection.command(`PASS ${input.password}`);
    const stat = await connection.command('STAT');
    const count = Number(stat.split(/\s+/)[1] ?? 0);
    // Unique ids by message number; servers without UIDL fall back to comparing the count.
    const ids = count ? await connection.command('UIDL', true).then(parseUidl, () => new Map<number, string>()) : new Map<number, string>();
    const reached = { count, last: ids.get(count) ?? '' };
    if (cursor && cursor.count === reached.count && cursor.last === reached.last) {
      await connection.command('QUIT');
      onCursor?.(reached);
      return [];
    }
    // Only messages after the newest one seen last time, when it is still there.
    const seenAt = cursor?.last ? [...ids].find(([, id]) => id === cursor.last)?.[0] : undefined;
    const messages: SyncedMessage[] = [];
    for (let index = Math.max(1, count - limit + 1, (seenAt ?? 0) + 1); index <= count; index += 1) {
      const source = await connection.command(`RETR ${index}`, true);
      const parsed = await simpleParser(source);
      const brand = await verifySender(parsed.from?.value[0]?.address ?? '', parsed.headerLines);
      messages.push({
        sourceMessageId: parsed.messageId ?? `pop-${index}`,
        mailbox: 'POP Inbox', subject: parsed.subject ?? '',
        from: parsed.from?.text ?? '', to: [parsed.to, parsed.cc].flatMap((list) => (list ? (Array.isArray(list) ? list.map((address) => address.text) : [list.text]) : [])),
        sentAt: messageDate(parsed).toISOString(), text: parsed.text?.slice(0, 50_000) ?? '',
        senderVerified: brand.verified, senderLogoUrl: brand.logoUrl,
        remoteImages: collectRemoteImages(parsed.html), attachments: collectAttachments(parsed.attachments),
        inReplyTo: parsed.inReplyTo,
      });
    }
    await connection.command('QUIT');
    onCursor?.(reached);
    if (!known) return messages;
    const stored = await known(messages.map((message) => message.sourceMessageId));
    return messages.filter((message) => !stored.has(message.sourceMessageId));
  } finally { connection.close(); }
}

/** "1 abc\r\n2 def" → message number → unique id. */
function parseUidl(listing: string): Map<number, string> {
  const ids = new Map<number, string>();
  for (const line of listing.split('\r\n')) {
    const [number, id] = line.trim().split(/\s+/);
    if (number && id) ids.set(Number(number), id);
  }
  return ids;
}

async function connectPop3(input: MailAccountInput): Promise<PopConnection> {
  if (!input.secure && !input.allowPlaintext) throw new Error('Unencrypted POP is disabled. Use POP over TLS on port 995.');
  const socket = input.allowPlaintext
    ? net.connect({ host: input.host, port: input.port })
    : tls.connect({ host: input.host, port: input.port, servername: input.tlsServername ?? input.host, rejectUnauthorized: true });
  let buffer = '';
  let failure: Error | undefined;
  let waiter: ((line: string) => void) | undefined;
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => { buffer += chunk; waiter?.(buffer); });
  // Stop waiting if the server goes quiet or the connection drops.
  const fail = (error: Error) => { failure ??= error; waiter?.(buffer); };
  socket.setTimeout(30_000, () => { fail(new Error('POP server timed out')); socket.destroy(); });
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('POP connection closed')));
  await new Promise<void>((resolve, reject) => { socket.once(input.allowPlaintext ? 'connect' : 'secureConnect', () => resolve()); socket.once('error', reject); });

  const readResponse = async (multiline = false) => {
    // An error is always one line, even for a command that answers with a list.
    const terminatorFor = () => (multiline && !buffer.startsWith('-') ? '\r\n.\r\n' : '\r\n');
    let terminator = terminatorFor();
    while (!buffer.includes((terminator = terminatorFor()))) {
      if (failure) throw failure;
      await new Promise<string>((resolve) => { waiter = resolve; });
    }
    waiter = undefined;
    const end = buffer.indexOf(terminator) + terminator.length;
    const response = buffer.slice(0, end);
    buffer = buffer.slice(end);
    if (!response.startsWith('+OK')) throw new Error(response.split('\r\n')[0] || 'POP server rejected the request.');
    return multiline ? response.replace(/^\+OK[^\r\n]*\r\n/, '').replace(/\r\n\.\r\n$/, '').replace(/^\.\./gm, '.') : response.trim();
  };
  await readResponse();
  return { command: async (command, multiline = false) => { socket.write(`${command}\r\n`); return readResponse(multiline); }, close: () => socket.destroy() };
}

/** The Date header, else the newest Received timestamp, so undated mail keeps a stable time across syncs. */
export function messageDate(parsed: { date?: Date; headers: Map<string, unknown> }): Date {
  if (parsed.date && !Number.isNaN(parsed.date.getTime())) return parsed.date;
  const received = parsed.headers.get('received');
  const first = Array.isArray(received) ? received[0] : received;
  const stamp = typeof first === 'string' ? first.split(';').pop()?.trim() : undefined;
  const date = stamp ? new Date(stamp) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : new Date(0);
}

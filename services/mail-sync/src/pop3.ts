import net from 'node:net';
import tls from 'node:tls';

import { simpleParser } from 'mailparser';
import { UserFacingError } from './errors.js';
import { describeMailError } from './imap.js';
import { MailAccountInput, SyncedMessage } from './types.js';

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

export async function syncPop3(input: MailAccountInput, limit = 50): Promise<SyncedMessage[]> {
  const connection = await connectPop3(input);
  try {
    await connection.command(`USER ${input.username}`);
    await connection.command(`PASS ${input.password}`);
    const stat = await connection.command('STAT');
    const count = Number(stat.split(/\s+/)[1] ?? 0);
    const messages: SyncedMessage[] = [];
    for (let index = Math.max(1, count - limit + 1); index <= count; index += 1) {
      const source = await connection.command(`RETR ${index}`, true);
      const parsed = await simpleParser(source);
      messages.push({
        sourceMessageId: parsed.messageId ?? `pop-${index}`,
        mailbox: 'POP Inbox', subject: parsed.subject ?? '',
        from: parsed.from?.text ?? '', to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((address) => address.text) : [parsed.to.text]) : [],
        sentAt: messageDate(parsed).toISOString(), text: parsed.text?.slice(0, 50_000) ?? '',
      });
    }
    await connection.command('QUIT');
    return messages;
  } finally { connection.close(); }
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
    const terminator = multiline ? '\r\n.\r\n' : '\r\n';
    while (!buffer.includes(terminator)) {
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

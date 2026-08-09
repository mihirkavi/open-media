import tls from 'node:tls';

import { simpleParser } from 'mailparser';
import { MailAccountInput, SyncedMessage } from './types.js';

interface PopConnection {
  command(command: string, multiline?: boolean): Promise<string>;
  close(): void;
}

export async function testPop3(input: MailAccountInput): Promise<void> {
  const connection = await connectPop3(input);
  try {
    await connection.command(`USER ${input.username}`);
    await connection.command(`PASS ${input.password}`);
    await connection.command('STAT');
    await connection.command('QUIT');
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
        sentAt: (parsed.date ?? new Date()).toISOString(), text: parsed.text?.slice(0, 50_000) ?? '',
      });
    }
    await connection.command('QUIT');
    return messages;
  } finally { connection.close(); }
}

async function connectPop3(input: MailAccountInput): Promise<PopConnection> {
  if (!input.secure) throw new Error('Unencrypted POP is disabled. Use POP over TLS on port 995.');
  const socket = tls.connect({ host: input.host, port: input.port, servername: input.tlsServername ?? input.host, rejectUnauthorized: true });
  let buffer = '';
  let waiter: ((line: string) => void) | undefined;
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => { buffer += chunk; waiter?.(buffer); });
  await new Promise<void>((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });

  const readResponse = async (multiline = false) => {
    const terminator = multiline ? '\r\n.\r\n' : '\r\n';
    while (!buffer.includes(terminator)) await new Promise<string>((resolve) => { waiter = resolve; });
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

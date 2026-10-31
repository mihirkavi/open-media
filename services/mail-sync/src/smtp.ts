import net from 'node:net';
import tls from 'node:tls';

import MailComposer from 'nodemailer/lib/mail-composer';

import { UserFacingError } from './errors.js';
import { MailAccountInput, OutgoingMail, SmtpSettings, SyncedMessage } from './types.js';

/** Connection details after the hostname has been checked and resolved. */
export interface SmtpConnection extends SmtpSettings {
  /** Hostname (or local test address) to connect to; TLS is validated against `host`. */
  address: string;
  /** Local development only: plaintext to a local test server such as Mailpit. */
  allowPlaintext?: boolean;
}

/**
 * A byte stream to a mail server that can switch to TLS mid-session (STARTTLS).
 *
 * On Cloudflare Workers this must be the runtime's own socket: Node's tls.connect({ socket })
 * upgrade, which nodemailer uses, completes on Cloudflare's network but the server then drops
 * the connection, so every STARTTLS server (iCloud, Outlook, most 587s) failed to sign in.
 */
export interface SmtpSocket {
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  startTls(): Promise<void>;
  close(): void;
}

/** A reply from the server that wasn't the one we needed. */
export class SmtpReplyError extends Error {
  constructor(readonly stage: 'connect' | 'auth' | 'send', readonly reply: string) {
    super(`SMTP ${stage} failed: ${reply}`);
  }
}

const clientName = 'openmedia.site';
const stepTimeoutMs = 30_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Logs in to the outgoing server without sending anything. */
export async function testSmtp(connection: SmtpConnection, account: Pick<MailAccountInput, 'username' | 'password'>, open = openSocket): Promise<void> {
  let session: SmtpSession | undefined;
  try {
    session = await signIn(await open(connection), connection, account);
    await session.quit();
  } catch (error) {
    throw new UserFacingError(describeSmtpError(error, connection));
  } finally {
    session?.close();
  }
}

/** Sends one plain-text email and returns it in the stored-message shape. */
export async function sendSmtp(
  connection: SmtpConnection,
  account: Pick<MailAccountInput, 'email' | 'username' | 'password'>,
  mail: OutgoingMail,
  open = openSocket,
): Promise<SyncedMessage> {
  const message = new MailComposer({
    from: account.email,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: [mail.inReplyTo] } : {}),
  }).compile();
  const raw = await message.build();
  const envelope = message.getEnvelope();
  let session: SmtpSession | undefined;
  try {
    session = await signIn(await open(connection), connection, account);
    await session.command(`MAIL FROM:<${envelope.from}>`, [250], 'send');
    for (const recipient of envelope.to) await session.command(`RCPT TO:<${recipient}>`, [250, 251], 'send');
    await session.command('DATA', [354], 'send');
    await session.data(raw.toString('utf8'));
    await session.quit();
  } catch {
    throw new UserFacingError('The outgoing mail server did not accept this message. Try again, or check the mailbox settings.');
  } finally {
    session?.close();
  }
  return {
    sourceMessageId: message.messageId(),
    mailbox: 'Sent',
    subject: mail.subject,
    from: account.email,
    to: mail.to,
    sentAt: new Date().toISOString(),
    text: mail.text,
    inReplyTo: mail.inReplyTo,
  };
}

/** Greeting, EHLO, STARTTLS when asked for, and AUTH (PLAIN, or LOGIN if that's all it offers). */
async function signIn(socket: SmtpSocket, connection: SmtpConnection, account: Pick<MailAccountInput, 'username' | 'password'>): Promise<SmtpSession> {
  const session = new SmtpSession(socket);
  try {
    await session.reply([220], 'connect');
    let features = await session.command(`EHLO ${clientName}`, [250], 'connect');
    // A local test server (allowPlaintext) gets neither TLS nor a password.
    if (connection.allowPlaintext) return session;
    if (connection.security === 'starttls') {
      if (!/^250[ -]STARTTLS\b/im.test(features)) throw new SmtpReplyError('connect', 'The server does not offer STARTTLS.');
      await session.command('STARTTLS', [220], 'connect');
      await socket.startTls();
      features = await session.command(`EHLO ${clientName}`, [250], 'connect');
    }
    const mechanisms = features.match(/^250[ -]AUTH[ =](.*)$/im)?.[1].toUpperCase().split(/\s+/) ?? [];
    if (mechanisms.includes('PLAIN') || !mechanisms.includes('LOGIN')) {
      await session.command(`AUTH PLAIN ${base64(`\0${account.username}\0${account.password}`)}`, [235], 'auth');
    } else {
      await session.command('AUTH LOGIN', [334], 'auth');
      await session.command(base64(account.username), [334], 'auth');
      await session.command(base64(account.password), [235], 'auth');
    }
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

class SmtpSession {
  private buffered = '';

  constructor(private readonly socket: SmtpSocket) {}

  /** Reads one reply, joining the lines of a multi-line one ("250-…" … "250 …"). */
  async reply(expected: number[], stage: SmtpReplyError['stage']): Promise<string> {
    const lines: string[] = [];
    for (;;) {
      let end: number;
      while ((end = this.buffered.indexOf('\r\n')) >= 0) {
        const line = this.buffered.slice(0, end);
        this.buffered = this.buffered.slice(end + 2);
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) {
          const reply = lines.join('\n');
          if (!expected.includes(Number(line.slice(0, 3)))) throw new SmtpReplyError(stage, reply);
          return reply;
        }
      }
      const chunk = await withTimeout(this.socket.read());
      if (!chunk) throw new SmtpReplyError(stage, 'The server closed the connection.');
      this.buffered += decoder.decode(chunk, { stream: true });
    }
  }

  /** Sends one command and reads its reply. Errors carry only the server's reply, never the command. */
  async command(line: string, expected: number[], stage: SmtpReplyError['stage']): Promise<string> {
    await withTimeout(this.socket.write(encoder.encode(`${line}\r\n`)));
    return this.reply(expected, stage);
  }

  /** The message body after DATA: CRLF line endings, leading dots doubled, then "." on its own line. */
  async data(raw: string): Promise<void> {
    const body = raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    await withTimeout(this.socket.write(encoder.encode(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`)));
    await this.reply([250], 'send');
  }

  async quit(): Promise<void> {
    try { await this.command('QUIT', [221], 'send'); } catch { /* the work is done either way */ }
  }

  close(): void {
    this.socket.close();
  }
}

function describeSmtpError(error: unknown, connection: SmtpConnection): string {
  const where = `${connection.host}:${connection.port}`;
  if (error instanceof SmtpReplyError && error.stage === 'auth') {
    const reply = error.reply.split('\n').pop()?.slice(0, 160) ?? '';
    return `The outgoing mail server ${where} didn't accept the username or app password${reply ? ` (it said “${reply}”)` : ''}. Check that the username is your full email address and that the app password is typed as shown.`;
  }
  return `Could not sign in to the outgoing mail server ${where}. Check the server, port, security, and app password.`;
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SmtpReplyError('connect', 'The server did not respond in time.')), stepTimeoutMs); });
  try { return await Promise.race([work, timeout]); }
  finally { clearTimeout(timer); }
}

/** Cloudflare's socket on Workers, Node's elsewhere (local development and tests). */
export async function openSocket(connection: SmtpConnection): Promise<SmtpSocket> {
  const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
  return onWorkers ? openWorkersSocket(connection) : openNodeSocket(connection);
}

async function openWorkersSocket(connection: SmtpConnection): Promise<SmtpSocket> {
  const { connect } = await import('cloudflare:sockets');
  const secureTransport = connection.allowPlaintext ? 'off' : connection.security === 'tls' ? 'on' : 'starttls';
  let socket = connect({ hostname: connection.address, port: connection.port }, { secureTransport, allowHalfOpen: false });
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  return {
    async read() {
      const { value, done } = await reader.read();
      return done ? null : value;
    },
    write: (bytes) => writer.write(bytes),
    async startTls() {
      reader.releaseLock();
      writer.releaseLock();
      socket = socket.startTls({ expectedServerHostname: connection.host });
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
    },
    close() {
      socket.close().catch(() => undefined);
    },
  };
}

async function openNodeSocket(connection: SmtpConnection): Promise<SmtpSocket> {
  const tlsOptions = { servername: connection.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' as const };
  let socket: net.Socket = connection.allowPlaintext || connection.security === 'starttls'
    ? net.connect({ host: connection.address, port: connection.port })
    : tls.connect({ host: connection.address, port: connection.port, ...tlsOptions });
  await withTimeout(new Promise<void>((resolve, reject) => {
    socket.once(socket instanceof tls.TLSSocket ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
  }));
  const chunks: Uint8Array[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  const listen = (current: net.Socket) => {
    current.on('data', (chunk: Buffer) => { chunks.push(chunk); wake?.(); });
    current.on('end', () => { ended = true; wake?.(); });
    current.on('error', () => { ended = true; wake?.(); });
  };
  listen(socket);
  return {
    async read() {
      while (!chunks.length && !ended) await new Promise<void>((resolve) => { wake = resolve; });
      wake = undefined;
      return chunks.shift() ?? null;
    },
    write: (bytes) => new Promise<void>((resolve, reject) => socket.write(bytes, (error) => error ? reject(error) : resolve())),
    async startTls() {
      const plain = socket;
      plain.removeAllListeners('data');
      plain.removeAllListeners('end');
      const secure = tls.connect({ socket: plain, ...tlsOptions });
      await withTimeout(new Promise<void>((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject); }));
      socket = secure;
      listen(secure);
    },
    close() {
      socket.destroy();
    },
  };
}

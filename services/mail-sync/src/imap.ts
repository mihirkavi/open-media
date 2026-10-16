import { ImapFlow } from 'imapflow';
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
  return client;
}

export async function testImap(input: MailAccountInput): Promise<void> {
  if (!input.secure && !input.allowPlaintext) throw new Error('Unencrypted IMAP is disabled. Use TLS on port 993.');
  const client = clientFor(input);
  try { await client.connect(); }
  catch (error) { throw new UserFacingError(describeMailError(error, input, 'IMAP')); }
  finally { if (client.usable) await client.logout(); }
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

/** Reads the newest messages from INBOX and the Sent folder, so threads show both sides. */
export async function syncImap(input: MailAccountInput, limit = 100): Promise<SyncedMessage[]> {
  const client = clientFor(input);
  const messages: SyncedMessage[] = [];
  try {
    await client.connect();
    const folders = await client.list();
    const sent = folders.find((folder) => folder.specialUse === '\\Sent')?.path;
    for (const path of ['INBOX', ...(sent ? [sent] : [])]) {
      messages.push(...await fetchRecent(client, path, path === 'INBOX' ? 'INBOX' : 'Sent', limit));
    }
    return messages;
  } finally { if (client.usable) await client.logout(); }
}

async function fetchRecent(client: ImapFlow, path: string, mailbox: string, limit: number): Promise<SyncedMessage[]> {
  const opened = await client.mailboxOpen(path, { readOnly: true });
  if (!opened.exists) return [];
  const first = Math.max(1, opened.exists - limit + 1);
  const messages: SyncedMessage[] = [];
  for await (const item of client.fetch(`${first}:*`, { uid: true, envelope: true, source: true, internalDate: true })) {
    const parsed = item.source ? await simpleParser(item.source) : undefined;
    const fromAddress = item.envelope?.from?.[0]?.address ?? '';
    const brand = parsed && mailbox !== 'Sent' ? await verifySender(fromAddress, parsed.headerLines) : { verified: false };
    messages.push({
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
    });
  }
  return messages;
}

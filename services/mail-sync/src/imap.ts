import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { MailAccountInput, SyncedMessage } from './types.js';

function clientFor(input: MailAccountInput): ImapFlow {
  return new ImapFlow({
    host: input.host, port: input.port, secure: input.allowPlaintext ? false : input.secure,
    ...(input.allowPlaintext ? { doSTARTTLS: false } : {}),
    auth: { user: input.username, pass: input.password },
    logger: false, tls: { rejectUnauthorized: true, servername: input.tlsServername ?? input.host },
  });
}

export async function testImap(input: MailAccountInput): Promise<void> {
  if (!input.secure && !input.allowPlaintext) throw new Error('Unencrypted IMAP is disabled. Use TLS on port 993.');
  const client = clientFor(input);
  try { await client.connect(); } finally { if (client.usable) await client.logout(); }
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
    messages.push({
      sourceMessageId: item.envelope?.messageId ?? `imap-${mailbox}-${item.uid}`,
      mailbox, subject: item.envelope?.subject ?? '',
      from: item.envelope?.from?.map((address) => address.address ?? address.name ?? '').filter(Boolean).join(', ') ?? '',
      to: item.envelope?.to?.map((address) => address.address ?? address.name ?? '').filter(Boolean) ?? [],
      sentAt: new Date(item.envelope?.date ?? item.internalDate ?? Date.now()).toISOString(),
      text: parsed?.text?.slice(0, 50_000) ?? '',
    });
  }
  return messages;
}

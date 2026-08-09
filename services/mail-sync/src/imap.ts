import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { MailAccountInput, SyncedMessage } from './types.js';

function clientFor(input: MailAccountInput): ImapFlow {
  return new ImapFlow({
    host: input.host, port: input.port, secure: input.secure,
    auth: { user: input.username, pass: input.password },
    logger: false, tls: { rejectUnauthorized: true, servername: input.tlsServername ?? input.host },
  });
}

export async function testImap(input: MailAccountInput): Promise<void> {
  if (!input.secure) throw new Error('Unencrypted IMAP is disabled. Use TLS on port 993.');
  const client = clientFor(input);
  try { await client.connect(); } finally { if (client.usable) await client.logout(); }
}

export async function syncImap(input: MailAccountInput, limit = 100): Promise<SyncedMessage[]> {
  const client = clientFor(input);
  const messages: SyncedMessage[] = [];
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    if (!mailbox.exists) return [];
    const first = Math.max(1, mailbox.exists - limit + 1);
    for await (const item of client.fetch(`${first}:*`, { uid: true, envelope: true, source: true, internalDate: true })) {
      const parsed = item.source ? await simpleParser(item.source) : undefined;
      messages.push({
        sourceMessageId: item.envelope?.messageId ?? `imap-${item.uid}`,
        mailbox: 'INBOX', subject: item.envelope?.subject ?? '',
        from: item.envelope?.from?.map((address) => address.address ?? address.name ?? '').filter(Boolean).join(', ') ?? '',
        to: item.envelope?.to?.map((address) => address.address ?? address.name ?? '').filter(Boolean) ?? [],
        sentAt: new Date(item.envelope?.date ?? item.internalDate ?? Date.now()).toISOString(),
        text: parsed?.text?.slice(0, 50_000) ?? '',
      });
    }
    return messages;
  } finally { if (client.usable) await client.logout(); }
}

import nodemailer from 'nodemailer';

import { MailAccountInput, OutgoingMail, SmtpSettings, SyncedMessage } from './types.js';

/** Connection details after the hostname has been checked and resolved. */
export interface SmtpConnection extends SmtpSettings {
  /** Resolved address to connect to; TLS is still validated against `host`. */
  address: string;
  /** Local development only: plaintext to a local test server such as Mailpit. */
  allowPlaintext?: boolean;
}

function transportFor(connection: SmtpConnection, account: Pick<MailAccountInput, 'username' | 'password'>) {
  const plaintext = Boolean(connection.allowPlaintext);
  return nodemailer.createTransport({
    host: connection.address,
    port: connection.port,
    secure: !plaintext && connection.security === 'tls',
    requireTLS: !plaintext && connection.security === 'starttls',
    ignoreTLS: plaintext,
    auth: plaintext ? undefined : { user: account.username, pass: account.password },
    tls: { servername: connection.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/** Logs in to the outgoing server without sending anything. */
export async function testSmtp(connection: SmtpConnection, account: Pick<MailAccountInput, 'username' | 'password'>): Promise<void> {
  const transport = transportFor(connection, account);
  try {
    await transport.verify();
  } catch {
    throw new Error(`Could not sign in to the outgoing mail server ${connection.host}:${connection.port}. Check the server, port, security, and app password.`);
  } finally {
    transport.close();
  }
}

/** Sends one plain-text email and returns it in the stored-message shape. */
export async function sendSmtp(
  connection: SmtpConnection,
  account: Pick<MailAccountInput, 'email' | 'username' | 'password'>,
  mail: OutgoingMail,
): Promise<SyncedMessage> {
  const transport = transportFor(connection, account);
  try {
    const info = await transport.sendMail({
      from: account.email,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: [mail.inReplyTo] } : {}),
    });
    return {
      sourceMessageId: info.messageId,
      mailbox: 'Sent',
      subject: mail.subject,
      from: account.email,
      to: mail.to,
      sentAt: new Date().toISOString(),
      text: mail.text,
    };
  } catch {
    throw new Error('The outgoing mail server did not accept this message. Try again, or check the mailbox settings.');
  } finally {
    transport.close();
  }
}

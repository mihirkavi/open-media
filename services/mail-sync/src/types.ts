export type MailProtocol = 'imap' | 'pop3';

export interface MailAccountInput {
  email: string;
  protocol: MailProtocol;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** Resolved IP connections still validate TLS against the user-configured hostname. */
  tlsServername?: string;
}

export interface StoredMailAccount extends Omit<MailAccountInput, 'password'> {
  id: string;
  userId: string;
  encryptedSecret: string;
  status: 'connected' | 'error';
}

export interface SyncedMessage {
  sourceMessageId: string;
  mailbox: string;
  subject: string;
  from: string;
  to: string[];
  sentAt: string;
  text: string;
}

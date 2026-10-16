export type MailProtocol = 'imap' | 'pop3';

/** `tls` is implicit TLS (usually port 465); `starttls` upgrades a plain connection (usually 587). */
export type SmtpSecurity = 'tls' | 'starttls';

export interface SmtpSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
}

export interface MailAccountInput {
  email: string;
  protocol: MailProtocol;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** Outgoing server. Uses the same username and password as the incoming server. */
  smtp?: SmtpSettings;
  /** Resolved IP connections still validate TLS against the user-configured hostname. */
  tlsServername?: string;
  /** Set only by the Worker for local test servers in development; never accepted from clients. */
  allowPlaintext?: boolean;
}

export interface StoredMailAccount extends Omit<MailAccountInput, 'password'> {
  id: string;
  userId: string;
  encryptedSecret: string;
  status: 'connected' | 'error';
}

export interface PublicMailAccount {
  id: string;
  email: string;
  protocol: MailProtocol;
  status: 'connected' | 'error';
  canSend: boolean;
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

export interface OutgoingMail {
  to: string[];
  subject: string;
  text: string;
  /** Message-ID being replied to, for threading in the recipient's mail client. */
  inReplyTo?: string;
}

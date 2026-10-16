import { getAPIAccessToken, getSupabaseClient } from '../auth/supabase';
import { SmtpSecurity } from '../domain/mailPresets';

export type MailProtocol = 'imap' | 'pop3';

export interface MailAccountConfiguration {
  email: string;
  protocol: MailProtocol;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** Outgoing server; uses the same username and password. Omit for a read-only mailbox. */
  smtp?: { host: string; port: number; security: SmtpSecurity };
}

export interface ConnectedMailAccount {
  id: string;
  email: string;
  protocol: MailProtocol;
  status: 'connected' | 'syncing' | 'error';
  canSend: boolean;
}

export interface SyncedMailMessage {
  sourceMessageId: string;
  mailbox: string;
  subject: string;
  from: string;
  to: string[];
  sentAt: string;
  text: string;
}

/** A stored email plus the mailbox it belongs to. */
export interface StoredMailMessage extends SyncedMailMessage {
  accountId: string;
  accountEmail: string;
  /** DMARC-authenticated sender with a BIMI mark certificate (checked by the mail service). */
  senderVerified?: boolean;
  senderLogoUrl?: string;
}

export interface OutgoingMail {
  to: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
}

export async function connectMailAccount(configuration: MailAccountConfiguration): Promise<ConnectedMailAccount> {
  return await request<ConnectedMailAccount>('/v1/mail-accounts', { method: 'POST', body: configuration }, 'The mail server rejected this account.');
}

export async function listMailAccounts(): Promise<ConnectedMailAccount[]> {
  const payload = await request<{ accounts?: ConnectedMailAccount[] }>('/v1/mail-accounts', {}, 'Could not load connected mailboxes.');
  return (payload.accounts ?? []).map((account) => ({ ...account, canSend: Boolean(account.canSend) }));
}

export async function disconnectMailAccount(accountId: string): Promise<void> {
  await request(`/v1/mail-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }, 'Could not disconnect this mailbox.');
}

export async function syncMailAccount(accountId: string): Promise<SyncedMailMessage[]> {
  const payload = await request<{ messages?: SyncedMailMessage[] }>(`/v1/mail-accounts/${encodeURIComponent(accountId)}/sync`, { method: 'POST' }, 'Mailbox sync failed.');
  return payload.messages ?? [];
}

export async function sendMail(accountId: string, mail: OutgoingMail): Promise<SyncedMailMessage> {
  const payload = await request<{ message: SyncedMailMessage }>(`/v1/mail-accounts/${encodeURIComponent(accountId)}/send`, { method: 'POST', body: mail }, 'The email could not be sent.');
  return payload.message;
}

/** Email already stored for this account (inbound and sent), newest first. */
export async function listStoredMail(limit = 500): Promise<StoredMailMessage[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.rpc('open_media_list_mail_messages', { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    accountId: String(row.account_id),
    accountEmail: String(row.account_email),
    sourceMessageId: String(row.source_message_id),
    mailbox: String(row.mailbox),
    subject: String(row.subject ?? ''),
    from: String(row.sender ?? ''),
    to: Array.isArray(row.recipients) ? row.recipients.map(String) : [],
    sentAt: String(row.sent_at),
    text: String(row.body_text ?? ''),
    senderVerified: row.sender_verified === true,
    senderLogoUrl: typeof row.sender_logo_url === 'string' && row.sender_logo_url.startsWith('https://') ? row.sender_logo_url : undefined,
  }));
}

async function request<T = unknown>(path: string, init: { method?: string; body?: unknown }, fallbackError: string): Promise<T> {
  const token = await getAPIAccessToken();
  let response: Response;
  try {
    response = await fetch(`${getAPIURL()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error(`Can’t reach the Open Media mail service at ${getAPIURL()}. If you’re running locally, start everything with \`npm run local\`.`);
  }
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? fallbackError);
  return payload;
}

function configuredAPIURL(): string | undefined {
  return (process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? process.env.EXPO_PUBLIC_CONVO_API_URL)?.replace(/\/$/, '');
}

function getAPIURL(): string {
  const configured = configuredAPIURL();
  if (configured) return configured;
  if (__DEV__) return 'http://127.0.0.1:8787';
  throw new Error('The Open Media mail service is not configured for this build.');
}

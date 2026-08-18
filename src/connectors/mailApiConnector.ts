import { getAPIAccessToken } from '../auth/supabase';

export type MailProtocol = 'imap' | 'pop3';

export interface MailAccountConfiguration {
  email: string;
  protocol: MailProtocol;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface ConnectedMailAccount {
  id: string;
  email: string;
  protocol: MailProtocol;
  status: 'connected' | 'syncing' | 'error';
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

export async function connectMailAccount(configuration: MailAccountConfiguration): Promise<ConnectedMailAccount> {
  const apiURL = getAPIURL();

  const token = await getAPIAccessToken();
  const response = await fetch(`${apiURL}/v1/mail-accounts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(__DEV__ ? { 'x-convo-local-user': 'expo-development-user' } : {}),
    },
    body: JSON.stringify(configuration),
  });
  const payload = await response.json() as ConnectedMailAccount & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'The mail server rejected this account.');
  return payload;
}

export async function listMailAccounts(): Promise<ConnectedMailAccount[]> {
  const response = await fetch(`${getAPIURL()}/v1/mail-accounts`, { headers: await authHeaders() });
  const payload = await response.json() as { accounts?: ConnectedMailAccount[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Could not load connected mailboxes.');
  return payload.accounts ?? [];
}

export async function disconnectMailAccount(accountId: string): Promise<void> {
  const response = await fetch(`${getAPIURL()}/v1/mail-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE', headers: await authHeaders() });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Could not disconnect this mailbox.');
}


export async function syncMailAccount(accountId: string): Promise<SyncedMailMessage[]> {
  const apiURL = getAPIURL();
  const token = await getAPIAccessToken();
  const response = await fetch(`${apiURL}/v1/mail-accounts/${encodeURIComponent(accountId)}/sync`, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(__DEV__ ? { 'x-convo-local-user': 'expo-development-user' } : {}),
    },
  });
  const payload = await response.json() as { messages?: SyncedMailMessage[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Mailbox sync failed.');
  return payload.messages ?? [];
}

function getAPIURL(): string {
  const configured = (process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? process.env.EXPO_PUBLIC_CONVO_API_URL)?.replace(/\/$/, '');
  if (configured) return configured;
  if (__DEV__) return 'http://127.0.0.1:8787';
  throw new Error('The Open Media mail service is not configured for this build.');
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAPIAccessToken();
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(__DEV__ ? { 'x-convo-local-user': 'expo-development-user' } : {}),
  };
}

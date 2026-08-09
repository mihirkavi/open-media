import * as SecureStore from 'expo-secure-store';

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

  const token = await SecureStore.getItemAsync('convo.sessionToken');
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


export async function syncMailAccount(accountId: string): Promise<SyncedMailMessage[]> {
  const apiURL = getAPIURL();
  const token = await SecureStore.getItemAsync('convo.sessionToken');
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
  const configured = process.env.EXPO_PUBLIC_CONVO_API_URL?.replace(/\/$/, '');
  if (configured) return configured;
  if (__DEV__) return 'http://127.0.0.1:8787';
  throw new Error('The Convo mail service is not configured for this build.');
}

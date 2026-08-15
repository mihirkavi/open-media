import { MailAccountInput, StoredMailAccount, SyncedMessage } from './types.js';

interface AccountRow {
  id: string;
  user_id: string;
  email: string;
  protocol: 'imap' | 'pop3';
  host: string;
  port: number;
  secure: boolean;
  username: string;
  encrypted_secret: string;
  status: 'connected' | 'error';
}

export class SupabaseRestRepository {
  constructor(
    private readonly supabaseURL: string,
    private readonly publishableKey: string,
    private readonly accessToken: string,
  ) {}

  async saveAccount(
    userId: string,
    input: Omit<MailAccountInput, 'password'>,
    encryptedSecret: string,
  ): Promise<StoredMailAccount> {
    const id = await this.rpc<string>('convo_save_mail_account', {
      p_email: input.email,
      p_protocol: input.protocol,
      p_host: input.host,
      p_port: input.port,
      p_secure: input.secure,
      p_username: input.username,
      p_encrypted_secret: encryptedSecret,
    });
    return { ...input, id, userId, encryptedSecret, status: 'connected' };
  }

  async findAccount(userId: string, accountId: string): Promise<StoredMailAccount | undefined> {
    const rows = await this.rpc<AccountRow[]>('convo_get_mail_account', { p_account_id: accountId });
    const row = rows[0];
    if (!row || row.user_id !== userId) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      protocol: row.protocol,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      encryptedSecret: row.encrypted_secret,
      status: row.status,
    };
  }

  async saveMessages(_userId: string, accountId: string, messages: SyncedMessage[]): Promise<void> {
    await this.rpc('convo_save_mail_messages', { p_account_id: accountId, p_messages: messages });
  }

  private async rpc<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.supabaseURL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('A valid Open Media session is required.');
      throw new Error('Open Media mail storage is temporarily unavailable.');
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}

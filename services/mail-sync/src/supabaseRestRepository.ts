import { MailAccountInput, PublicMailAccount, StoredMailAccount, SyncedMessage } from './types.js';

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
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: 'tls' | 'starttls' | null;
}

interface AccountListRow {
  id: string;
  email: string;
  protocol: 'imap' | 'pop3';
  status: 'connected' | 'error';
  can_send: boolean;
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
    const id = await this.rpc<string>('open_media_save_mail_account', {
      p_email: input.email,
      p_protocol: input.protocol,
      p_host: input.host,
      p_port: input.port,
      p_secure: input.secure,
      p_username: input.username,
      p_encrypted_secret: encryptedSecret,
      p_smtp_host: input.smtp?.host ?? null,
      p_smtp_port: input.smtp?.port ?? null,
      p_smtp_security: input.smtp?.security ?? null,
    });
    return { ...input, id, userId, encryptedSecret, status: 'connected' };
  }

  async findAccount(userId: string, accountId: string): Promise<StoredMailAccount | undefined> {
    const rows = await this.rpc<AccountRow[]>('open_media_get_mail_account', { p_account_id: accountId });
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
      ...(row.smtp_host && row.smtp_port && row.smtp_security
        ? { smtp: { host: row.smtp_host, port: row.smtp_port, security: row.smtp_security } }
        : {}),
    };
  }

  async listAccounts(_userId: string): Promise<PublicMailAccount[]> {
    const rows = await this.rpc<AccountListRow[]>('open_media_list_mail_accounts', {});
    return rows.map((row) => ({ id: row.id, email: row.email, protocol: row.protocol, status: row.status, canSend: row.can_send }));
  }

  async deleteAccount(_userId: string, accountId: string): Promise<boolean> {
    return await this.rpc<boolean>('open_media_delete_mail_account', { p_account_id: accountId });
  }

  async saveMessages(_userId: string, accountId: string, messages: SyncedMessage[]): Promise<void> {
    // The database accepts at most 100 messages per call.
    for (let start = 0; start < messages.length; start += 100) {
      await this.rpc('convo_save_mail_messages', { p_account_id: accountId, p_messages: messages.slice(start, start + 100) });
    }
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

import { attachmentPath } from './mailMedia.js';
import { MailAccountInput, PublicMailAccount, StoredMailAccount, SyncedMessage } from './types.js';

const bucket = 'mail-attachments';

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

  async deleteAccount(userId: string, accountId: string): Promise<boolean> {
    // Storage files are not removed by the database cascade; delete them first.
    await this.removeFolder(`${userId}/${accountId}`);
    return await this.rpc<boolean>('open_media_delete_mail_account', { p_account_id: accountId });
  }

  async saveMessages(userId: string, accountId: string, messages: SyncedMessage[]): Promise<void> {
    const stored = new Set(messages.some((message) => message.attachments?.length)
      ? await this.rpc<string[]>('open_media_mail_messages_with_attachments', { p_account_id: accountId })
      : []);
    const payload = [];
    for (const message of messages) {
      const attachments = [];
      for (const [position, attachment] of (message.attachments ?? []).entries()) {
        const path = attachmentPath(userId, accountId, message.sourceMessageId, position, attachment.filename);
        let storagePath: string | undefined;
        if (attachment.content && !stored.has(message.sourceMessageId)) {
          storagePath = (await this.upload(path, attachment.content, attachment.contentType)) ? path : undefined;
        } else if (attachment.content) {
          storagePath = path;
        }
        const { content: _content, ...metadata } = attachment;
        attachments.push({ ...metadata, storagePath });
      }
      payload.push({ ...message, attachments });
    }
    // The database accepts at most 100 messages per call.
    for (let start = 0; start < payload.length; start += 100) {
      await this.rpc('open_media_save_mail_messages', { p_account_id: accountId, p_messages: payload.slice(start, start + 100) });
    }
  }

  /** Uploads one file to the person's private folder; false if Storage refused it. */
  private async upload(path: string, content: Buffer, contentType: string): Promise<boolean> {
    const response = await fetch(`${this.supabaseURL}/storage/v1/object/${bucket}/${encodePath(path)}`, {
      method: 'POST',
      headers: { apikey: this.publishableKey, authorization: `Bearer ${this.accessToken}`, 'content-type': contentType, 'x-upsert': 'true', 'cache-control': '3600' },
      body: new Uint8Array(content),
    });
    return response.ok;
  }

  /** Deletes every file under a folder in the person's attachments bucket. */
  private async removeFolder(prefix: string): Promise<void> {
    const files: string[] = [];
    const walk = async (folder: string, depth: number) => {
      const response = await fetch(`${this.supabaseURL}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { apikey: this.publishableKey, authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: folder, limit: 1000 }),
      });
      if (!response.ok) return;
      for (const entry of await response.json() as Array<{ name: string; id: string | null }>) {
        const path = `${folder}/${entry.name}`;
        if (entry.id) files.push(path);
        else if (depth < 3) await walk(path, depth + 1);
      }
    };
    await walk(prefix, 0);
    for (let start = 0; start < files.length; start += 100) {
      await fetch(`${this.supabaseURL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { apikey: this.publishableKey, authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: files.slice(start, start + 100) }),
      });
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

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { MailAccountInput, PublicMailAccount, StoredMailAccount, SyncedMessage } from './types.js';

export interface Repository {
  saveAccount(userId: string, input: Omit<MailAccountInput, 'password'>, encryptedSecret: string): Promise<StoredMailAccount>;
  listAccounts(userId: string): Promise<PublicMailAccount[]>;
  findAccount(userId: string, accountId: string): Promise<StoredMailAccount | undefined>;
  deleteAccount(userId: string, accountId: string): Promise<boolean>;
  saveMessages(userId: string, accountId: string, messages: SyncedMessage[]): Promise<void>;
}

export function createRepository(databaseURL?: string): Repository {
  if (!databaseURL) return new MemoryRepository();
  const hostname = new URL(databaseURL).hostname;
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return new PostgresRepository(new pg.Pool({ connectionString: databaseURL, ssl: local ? undefined : { rejectUnauthorized: true } }));
}

class MemoryRepository implements Repository {
  private accounts = new Map<string, StoredMailAccount>();
  async saveAccount(userId: string, input: Omit<MailAccountInput, 'password'>, encryptedSecret: string) { const account: StoredMailAccount = { ...input, id: randomUUID(), userId, encryptedSecret, status: 'connected' }; this.accounts.set(account.id, account); return account; }
  async listAccounts(userId: string) { return [...this.accounts.values()].filter((account) => account.userId === userId).map(({ id, email, protocol, status }) => ({ id, email, protocol, status })); }
  async findAccount(userId: string, accountId: string) { const account = this.accounts.get(accountId); return account?.userId === userId ? account : undefined; }
  async deleteAccount(userId: string, accountId: string) { const account = this.accounts.get(accountId); return account?.userId === userId ? this.accounts.delete(accountId) : false; }
  async saveMessages() {}
}

class PostgresRepository implements Repository {
  constructor(private pool: pg.Pool) {}
  async saveAccount(userId: string, input: Omit<MailAccountInput, 'password'>, encryptedSecret: string): Promise<StoredMailAccount> {
    const result = await this.pool.query(`insert into private.mail_accounts (user_id,email,protocol,host,port,secure,username,encrypted_secret,status) values ($1,$2,$3,$4,$5,$6,$7,$8,'connected') returning id`, [userId,input.email,input.protocol,input.host,input.port,input.secure,input.username,encryptedSecret]);
    return { ...input, id: result.rows[0].id, userId, encryptedSecret, status: 'connected' };
  }
  async listAccounts(userId: string): Promise<PublicMailAccount[]> {
    const result = await this.pool.query(`select id,email,protocol,status from private.mail_accounts where user_id=$1 order by created_at desc`, [userId]);
    return result.rows;
  }
  async findAccount(userId: string, accountId: string): Promise<StoredMailAccount | undefined> {
    const result = await this.pool.query(`select id,user_id,email,protocol,host,port,secure,username,encrypted_secret,status from private.mail_accounts where id=$1 and user_id=$2`, [accountId,userId]);
    const row = result.rows[0]; if (!row) return undefined;
    return { id: row.id, userId: row.user_id, email: row.email, protocol: row.protocol, host: row.host, port: row.port, secure: row.secure, username: row.username, encryptedSecret: row.encrypted_secret, status: row.status };
  }
  async deleteAccount(userId: string, accountId: string): Promise<boolean> {
    const result = await this.pool.query(`delete from private.mail_accounts where id=$1 and user_id=$2`, [accountId,userId]);
    return (result.rowCount ?? 0) > 0;
  }
  async saveMessages(userId: string, accountId: string, messages: SyncedMessage[]): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query('begin'); for (const message of messages) await client.query(`insert into private.mail_messages (user_id,account_id,source_message_id,mailbox,subject,sender,recipients,sent_at,body_text) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (account_id,source_message_id) do update set subject=excluded.subject,sender=excluded.sender,recipients=excluded.recipients,sent_at=excluded.sent_at,body_text=excluded.body_text`, [userId,accountId,message.sourceMessageId,message.mailbox,message.subject,message.from,message.to,message.sentAt,message.text]); await client.query('commit'); } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
}

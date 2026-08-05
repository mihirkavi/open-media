import { Account, Conversation, DraftMessage, MessageSource } from '../domain/models';

export interface ConnectorCapabilities {
  source: MessageSource;
  read: boolean;
  send: boolean;
  realtime: boolean;
  attachments: boolean;
  notes: string;
}

export interface SyncResult {
  conversations: Conversation[];
  cursor?: string;
  hasMore: boolean;
}

export interface MessageConnector {
  capabilities: ConnectorCapabilities;
  connect(): Promise<Account>;
  disconnect(): Promise<void>;
  sync(cursor?: string): Promise<SyncResult>;
  send(draft: DraftMessage): Promise<void>;
}

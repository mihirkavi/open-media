export type MessageSource = 'gmail' | 'icloud' | 'imap' | 'linkedin' | 'meta';

export type ConnectorStatus = 'mock' | 'disconnected' | 'connected' | 'syncing' | 'error';

export interface Account {
  id: string;
  label: string;
  address: string;
  source: MessageSource;
  status: ConnectorStatus;
  unreadCount: number;
  color: string;
}

export interface Participant {
  id: string;
  name: string;
  address: string;
  initials: string;
  avatarColor: string;
}

export interface Message {
  id: string;
  sourceMessageId: string;
  conversationId: string;
  sender: Participant;
  recipients: Participant[];
  sentAt: string;
  body: string;
  direction: 'inbound' | 'outbound';
  deliveryState: 'received' | 'sent' | 'pending' | 'failed';
}

export interface Conversation {
  id: string;
  accountId: string;
  source: MessageSource;
  subject: string;
  participants: Participant[];
  messages: Message[];
  lastMessageAt: string;
  preview: string;
  unreadCount: number;
  starred?: boolean;
  labels: string[];
}

export interface DraftMessage {
  conversationId: string;
  body: string;
  replyToSourceMessageId?: string;
}

export type MessageSource = 'gmail' | 'icloud' | 'imap' | 'instagram' | 'linkedin' | 'snapchat' | 'sms';
export type MessageChannel = 'email' | 'social' | 'sms';
export type IdentityKind = 'email' | 'handle' | 'phone';

export type ConnectorStatus = 'mock' | 'disconnected' | 'connected' | 'syncing' | 'error';

export interface Account {
  id: string;
  label: string;
  address: string;
  source: MessageSource;
  status: ConnectorStatus;
}

export interface Identity {
  id: string;
  personId: string;
  kind: IdentityKind;
  value: string;
  source: MessageSource;
  label: string;
  verifiedByUser: boolean;
}

/** Canonical person record. Provider identities attach here only after review. */
export interface Person {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  identities: Identity[];
  favorite?: boolean;
}

export interface EmailContext {
  providerThreadId: string;
  subject: string;
}

export interface Message {
  id: string;
  sourceMessageId: string;
  conversationId: string;
  senderPersonId: string;
  senderIdentityId: string;
  recipientPersonIds: string[];
  sentAt: string;
  body: string;
  source: MessageSource;
  channel: MessageChannel;
  emailContext?: EmailContext;
  direction: 'inbound' | 'outbound';
  deliveryState: 'received' | 'sent' | 'pending' | 'failed';
}

export interface Conversation {
  id: string;
  /** One canonical person for direct chats; a stable set of people for groups. */
  participants: Person[];
  messages: Message[];
  sourceSummary: MessageSource[];
  lastMessageAt: string;
  preview: string;
  unreadCount: number;
  groupTitle?: string;
  starred?: boolean;
  labels: string[];
}

export interface DraftMessage {
  conversationId: string;
  body: string;
  preferredIdentityId?: string;
  replyToSourceMessageId?: string;
}

export type PeopleFilter = 'all' | 'direct' | 'groups' | 'favorites';

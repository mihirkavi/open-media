export type MessageSource = 'open_media' | 'matrix' | 'gmail' | 'icloud' | 'imap' | 'instagram' | 'linkedin' | 'snapchat' | 'sms' | BridgedNetwork;

/** Networks reached through Open Media's chat bridges (ADR 0011). */
export type BridgedNetwork = 'whatsapp' | 'telegram' | 'signal' | 'gmessages' | 'messenger' | 'twitter' | 'bluesky' | 'slack' | 'discord';
export type MessageChannel = 'native' | 'email' | 'social' | 'sms';
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
  /** True only when the person and phone number are saved in the device contacts. */
  isPhoneContact?: boolean;
  /** Set when mail from this sender passed DMARC and carries a BIMI mark certificate. */
  verifiedDomain?: string;
  /** Pictures to try in order (verified BIMI logo, then company icon); initials if none load. */
  avatarUrls?: string[];
}

export interface EmailContext {
  providerThreadId: string;
  subject: string;
  /** The other person's address on this message, and the mailbox it belongs to (for replies). */
  address?: string;
  accountId?: string;
  accountEmail?: string;
}

export interface MessageAttachment {
  name: string;
  contentType: string;
  size: number;
  /** Private storage path; absent when the file was too large to keep. */
  storagePath?: string;
  inline: boolean;
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
  attachments?: MessageAttachment[];
  /** HTTPS images referenced by an HTML email; shown only when the person asks. */
  remoteImages?: string[];
  /** The message this one replies to, in the same conversation (shown as a quote). */
  replyToMessageId?: string;
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
  /** Present for email conversations: which mailbox and address replies go through. */
  email?: EmailThreadInfo;
}

export interface EmailThreadInfo {
  accountId: string;
  accountEmail: string;
  /** The other person's email address. */
  address: string;
  /** Subject and Message-ID of the latest message, for threaded replies. */
  latestSubject: string;
  latestMessageId?: string;
  /** True when the mailbox has outgoing (SMTP) settings, so replies can be sent. */
  canSend?: boolean;
}

export interface DraftMessage {
  conversationId: string;
  body: string;
  preferredIdentityId?: string;
  replyToSourceMessageId?: string;
}

export type PeopleFilter = 'all' | 'direct' | 'groups' | 'favorites';

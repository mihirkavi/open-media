import { Account, Conversation, DraftMessage, MessageSource } from '../domain/models';
import { SocialPost } from '../domain/posts';

export type ConnectorKind = 'open-media' | 'email' | 'social' | 'protocol';
export type ConnectorOperation =
  | 'read-feed' | 'publish-post' | 'edit-post' | 'delete-post' | 'upload-media'
  | 'read-messages' | 'send-message' | 'read-email' | 'send-email'
  | 'attachments' | 'realtime' | 'webhooks';

export interface CapabilityState {
  operation: ConnectorOperation;
  available: boolean;
  reason?: string;
}

export interface ConnectorDescriptor {
  id: string;
  displayName: string;
  kind: ConnectorKind;
  authentication: 'none' | 'oauth2-pkce' | 'app-password' | 'protocol-key';
  status: 'available' | 'connected' | 'planned' | 'unavailable';
  capabilities: CapabilityState[];
}

export interface PublishRequest { post: SocialPost; idempotencyKey: string; }
export interface PublishResult { connectorId: string; status: 'published' | 'failed' | 'unsupported'; externalId?: string; error?: string; }

/** Capability-negotiated boundary for every social, protocol, mail, or messaging integration. */
export interface CommunicationConnector {
  descriptor(): ConnectorDescriptor;
  authenticate?(): Promise<void>;
  disconnect?(): Promise<void>;
  publishPost?(request: PublishRequest): Promise<PublishResult>;
  fetchFeed?(cursor?: string): Promise<{ posts: SocialPost[]; cursor?: string }>;
  syncMessages?(cursor?: string): Promise<SyncResult>;
  sendMessage?(draft: DraftMessage): Promise<void>;
}

export function supports(connector: ConnectorDescriptor, operation: ConnectorOperation) {
  return connector.capabilities.some((capability) => capability.operation === operation && capability.available);
}

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

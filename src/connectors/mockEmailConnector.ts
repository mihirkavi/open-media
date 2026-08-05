import { mockAccounts, mockConversations } from '../data/mockData';
import { MessageConnector } from './types';

/** Development-only connector. It performs no network or credential operations. */
export class MockEmailConnector implements MessageConnector {
  capabilities = {
    source: 'icloud' as const,
    read: true,
    send: false,
    realtime: false,
    attachments: false,
    notes: 'Local mock data only. Sending is intentionally disabled.',
  };

  async connect() {
    return mockAccounts[0];
  }

  async disconnect() {}

  async sync() {
    return { conversations: mockConversations, hasMore: false };
  }

  async send() {
    throw new Error('Mock connector does not send messages.');
  }
}

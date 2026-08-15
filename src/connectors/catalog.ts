import { ConnectorDescriptor } from './types';

export const connectorCatalog: ConnectorDescriptor[] = [
  {
    id: 'open-media', displayName: 'Open Media', kind: 'open-media', authentication: 'none', status: 'available',
    capabilities: [
      { operation: 'read-feed', available: true },
      { operation: 'publish-post', available: false, reason: 'Local composer scaffold only; no post service is deployed.' },
      { operation: 'read-messages', available: true },
      { operation: 'send-message', available: false, reason: 'Sending is intentionally disabled in this build.' },
    ],
  },
  {
    id: 'mail-import', displayName: 'IMAP email', kind: 'email', authentication: 'app-password', status: 'available',
    capabilities: [
      { operation: 'read-email', available: true },
      { operation: 'send-email', available: false, reason: 'SMTP and provider send APIs are not implemented.' },
      { operation: 'attachments', available: false, reason: 'Attachment download and safe scanning are not implemented.' },
      { operation: 'realtime', available: false, reason: 'Background scheduling and IMAP IDLE are not implemented.' },
    ],
  },
  {
    id: 'gmail', displayName: 'Gmail', kind: 'email', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [
      { operation: 'read-email', available: false, reason: 'OAuth consent, verification, and Gmail API sync are not implemented.' },
      { operation: 'send-email', available: false, reason: 'Requires a separately granted send scope.' },
    ],
  },
  {
    id: 'microsoft-graph', displayName: 'Outlook', kind: 'email', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [
      { operation: 'read-email', available: false, reason: 'Microsoft identity and Graph sync are not implemented.' },
      { operation: 'send-email', available: false, reason: 'Requires separately granted Mail.Send permission.' },
    ],
  },
  {
    id: 'activitypub', displayName: 'ActivityPub', kind: 'protocol', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [{ operation: 'read-feed', available: false, reason: 'Instance discovery and authorization are not implemented.' }, { operation: 'publish-post', available: false, reason: 'Client-to-server publishing is not implemented.' }],
  },
  {
    id: 'atproto', displayName: 'AT Protocol', kind: 'protocol', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [{ operation: 'read-feed', available: false, reason: 'Repository sync is not implemented.' }, { operation: 'publish-post', available: false, reason: 'Authenticated repository writes are not implemented.' }],
  },
];

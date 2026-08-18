import { ConnectorDescriptor } from './types';

const developmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
const matrixConfigured = developmentBuild && Boolean(process.env.EXPO_PUBLIC_MATRIX_BRIDGE_URL);

export const connectorCatalog: ConnectorDescriptor[] = [
  {
    id: 'open-media', displayName: 'Open Media', kind: 'open-media', authentication: 'passwordless-pkce', status: 'available',
    capabilities: [
      { operation: 'read-feed', available: true },
      { operation: 'publish-post', available: false, reason: 'Local composer scaffold only; no post service is deployed.' },
      { operation: 'read-messages', available: true },
      { operation: 'send-message', available: true },
      { operation: 'realtime', available: true },
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
    id: 'matrix', displayName: 'Matrix sandbox', kind: 'protocol', authentication: 'protocol-key', status: matrixConfigured ? 'connected' : 'planned',
    capabilities: [
      { operation: 'read-messages', available: matrixConfigured, reason: matrixConfigured ? undefined : 'The current single-account Matrix gateway is a local development sandbox, not a production connector.' },
      { operation: 'send-message', available: matrixConfigured, reason: matrixConfigured ? undefined : 'Production requires per-user Matrix authorization and isolation.' },
      { operation: 'realtime', available: matrixConfigured, reason: matrixConfigured ? undefined : 'Matrix sync is available only in an explicitly configured development build.' },
      { operation: 'attachments', available: false, reason: 'Media transfer is reserved for the next Matrix phase.' },
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
    id: 'instagram', displayName: 'Instagram', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'The official API is limited to professional accounts with approved messaging permission; this connector is not implemented yet.' }, { operation: 'send-message', available: false, reason: 'The recipient must first message the professional account, so this is not a universal consumer DM bridge.' }],
  },
  {
    id: 'linkedin', displayName: 'LinkedIn', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'LinkedIn does not provide general member-message access to ordinary third-party apps.' }, { operation: 'send-message', available: false, reason: 'Official messaging access requires restricted partner approval.' }],
  },
  {
    id: 'snapchat', displayName: 'Snapchat', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'Snap Kit does not expose private chat history.' }, { operation: 'send-message', available: false, reason: 'Snap Kit does not provide a third-party private-message transport.' }],
  },
  {
    id: 'tiktok', displayName: 'TikTok', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'Approved Data Portability access can export direct-message data, but a live inbox connector is not implemented.' }, { operation: 'send-message', available: false, reason: 'TikTok does not expose live direct-message sending as a public developer capability.' }],
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

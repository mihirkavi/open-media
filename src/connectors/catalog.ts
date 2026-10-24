import { networkConnectors } from './networkFeeds';
import { ConnectorDescriptor } from './types';

const developmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
// Builds pointed at a server that runs chat bridges (set by `npm run local` when `npm run bridges` is running).
const bridgesBuild = process.env.EXPO_PUBLIC_CHAT_BRIDGES === '1';
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
  // Chat bridges (ADR 0011): availability depends on which bridges the server runs; Settings → Chat networks shows it live.
  {
    id: 'whatsapp', displayName: 'WhatsApp', kind: 'social', authentication: 'protocol-key', status: bridgesBuild ? 'available' : 'planned',
    capabilities: [
      { operation: 'read-messages', available: bridgesBuild, reason: bridgesBuild ? undefined : 'Works once Open Media’s server runs the WhatsApp chat bridge (local development today).' },
      { operation: 'send-message', available: bridgesBuild, reason: bridgesBuild ? undefined : 'Works once Open Media’s server runs the WhatsApp chat bridge.' },
      { operation: 'attachments', available: false, reason: 'Photos and files show as placeholders; sending them is not implemented yet.' },
    ],
  },
  {
    id: 'instagram', displayName: 'Instagram', kind: 'social', authentication: 'protocol-key', status: 'planned',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'A chat bridge exists (mautrix-meta); it is not running on Open Media’s server yet.' }, { operation: 'send-message', available: false, reason: 'Comes with the Instagram chat bridge.' }],
  },
  {
    id: 'linkedin', displayName: 'LinkedIn', kind: 'social', authentication: 'protocol-key', status: 'planned',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'A chat bridge exists (mautrix-linkedin); it is not running on Open Media’s server yet.' }, { operation: 'send-message', available: false, reason: 'Comes with the LinkedIn chat bridge.' }],
  },
  {
    id: 'snapchat', displayName: 'Snapchat', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'Snap Kit does not expose private chat history.' }, { operation: 'send-message', available: false, reason: 'Snap Kit does not provide a third-party private-message transport.' }],
  },
  {
    id: 'tiktok', displayName: 'TikTok', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'Approved Data Portability access can export direct-message data, but a live inbox connector is not implemented.' }, { operation: 'send-message', available: false, reason: 'TikTok does not expose live direct-message sending as a public developer capability.' }],
  },
  ...networkConnectors.map((connector) => connector.descriptor()),
  {
    id: 'activitypub', displayName: 'ActivityPub', kind: 'protocol', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [{ operation: 'read-feed', available: false, reason: 'Instance discovery and authorization are not implemented.' }, { operation: 'publish-post', available: false, reason: 'Client-to-server publishing is not implemented.' }],
  },
  {
    id: 'atproto', displayName: 'AT Protocol', kind: 'protocol', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [{ operation: 'read-feed', available: false, reason: 'Repository sync is not implemented.' }, { operation: 'publish-post', available: false, reason: 'Authenticated repository writes are not implemented.' }],
  },
];

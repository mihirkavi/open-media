import { chatNetworks } from '../domain/chatNetworks';
import { networkConnectors } from './networkFeeds';
import { destinationNames, oauthNetworks } from '../domain/crossPosting';
import { ConnectorDescriptor } from './types';

const developmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
// Chat networks whose bridges the server runs: a comma-separated list (set by `npm run local` from
// `npm run bridges`), or "1" for every network the server offers.
const bridgeSetting = process.env.EXPO_PUBLIC_CHAT_BRIDGES ?? '';
const bridgeRunning = (id: string) => bridgeSetting === '1' || bridgeSetting.split(',').includes(id);
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
  ...chatNetworks.map((network): ConnectorDescriptor => {
    const running = bridgeRunning(network.id);
    return {
      id: network.id, displayName: network.name, kind: 'social', authentication: 'protocol-key', status: running ? 'available' : 'planned',
      capabilities: [
        { operation: 'read-messages', available: running, reason: running ? undefined : network.setup ?? `Works once Open Media’s server runs the ${network.name} chat bridge (local development today).` },
        { operation: 'send-message', available: running, reason: running ? undefined : `Works once Open Media’s server runs the ${network.name} chat bridge.` },
        { operation: 'attachments', available: false, reason: 'Photos and files show as placeholders; sending them is not implemented yet.' },
      ],
    };
  }),
  // ADR 0033: closed networks, posting only, through each network's official OAuth API. Each turns on
  // once Open Media's own developer app there is approved (the server reports it at /v1/social/status).
  ...oauthNetworks.map((id): ConnectorDescriptor => ({
    id: `${id}-posting`, displayName: `${destinationNames[id]} posting`, kind: 'social', authentication: 'oauth2-pkce', status: 'planned',
    capabilities: [
      { operation: 'publish-post', available: false, reason: `Works as soon as Open Media’s ${destinationNames[id]} app is approved; then connect it in Settings → Cross-posting.` },
      { operation: 'read-feed', available: false, reason: `${destinationNames[id]} has no free public API for reading feeds, and Open Media does not scrape it.` },
    ],
  })),
  {
    id: 'youtube', displayName: 'YouTube', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'publish-post', available: false, reason: 'YouTube takes uploads only from apps that pass Google’s verification and audit; not set up.' }],
  },
  {
    id: 'snapchat', displayName: 'Snapchat', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'Snap Kit does not expose private chat history, and no working chat bridge exists.' }, { operation: 'send-message', available: false, reason: 'Snap Kit does not provide a third-party private-message transport.' }],
  },
  {
    id: 'tiktok', displayName: 'TikTok', kind: 'social', authentication: 'oauth2-pkce', status: 'unavailable',
    capabilities: [{ operation: 'read-messages', available: false, reason: 'Approved Data Portability access can export direct-message data, but no live inbox API or working chat bridge exists.' }, { operation: 'publish-post', available: false, reason: 'TikTok’s Content Posting API requires an audited app; not set up.' }],
  },
  // Bluesky is also a chat network (its DMs bridge into Messages), so its public-posts entry gets its own id.
  ...networkConnectors.map((connector) => connector.descriptor()).map((descriptor) => chatNetworks.some((network) => network.id === descriptor.id) ? { ...descriptor, id: `${descriptor.id}-posts`, displayName: `${descriptor.displayName} posts` } : descriptor),
];

import { deviceSecretStorage } from '../../auth/supabase';
import { blueskyFacets, parseBlueskyUri } from '../../domain/openNetworkPosts';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * Bluesky (AT Protocol). The person creates an app password in Bluesky (Settings → Privacy and
 * security → App passwords), which can post but can't change the account, its password or its
 * email, and can be revoked there at any time. Open Media exchanges it for a session on the
 * person's own server (PDS) and keeps only that session on this device, never the app password.
 */
const storageKey = 'open-media.network.bluesky';

interface StoredBluesky { did: string; handle: string; service: string; accessJwt: string; refreshJwt: string }

async function load(): Promise<StoredBluesky | undefined> {
  try {
    const stored = JSON.parse((await deviceSecretStorage().getItem(storageKey)) ?? 'null') as StoredBluesky | null;
    return stored?.did?.startsWith('did:') && stored.accessJwt && stored.service.startsWith('https://') ? stored : undefined;
  } catch { return undefined; }
}

async function save(stored: StoredBluesky) {
  await deviceSecretStorage().setItem(storageKey, JSON.stringify(stored));
}

async function xrpc<T>(service: string, method: string, init: { body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(`${service}/xrpc/${method}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw Object.assign(new PublishingError(blueskyError(body.error, body.message)), { code: body.error });
  return body;
}

function blueskyError(code?: string, message?: string): string {
  if (code === 'AuthenticationRequired' || code === 'AuthFactorTokenRequired') return 'Bluesky didn’t accept that handle and app password. Check both and try again.';
  if (code === 'RateLimitExceeded') return 'Bluesky is limiting requests right now. Try again in a few minutes.';
  if (code === 'ExpiredToken' || code === 'InvalidToken') return 'Your Bluesky session ended. Connect Bluesky again in Settings → Cross-posting.';
  return message && message.length < 160 ? `Bluesky: ${message}` : 'Bluesky didn’t accept that. Try again.';
}

/** Where an account's data lives: its PDS, from its DID document. Handles hosted by Bluesky fall back to bsky.social. */
async function resolveService(identifier: string): Promise<string> {
  try {
    const did = identifier.startsWith('did:') ? identifier : (await xrpc<{ did: string }>('https://api.bsky.app', `com.atproto.identity.resolveHandle?handle=${encodeURIComponent(identifier)}`)).did;
    const documentURL = did.startsWith('did:plc:') ? `https://plc.directory/${did}` : did.startsWith('did:web:') ? `https://${did.slice(8)}/.well-known/did.json` : undefined;
    if (!documentURL) return 'https://bsky.social';
    const document = await (await fetch(documentURL)).json() as { service?: { id: string; serviceEndpoint: string }[] };
    const endpoint = document.service?.find((service) => service.id === '#atproto_pds' || service.id.endsWith('#atproto_pds'))?.serviceEndpoint;
    return endpoint?.startsWith('https://') ? endpoint.replace(/\/$/, '') : 'https://bsky.social';
  } catch { return 'https://bsky.social'; }
}

/** Runs a call with the stored session, refreshing it once when it has expired. */
async function withSession<T>(call: (stored: StoredBluesky) => Promise<T>): Promise<T> {
  const stored = await load();
  if (!stored) throw new PublishingError('Connect Bluesky in Settings → Cross-posting.');
  try { return await call(stored); } catch (error) {
    if ((error as { code?: string }).code !== 'ExpiredToken') throw error;
    const refreshed = await xrpc<{ accessJwt: string; refreshJwt: string; handle: string }>(stored.service, 'com.atproto.server.refreshSession', { body: {}, token: stored.refreshJwt }).catch(() => {
      throw new PublishingError('Your Bluesky session ended. Connect Bluesky again in Settings → Cross-posting.');
    });
    const next = { ...stored, accessJwt: refreshed.accessJwt, refreshJwt: refreshed.refreshJwt, handle: refreshed.handle ?? stored.handle };
    await save(next);
    return call(next);
  }
}

function createRecord(stored: StoredBluesky, collection: string, record: Record<string, unknown>) {
  return xrpc<{ uri: string; cid: string }>(stored.service, 'com.atproto.repo.createRecord', { token: stored.accessJwt, body: { repo: stored.did, collection, record: { $type: collection, ...record, createdAt: new Date().toISOString() } } });
}

function postURL(handle: string, uri: string) {
  const rkey = parseBlueskyUri(uri)?.rkey ?? '';
  return `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`;
}

const toAccount = (stored: StoredBluesky): NetworkAccount => ({ network: 'bluesky', handle: `@${stored.handle}`, profileURL: `https://bsky.app/profile/${encodeURIComponent(stored.handle)}` });

export const blueskyPublisher: PublishingConnector = {
  id: 'bluesky',
  revokeHint: 'To revoke Open Media on Bluesky too, delete its app password in Bluesky → Settings → Privacy and security → App passwords.',

  async availability() { return { available: true }; },

  async account() {
    const stored = await load();
    return stored ? toAccount(stored) : undefined;
  },

  async connect({ requestText, signal }) {
    const handle = (await requestText({ title: 'Your Bluesky handle', message: 'The name people find you by, for example alex.bsky.social.', placeholder: 'alex.bsky.social' })).trim().replace(/^@/, '').toLowerCase();
    if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(handle) && !handle.startsWith('did:')) throw new PublishingError('That doesn’t look like a Bluesky handle. It looks like alex.bsky.social.');
    const password = (await requestText({ title: 'A Bluesky app password', message: 'Create one in Bluesky → Settings → Privacy and security → App passwords. It can post but can’t change your account, and you can delete it there any time. Don’t use your main password.', placeholder: 'xxxx-xxxx-xxxx-xxxx', secret: true })).trim();
    if (signal.aborted) throw new PublishingError('Connecting was cancelled.');
    const service = await resolveService(handle);
    const session = await xrpc<{ did: string; handle: string; accessJwt: string; refreshJwt: string }>(service, 'com.atproto.server.createSession', { body: { identifier: handle, password } });
    const stored = { did: session.did, handle: session.handle, service, accessJwt: session.accessJwt, refreshJwt: session.refreshJwt };
    await save(stored);
    return toAccount(stored);
  },

  async disconnect() {
    const stored = await load();
    if (stored) await xrpc(stored.service, 'com.atproto.server.deleteSession', { body: {}, token: stored.refreshJwt }).catch(() => undefined);
    await deviceSecretStorage().removeItem(storageKey);
  },

  async publish(content) {
    return withSession(async (stored) => {
      const facets = blueskyFacets(content.text);
      const record = await createRecord(stored, 'app.bsky.feed.post', { text: content.text, ...(facets.length ? { facets } : {}) });
      return { externalId: `${record.uri} ${record.cid}`, url: postURL(stored.handle, record.uri) };
    });
  },

  async interact(target, interaction) {
    if (target.network !== 'bluesky') throw new PublishingError('That post isn’t on Bluesky.');
    return withSession(async (stored) => {
      const subject = { uri: target.uri, cid: target.cid };
      if (interaction.kind === 'comment') {
        const facets = blueskyFacets(interaction.text);
        const record = await createRecord(stored, 'app.bsky.feed.post', { text: interaction.text, reply: { root: subject, parent: subject }, ...(facets.length ? { facets } : {}) });
        return { externalId: `${record.uri} ${record.cid}`, url: postURL(stored.handle, record.uri) };
      }
      await createRecord(stored, interaction.kind === 'like' ? 'app.bsky.feed.like' : 'app.bsky.feed.repost', { subject });
      return undefined;
    });
  },
};

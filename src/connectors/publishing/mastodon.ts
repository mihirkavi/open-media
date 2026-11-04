import { sha256 } from '@noble/hashes/sha256';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomValues } from 'expo-crypto';

import { deviceSecretStorage } from '../../auth/supabase';
import { mastodonServer } from '../../domain/openNetworkPosts';
import { newOAuthState, oauthRedirectURI, runOAuthWindow } from './oauthWindow';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * Mastodon and the rest of the fediverse servers that speak Mastodon's API (ADR 0033). Any server
 * works: Open Media registers itself with the person's server, then the person approves it there
 * with OAuth. The token is limited to posting, favouriting and boosting, never reading private
 * messages or changing the account, and stays on this device.
 */
const storageKey = 'open-media.network.mastodon';
const appsKey = 'open-media.network.mastodon.apps';
const scopes = 'read:accounts read:search write:statuses write:favourites';

interface StoredMastodon { server: string; token: string; acct: string; url?: string }
interface RegisteredApp { clientId: string; clientSecret: string; redirectURI: string }

async function load(): Promise<StoredMastodon | undefined> {
  try {
    const stored = JSON.parse((await deviceSecretStorage().getItem(storageKey)) ?? 'null') as StoredMastodon | null;
    return stored?.server && stored.token ? stored : undefined;
  } catch { return undefined; }
}

async function api<T>(server: string, path: string, init: { method?: string; token?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {}): Promise<T> {
  const response = await fetch(`https://${server}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }).catch(() => { throw new PublishingError(`Open Media couldn’t reach ${server}. Check the server name and try again.`); });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (response.status === 401) throw new PublishingError('Your Mastodon sign-in ended. Connect Mastodon again in Settings → Cross-posting.');
  if (!response.ok) throw new PublishingError(body.error && body.error.length < 160 ? `${server}: ${body.error}` : `${server} didn’t accept that. Try again.`);
  return body;
}

/** One registration per server and device, reused on reconnect. */
async function registeredApp(server: string): Promise<RegisteredApp> {
  const redirectURI = oauthRedirectURI();
  const apps = JSON.parse((await AsyncStorage.getItem(appsKey).catch(() => null)) ?? '{}') as Record<string, RegisteredApp>;
  const existing = apps[server];
  if (existing?.redirectURI === redirectURI) return existing;
  const created = await api<{ client_id: string; client_secret: string }>(server, '/api/v1/apps', { body: { client_name: 'Open Media', redirect_uris: redirectURI, scopes, website: 'https://openmedia.site' } });
  const app = { clientId: created.client_id, clientSecret: created.client_secret, redirectURI };
  await AsyncStorage.setItem(appsKey, JSON.stringify({ ...apps, [server]: app }));
  return app;
}

function base64url(bytes: Uint8Array) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The status's ID on the person's own server, found by its ActivityPub URI. */
async function localStatusId(stored: StoredMastodon, uri: string): Promise<string> {
  const result = await api<{ statuses?: { id: string }[] }>(stored.server, `/api/v2/search?${new URLSearchParams({ q: uri, type: 'statuses', resolve: 'true', limit: '1' })}`, { token: stored.token });
  const id = result.statuses?.[0]?.id;
  if (!id) throw new PublishingError(`${stored.server} couldn’t find that post. Open it on Mastodon instead.`);
  return id;
}

const toAccount = (stored: StoredMastodon): NetworkAccount => ({ network: 'mastodon', handle: `@${stored.acct}@${stored.server}`, profileURL: stored.url });

export const mastodonPublisher: PublishingConnector = {
  id: 'mastodon',
  revokeHint: 'To revoke Open Media on Mastodon too, remove it under Preferences → Account → Authorized apps on your server.',

  async availability() { return { available: true }; },

  async account() {
    const stored = await load();
    return stored ? toAccount(stored) : undefined;
  },

  async connect({ requestText, showApproval, signal }) {
    const input = await requestText({ title: 'Your Mastodon server', message: 'The server your account is on, for example mastodon.social. It’s the part after the second @ in your address.', placeholder: 'mastodon.social' });
    const server = mastodonServer(input);
    if (!server) throw new PublishingError('That doesn’t look like a server name. It looks like mastodon.social.');
    const app = await registeredApp(server);
    const verifier = base64url(getRandomValues(new Uint8Array(32)));
    const state = newOAuthState();
    const authorize = `https://${server}/oauth/authorize?${new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectURI, response_type: 'code', scope: scopes, state, code_challenge: base64url(sha256(new TextEncoder().encode(verifier))), code_challenge_method: 'S256' })}`;
    const redirect = await runOAuthWindow(authorize, state, { title: `Approve Open Media on ${server}`, message: `Sign in on ${server} and choose Authorize. Open Media can post, favourite and boost for you; it can’t read your messages or change your account.` }, { showApproval, signal });
    const code = redirect.searchParams.get('code');
    if (!code) throw new PublishingError(redirect.searchParams.get('error') === 'access_denied' ? 'You chose not to authorize Open Media.' : 'Mastodon didn’t finish signing in. Try again.');
    const token = await api<{ access_token: string }>(server, '/oauth/token', { body: { grant_type: 'authorization_code', code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectURI, code_verifier: verifier, scope: scopes } });
    const me = await api<{ acct: string; url?: string }>(server, '/api/v1/accounts/verify_credentials', { token: token.access_token });
    const stored = { server, token: token.access_token, acct: me.acct, url: me.url };
    await deviceSecretStorage().setItem(storageKey, JSON.stringify(stored));
    return toAccount(stored);
  },

  async disconnect() {
    const stored = await load();
    if (stored) {
      const apps = JSON.parse((await AsyncStorage.getItem(appsKey).catch(() => null)) ?? '{}') as Record<string, RegisteredApp>;
      const app = apps[stored.server];
      if (app) await api(stored.server, '/oauth/revoke', { body: { client_id: app.clientId, client_secret: app.clientSecret, token: stored.token } }).catch(() => undefined);
    }
    await deviceSecretStorage().removeItem(storageKey);
  },

  async publish(content, idempotencyKey) {
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Mastodon in Settings → Cross-posting.');
    const status = await api<{ id: string; uri: string; url?: string }>(stored.server, '/api/v1/statuses', { token: stored.token, body: { status: content.text, visibility: 'public' }, idempotencyKey });
    return { externalId: status.uri, url: status.url ?? undefined };
  },

  async interact(target, interaction, idempotencyKey) {
    if (target.network !== 'mastodon') throw new PublishingError('That post isn’t on Mastodon.');
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Mastodon in Settings → Cross-posting.');
    const id = await localStatusId(stored, target.uri);
    if (interaction.kind === 'comment') {
      const status = await api<{ uri: string; url?: string }>(stored.server, '/api/v1/statuses', { token: stored.token, body: { status: interaction.text, in_reply_to_id: id, visibility: 'public' }, idempotencyKey });
      return { externalId: status.uri, url: status.url ?? undefined };
    }
    await api(stored.server, `/api/v1/statuses/${encodeURIComponent(id)}/${interaction.kind === 'like' ? 'favourite' : 'reblog'}`, { token: stored.token, method: 'POST' });
    return undefined;
  },
};

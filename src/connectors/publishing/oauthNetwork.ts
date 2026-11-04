import { sha256 } from '@noble/hashes/sha256';
import { getRandomValues } from 'expo-crypto';
import { Platform } from 'react-native';

import { deviceSecretStorage, getAPIAccessToken } from '../../auth/supabase';
import { destinationNames, OAuthNetworkId } from '../../domain/crossPosting';
import { runOAuthWindow } from './oauthWindow';
import { NetworkAccount, PublishAvailability, PublishingConnector, PublishingError } from './types';

/**
 * X, Threads, LinkedIn, Instagram and Facebook Pages through their official OAuth APIs (ADR 0033).
 * Open Media's server holds only its own app secret and passes requests through; the person's
 * token is kept on this device, like every other network's key.
 */
interface StoredSession { token: string; refreshToken?: string; expiresAt?: number; accountId: string; handle: string; profileURL?: string }

const what: Record<OAuthNetworkId, string> = {
  x: 'Open Media can post and like for you. It can’t read your DMs or change your account.',
  threads: 'Open Media can publish threads for you. It can’t read your messages or change your account.',
  linkedin: 'Open Media can share posts as you. It can’t read your messages, connections or profile changes.',
  instagram: 'Open Media can publish Reels to your professional account. It can’t read your DMs.',
  facebook: 'Open Media can post to a Facebook Page you manage (Facebook doesn’t allow apps to post to personal profiles).',
};

const revoke: Record<OAuthNetworkId, string> = {
  x: 'To revoke Open Media on X too, remove it under Settings → Security and account access → Apps and sessions.',
  threads: 'To revoke Open Media on Threads too, remove it under Settings → Account → Website permissions.',
  linkedin: 'To revoke Open Media on LinkedIn too, remove it under Settings → Data privacy → Permitted services.',
  instagram: 'To revoke Open Media on Instagram too, remove it under Settings → Website permissions → Apps and websites.',
  facebook: 'To revoke Open Media on Facebook too, remove it under Settings → Business integrations.',
};

function apiURL() {
  return (process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? '').replace(/\/$/, '');
}

let status: Promise<Partial<Record<OAuthNetworkId, boolean>>> | undefined;

function serverStatus() {
  status ??= fetch(`${apiURL()}/v1/social/status`).then((response) => response.json() as Promise<Partial<Record<OAuthNetworkId, boolean>>>).catch(() => { status = undefined; return {}; });
  return status;
}

async function server<T>(path: string, body: unknown): Promise<T> {
  const token = await getAPIAccessToken().catch(() => undefined);
  if (!token) throw new PublishingError('Sign in to Open Media first.');
  const response = await fetch(`${apiURL()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    .catch(() => { throw new PublishingError('The Open Media server isn’t reachable right now. Try again.'); });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new PublishingError(typeof result.error === 'string' ? result.error : 'That didn’t work. Try again.');
  return result;
}

function base64url(bytes: Uint8Array) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function oauthPublisher(id: OAuthNetworkId): PublishingConnector {
  const name = destinationNames[id];
  const storageKey = `open-media.network.${id}`;
  const load = async (): Promise<StoredSession | undefined> => {
    try {
      const stored = JSON.parse((await deviceSecretStorage().getItem(storageKey)) ?? 'null') as StoredSession | null;
      return stored?.token && stored.accountId ? stored : undefined;
    } catch { return undefined; }
  };
  const toAccount = (stored: StoredSession): NetworkAccount => ({ network: id, handle: stored.handle, profileURL: stored.profileURL });

  return {
    id,
    revokeHint: revoke[id],

    async availability(): Promise<PublishAvailability> {
      if (!apiURL()) return { available: false, setup: 'owner', reason: 'Needs the Open Media server.' };
      return (await serverStatus())[id] ? { available: true } : { available: false, setup: 'owner', reason: `Coming soon: Open Media’s ${name} app is waiting for ${name}’s approval.` };
    },

    async account() {
      const stored = await load();
      return stored ? toAccount(stored) : undefined;
    },

    async connect({ showApproval, signal }) {
      const state = `omc_${hex(getRandomValues(new Uint8Array(16)))}_${Platform.OS === 'web' ? 'w' : 'n'}`;
      const verifier = base64url(getRandomValues(new Uint8Array(32)));
      const { url } = await server<{ url: string }>(`/v1/social/${id}/authorize`, { state, challenge: base64url(sha256(new TextEncoder().encode(verifier))) });
      const redirect = await runOAuthWindow(url, state, { title: `Approve Open Media on ${name}`, message: what[id] }, { showApproval, signal });
      const code = redirect.searchParams.get('code');
      if (!code) throw new PublishingError(redirect.searchParams.get('error') === 'access_denied' ? `You chose not to connect ${name}.` : `${name} didn’t finish signing in. Try again.`);
      const session = await server<StoredSession>(`/v1/social/${id}/token`, { code, verifier });
      await deviceSecretStorage().setItem(storageKey, JSON.stringify(session));
      return toAccount(session);
    },

    async disconnect() {
      await deviceSecretStorage().removeItem(storageKey);
    },

    async publish(content) {
      const stored = await load();
      if (!stored) throw new PublishingError(`Connect ${name} in Settings → Cross-posting.`);
      const result = await server<{ externalId: string; url?: string; session?: StoredSession }>(`/v1/social/${id}/publish`, { session: stored, post: { text: content.text, videoUrl: content.video?.url } });
      // X tokens are refreshed on the way; keep the new one.
      if (result.session && result.session.token !== stored.token) await deviceSecretStorage().setItem(storageKey, JSON.stringify(result.session));
      return { externalId: result.externalId, url: result.url };
    },

    async interact() {
      // Open Media doesn't read these networks' feeds, so there is nothing here to like or answer.
      throw new PublishingError(`Open ${name} to do that.`);
    },
  };
}

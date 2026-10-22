import { ed25519 } from '@noble/curves/ed25519';
import { getRandomValues } from 'expo-crypto';
import QRCode from 'qrcode';
import { Linking, Platform } from 'react-native';

import { deviceSecretStorage, getAPIAccessToken } from '../../auth/supabase';
import { farcasterProfileFromUserData } from '../../domain/networkPosts';
import { fromHex, signCastAdd, toHex } from './farcasterMessage';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * Farcaster: the device makes an Ed25519 key, Open Media's server signs a request for it as the
 * Open Media app account, and the person approves that key in the Farcaster app. The private key
 * never leaves this device; casts are signed here and only the signed bytes are relayed.
 */
const storageKey = 'open-media.network.farcaster';
const clientAPI = 'https://api.farcaster.xyz';
const snapchainNode = 'https://crackle.farcaster.xyz:3381';
const pollIntervalMs = 2000;
const approvalTimeoutMs = 10 * 60_000;

interface StoredFarcaster { fid: number; privateKey: string; username: string }

function apiURL() {
  return (process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? '').replace(/\/$/, '');
}

async function authorizedFetch(path: string, init: RequestInit) {
  const token = await getAPIAccessToken();
  if (!token) throw new PublishingError('Sign in to Open Media first.');
  const response = await fetch(`${apiURL()}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new PublishingError(typeof body.error === 'string' ? body.error : 'Open Media couldn’t reach Farcaster. Try again.');
  return body;
}

async function load(): Promise<StoredFarcaster | undefined> {
  try {
    const stored = JSON.parse((await deviceSecretStorage().getItem(storageKey)) ?? 'null') as StoredFarcaster | null;
    return stored && Number.isInteger(stored.fid) && /^[0-9a-f]{64}$/.test(stored.privateKey) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function toAccount(stored: StoredFarcaster): NetworkAccount {
  return { network: 'farcaster', handle: `@${stored.username}`, profileURL: `https://farcaster.xyz/${encodeURIComponent(stored.username)}` };
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new PublishingError('Connecting was cancelled.')); }, { once: true });
  });
}

export const farcasterPublisher: PublishingConnector = {
  id: 'farcaster',
  revokeHint: 'To revoke Open Media’s key on Farcaster too, remove Open Media from connected apps in the Farcaster app’s settings.',

  async availability() {
    if (!apiURL()) return { available: false, setup: 'owner', reason: 'Needs the Open Media server.' };
    try {
      const response = await fetch(`${apiURL()}/v1/cross-posting/status`);
      const status = await response.json() as { farcaster?: boolean };
      return status.farcaster ? { available: true } : { available: false, setup: 'owner', reason: 'Coming soon: Open Media’s Farcaster app identity isn’t set up yet.' };
    } catch {
      return { available: false, setup: 'owner', reason: 'The Open Media server isn’t reachable right now.' };
    }
  },

  async account() {
    const stored = await load();
    return stored ? toAccount(stored) : undefined;
  },

  async connect({ showApproval, signal }) {
    const privateKey = getRandomValues(new Uint8Array(32));
    const publicKey = `0x${toHex(ed25519.getPublicKey(privateKey))}`;
    const request = await authorizedFetch('/v1/cross-posting/farcaster/signed-key-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: publicKey }) }) as { token?: string; deeplinkUrl?: string };
    if (!request.token || !request.deeplinkUrl?.startsWith('farcaster://')) throw new PublishingError('Farcaster didn’t start the connection. Try again.');
    if (Platform.OS === 'web') {
      const qrCode = `data:image/svg+xml;utf8,${encodeURIComponent(await QRCode.toString(request.deeplinkUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))}`;
      showApproval({ title: 'Approve Open Media in Farcaster', message: 'Scan this code with your phone’s camera, then approve Open Media in the Farcaster app. Open Media can post for you; it can’t see your wallet or messages.', url: request.deeplinkUrl, qrCode });
    } else {
      showApproval({ title: 'Approve Open Media in Farcaster', message: 'Approve Open Media in the Farcaster app, then come back here.', url: request.deeplinkUrl });
      await Linking.openURL(request.deeplinkUrl).catch(() => undefined);
    }
    try {
      const deadline = Date.now() + approvalTimeoutMs;
      while (Date.now() < deadline) {
        await wait(pollIntervalMs, signal);
        const response = await fetch(`${clientAPI}/v2/signed-key-request?token=${encodeURIComponent(request.token)}`);
        if (!response.ok) continue;
        const { result } = await response.json() as { result?: { signedKeyRequest?: { state?: string; userFid?: number } } };
        const state = result?.signedKeyRequest?.state;
        const fid = result?.signedKeyRequest?.userFid;
        if (state === 'completed' && fid) {
          const userData = await fetch(`${snapchainNode}/v1/userDataByFid?fid=${fid}`).then((item) => item.json()).catch(() => ({ messages: [] })) as { messages?: Parameters<typeof farcasterProfileFromUserData>[1] };
          const stored = { fid, privateKey: toHex(privateKey), username: farcasterProfileFromUserData(fid, userData.messages ?? []).username ?? `fid:${fid}` };
          await deviceSecretStorage().setItem(storageKey, JSON.stringify(stored));
          return toAccount(stored);
        }
      }
      throw new PublishingError('Farcaster approval timed out. Try connecting again.');
    } finally {
      showApproval(undefined);
      privateKey.fill(0);
    }
  },

  async disconnect() {
    await deviceSecretStorage().removeItem(storageKey);
  },

  async publish(content) {
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting.');
    const key = fromHex(stored.privateKey);
    try {
      const message = signCastAdd({ fid: stored.fid, text: content.text, embedUrls: content.video ? [content.video.url] : undefined }, key);
      const token = await getAPIAccessToken();
      if (!token) throw new PublishingError('Sign in to Open Media first.');
      const response = await fetch(`${apiURL()}/v1/cross-posting/farcaster/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: message.bytes as unknown as BodyInit });
      const body = await response.json().catch(() => ({})) as { hash?: string; error?: string };
      if (!response.ok) throw new PublishingError(body.error ?? 'Farcaster didn’t accept the post.');
      const hash = body.hash ?? message.hash;
      return { externalId: hash, url: `https://farcaster.xyz/${encodeURIComponent(stored.username)}/${hash.slice(0, 10)}` };
    } finally {
      key.fill(0);
    }
  },
};

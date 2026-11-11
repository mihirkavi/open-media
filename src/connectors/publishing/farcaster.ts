import AsyncStorage from '@react-native-async-storage/async-storage';
import { ed25519 } from '@noble/curves/ed25519';
import { getRandomValues } from 'expo-crypto';
import QRCode from 'qrcode';
import { Linking, Platform } from 'react-native';

import { deviceSecretStorage, getAPIAccessToken } from '../../auth/supabase';
import { farcasterAccountFidKey } from '../networkFeeds';
import { farcasterProfileFromUserData } from '../../domain/networkPosts';
import { castWithMentions, mentionCandidates } from '../../domain/farcasterCasts';
import { CastInput, fromHex, signCastAdd, signCastRemove, signFollow, signReactionAdd, signReactionRemove, SignedFarcasterMessage, signUnfollow, toHex } from './farcasterMessage';
import { fitsFarcasterLink } from '../../domain/farcasterLinks';
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
    // Connections made before ADR 0039 didn't record the account number for the feed.
    if (stored) AsyncStorage.setItem(farcasterAccountFidKey, String(stored.fid)).catch(() => undefined);
    return stored ? toAccount(stored) : undefined;
  },

  async connect({ showApproval, signal }) {
    const privateKey = getRandomValues(new Uint8Array(32));
    const publicKey = `0x${toHex(ed25519.getPublicKey(privateKey))}`;
    const request = await authorizedFetch('/v1/cross-posting/farcaster/signed-key-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: publicKey, ...(Platform.OS === 'web' ? {} : { redirectUrl: 'openmedia://farcaster' }) }) }) as { token?: string; deeplinkUrl?: string };
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
          await AsyncStorage.setItem(farcasterAccountFidKey, String(fid)).catch(() => undefined);
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
    await AsyncStorage.removeItem(farcasterAccountFidKey).catch(() => undefined);
  },

  async publish(content) {
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting.');
    const cast = await withMentions({ fid: stored.fid, text: content.text, embedUrls: content.video ? [content.video.url] : undefined });
    const hash = await submit(stored, (key) => signCastAdd(cast, key));
    return { externalId: hash, url: `https://farcaster.xyz/${encodeURIComponent(stored.username)}/${hash.slice(0, 10)}` };
  },

  async interact(target, interaction) {
    if (target.network !== 'farcaster') throw new PublishingError('That post isn’t on Farcaster.');
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting.');
    const cast = { fid: target.fid, hash: target.hash as `0x${string}` };
    if (interaction.kind === 'comment') {
      const reply = await withMentions({ fid: stored.fid, text: interaction.text, parentCastId: cast });
      const hash = await submit(stored, (key) => signCastAdd(reply, key));
      return { externalId: hash, url: `https://farcaster.xyz/${encodeURIComponent(stored.username)}/${hash.slice(0, 10)}` };
    }
    // Farcaster keeps one reaction per account and cast, so a repeated like is already done.
    await submit(stored, (key) => signReactionAdd({ fid: stored.fid, type: interaction.kind === 'like' ? 'like' : 'recast', target: cast }, key), true);
    return undefined;
  },

  async undo(target, kind) {
    if (target.network !== 'farcaster') throw new PublishingError('That post isn’t on Farcaster.');
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting.');
    // Farcaster keeps whichever reaction message came last, so removing twice is already done.
    await submit(stored, (key) => signReactionRemove({ fid: stored.fid, type: kind === 'like' ? 'like' : 'recast', target: { fid: target.fid, hash: target.hash as `0x${string}` } }, key), true);
  },

  async removeCopy(copy) {
    const stored = await load();
    if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting to delete the copy there.');
    if (!/^0x[0-9a-f]{40}$/.test(copy.externalId)) throw new PublishingError('That copy isn’t a Farcaster cast.');
    await submit(stored, (key) => signCastRemove({ fid: stored.fid, hash: copy.externalId as `0x${string}` }, key), true);
  },
};

/**
 * Puts real mentions into a cast (ADR 0039): each "@name" that is a Farcaster username becomes a
 * mention, so the person is notified and every app shows their name. A name Farcaster doesn't know
 * stays as text. Usernames are looked up on a public Snapchain node, five at a time.
 */
async function withMentions(cast: CastInput): Promise<CastInput> {
  const names = mentionCandidates(cast.text).slice(0, 20);
  if (!names.length) return cast;
  const fids = new Map<string, number>();
  for (let index = 0; index < names.length; index += 5) {
    await Promise.all(names.slice(index, index + 5).map(async (name) => {
      const fid = await farcasterFidByName(name).catch(() => undefined);
      if (fid) fids.set(name, fid);
    }));
  }
  const { text, mentions } = castWithMentions(cast.text, fids);
  return mentions.length ? { ...cast, text, mentions } : cast;
}

/** The account (fid) that owns a Farcaster username or ENS name, if any. */
export async function farcasterFidByName(name: string): Promise<number | undefined> {
  const response = await fetch(`${snapchainNode}/v1/userNameProofByName?name=${encodeURIComponent(name.replace(/^@/, '').toLowerCase())}`);
  if (!response.ok) return undefined;
  const proof = await response.json() as { fid?: number };
  return Number.isSafeInteger(proof.fid) && proof.fid! > 0 ? proof.fid : undefined;
}

/** Whether the connected account follows `targetFid` on Farcaster; undefined without a connection. */
export async function farcasterFollows(targetFid: number): Promise<boolean | undefined> {
  const stored = await load();
  if (!stored) return undefined;
  const response = await fetch(`${snapchainNode}/v1/linkById?fid=${stored.fid}&target_fid=${targetFid}&link_type=follow`);
  const body = await response.json().catch(() => ({})) as { data?: { type?: string }; error_detail?: string };
  if (response.ok) return body.data?.type === 'MESSAGE_TYPE_LINK_ADD';
  // The node answers "NotFound" for accounts that were never followed; anything else is unknown.
  return /NotFound/.test(body.error_detail ?? '') ? false : undefined;
}

/** Follows or unfollows an account on Farcaster as the connected account (LinkAdd / LinkRemove). */
export async function followOnFarcaster(targetFid: number, follow: boolean): Promise<void> {
  const stored = await load();
  if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting.');
  if (targetFid === stored.fid) throw new PublishingError('That’s your own Farcaster account.');
  await submit(stored, (key) => (follow ? signFollow : signUnfollow)({ fid: stored.fid, targetFid }, key), true);
}

/** The connected Farcaster account's number (fid) on this device, if any. */
export async function farcasterAccountFid(): Promise<number | undefined> {
  return (await load())?.fid;
}

export { fitsFarcasterLink };

/** What Open Media sends to Farcaster for a web link: a like or recast (or taking it back), or a reply. */
export type FarcasterLinkAction = { kind: 'like' | 'reshare'; on: boolean } | { kind: 'comment'; text: string };

/**
 * Likes, recasts or replies to a web link (an article or an event's page) as the connected account,
 * in Farcaster's own form for links: a reaction whose target is the URL, or a cast whose parent is
 * the URL. Every Farcaster app reads these, so the action is visible beyond Open Media. Returns the
 * reply's hash; reactions return nothing.
 */
export async function actOnFarcasterLink(url: string, action: FarcasterLinkAction): Promise<{ fid: number; hash?: `0x${string}` }> {
  const stored = await load();
  if (!stored) throw new PublishingError('Connect Farcaster in Settings → Cross-posting.');
  if (!fitsFarcasterLink(url)) throw new PublishingError('That link is too long for Farcaster.');
  if (action.kind === 'comment') {
    const hash = await submit(stored, (key) => signCastAdd({ fid: stored.fid, text: action.text, parentUrl: url }, key));
    return { fid: stored.fid, hash: hash as `0x${string}` };
  }
  const reaction = { fid: stored.fid, type: action.kind === 'like' ? 'like' as const : 'recast' as const, target: { url } };
  // Farcaster keeps one reaction per account and link, so repeating an add or a remove is already done.
  await submit(stored, (key) => (action.on ? signReactionAdd : signReactionRemove)(reaction, key), true);
  return { fid: stored.fid };
}

/** Signs on this device and relays only the signed bytes through Open Media's server. */
async function submit(stored: StoredFarcaster, sign: (key: Uint8Array) => SignedFarcasterMessage, duplicateIsDone = false): Promise<string> {
  const key = fromHex(stored.privateKey);
  try {
    const message = sign(key);
    const token = await getAPIAccessToken();
    if (!token) throw new PublishingError('Sign in to Open Media first.');
    const response = await fetch(`${apiURL()}/v1/cross-posting/farcaster/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: message.bytes as unknown as BodyInit });
    const body = await response.json().catch(() => ({})) as { hash?: string; error?: string };
    if (!response.ok && !(duplicateIsDone && /already/i.test(body.error ?? ''))) throw new PublishingError(body.error ?? 'Farcaster didn’t accept the post.');
    return body.hash ?? message.hash;
  } finally {
    key.fill(0);
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { CrossPostVideo } from '../../domain/crossPosting';
import { videoExtension } from '../../domain/postVideo';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * DeSo: DeSo Identity issues a derived key that may only submit posts and can spend at most
 * 0.01 DESO in fees. The key is created in this browser and never sent anywhere. Videos are uploaded
 * through DeSo's media API (which stores them with Livepeer) and attached as VideoURLs. Web only for now:
 * the DeSo SDK needs crypto shims and a WebView crypto bridge on iOS and Android.
 */
const accountKey = 'open-media.network.deso';
const nodeURI = 'https://node.deso.org';

type DesoSdk = typeof import('deso-protocol');
let sdk: Promise<DesoSdk> | undefined;

/** Loaded on first use so the SDK isn't evaluated unless someone connects DeSo. */
function desoSdk() {
  sdk ??= import('deso-protocol').then((module) => {
    module.configure({
      appName: 'Open Media',
      nodeURI,
      spendingLimitOptions: {
        GlobalDESOLimit: 0.01 * 1e9,
        TransactionCountLimitMap: { SUBMIT_POST: 'UNLIMITED', AUTHORIZE_DERIVED_KEY: 1 },
      },
    });
    return module;
  });
  return sdk;
}

interface StoredDeso { publicKey: string; username: string }

async function load(): Promise<StoredDeso | undefined> {
  try { return JSON.parse((await AsyncStorage.getItem(accountKey)) ?? 'null') ?? undefined; } catch { return undefined; }
}

function toAccount(stored: StoredDeso): NetworkAccount {
  return { network: 'deso', handle: stored.username.startsWith('BC1') ? `${stored.username.slice(0, 8)}…` : `@${stored.username}`, profileURL: `https://focus.xyz/${encodeURIComponent(stored.username)}` };
}

export const desoPublisher: PublishingConnector = {
  id: 'deso',
  revokeHint: 'Open Media’s DeSo key can only post and spend at most 0.01 DESO in fees. You can remove it in any DeSo app’s settings.',

  async availability() {
    if (Platform.OS === 'web') desoSdk().catch(() => { sdk = undefined; }); // Preload so Connect opens DeSo's window right on the click.
    return Platform.OS === 'web'
      ? { available: true }
      : { available: false, setup: 'device', reason: 'For now, connect DeSo from Open Media on the web.' };
  },

  async account() {
    const stored = await load();
    return stored ? toAccount(stored) : undefined;
  },

  async connect() {
    const deso = await desoSdk();
    try {
      await deso.identity.login({ getFreeDeso: true });
    } catch (error) {
      const type = (error as { type?: string }).type;
      throw new PublishingError(type === 'NO_MONEY'
        ? 'Your DeSo account needs a little DESO to pay network fees (well under a cent per post). Add some in DeSo, then connect again.'
        : 'DeSo sign-in didn’t finish. Allow pop-ups for Open Media and try again.');
    }
    const publicKey = (await deso.identity.snapshot()).currentUser?.publicKey;
    if (!publicKey) throw new PublishingError('DeSo sign-in didn’t finish. Try again.');
    const profile = await deso.getSingleProfile({ PublicKeyBase58Check: publicKey, NoErrorOnMissing: true }).catch(() => undefined);
    const stored = { publicKey, username: profile?.Profile?.Username || publicKey };
    await AsyncStorage.setItem(accountKey, JSON.stringify(stored));
    return toAccount(stored);
  },

  async disconnect() {
    await AsyncStorage.removeItem(accountKey);
    const deso = await desoSdk();
    await deso.identity.logout().catch(() => undefined);
  },

  async publish(content) {
    const stored = await load();
    if (!stored) throw new PublishingError('Connect DeSo in Settings → Cross-posting.');
    const deso = await desoSdk();
    const current = (await deso.identity.snapshot()).currentUser?.publicKey;
    if (current !== stored.publicKey) throw new PublishingError('DeSo signed out on this browser. Reconnect DeSo in Settings.');
    try {
      // Never open a permission pop-up mid-publish (browsers block it); explain instead.
      const videoURLs = content.video ? [await uploadVideo(deso, stored.publicKey, content.video)] : [];
      const result = await deso.submitPost({ UpdaterPublicKeyBase58Check: stored.publicKey, BodyObj: { Body: content.text, ImageURLs: [], VideoURLs: videoURLs } }, { checkPermissions: false });
      const hash = (result.constructedTransactionResponse as { PostHashHex?: string }).PostHashHex ?? (result.submittedTransactionResponse as { TxnHashHex?: string } | undefined)?.TxnHashHex;
      if (!hash) throw new Error('missing hash');
      return { externalId: hash, url: `https://focus.xyz/post/${hash}` };
    } catch (error) {
      if (error instanceof PublishingError) throw error;
      const text = error instanceof Error ? error.message : String(error);
      if (/insufficient|balance|fee/i.test(text)) throw new PublishingError('Your DeSo account needs a little more DESO for network fees.');
      if (/spending limit|derived key|not authorized/i.test(text)) throw new PublishingError('Open Media’s DeSo key has expired or reached its limit. Reconnect DeSo in Settings.');
      throw new PublishingError('DeSo didn’t accept the post. Try again.');
    }
  },
};

/** Uploads the cleaned file to DeSo's media API; DeSo apps play `lvpr.tv` links natively. */
async function uploadVideo(deso: DesoSdk, publicKey: string, video: CrossPostVideo): Promise<string> {
  if (!video.bytes) throw new PublishingError('DeSo needs the video file itself, which isn’t available on this device any more.');
  try {
    const file = new File([video.bytes as unknown as BlobPart], `open-media.${videoExtension(video.contentType)}`, { type: video.contentType });
    const response = await deso.uploadVideo({ UserPublicKeyBase58Check: publicKey, file });
    const playbackId = response.asset?.playbackId;
    if (!playbackId) throw new Error('missing playback id');
    return `https://lvpr.tv/?v=${encodeURIComponent(playbackId)}`;
  } catch {
    throw new PublishingError('DeSo didn’t accept the video upload. Try again.');
  }
}

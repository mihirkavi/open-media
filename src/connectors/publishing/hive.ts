import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { deviceSecretStorage } from '../../auth/supabase';
import { hivePermlink } from '../../domain/crossPosting';
import { hiveAuthBroadcast, HiveAuthSession, hiveAuthLogin } from './hiveAuth';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * Hive: posts are signed by Hive Keychain, which holds the person's keys and asks them to approve.
 * On web that is the browser extension; on iOS and Android it is the Keychain mobile app through
 * HiveAuth, which needs no Open Media account on Hive. Open Media keeps only the account name and,
 * on phones, the HiveAuth session (in the device keychain).
 */
const accountKey = 'open-media.network.hive';
const sessionKey = 'open-media.network.hive.session';
const native = Platform.OS !== 'web';

async function loadSession(): Promise<HiveAuthSession | undefined> {
  try {
    const session = JSON.parse((await deviceSecretStorage().getItem(sessionKey)) ?? 'null') as HiveAuthSession | null;
    return session && session.expire > Date.now() ? session : undefined;
  } catch {
    return undefined;
  }
}
const appTag = 'openmedia';

interface KeychainResponse { success: boolean; message?: string; error?: unknown; result?: { id?: string; tx_id?: string } }
interface HiveKeychain {
  requestSignBuffer(account: string | null, message: string, key: 'Posting', callback: (response: KeychainResponse & { data?: { username?: string } }) => void, rpc?: string, title?: string): void;
  requestPost(account: string, title: string, body: string, parentPerm: string, parentAccount: string, jsonMetadata: string, permlink: string, commentOptions: string, callback: (response: KeychainResponse) => void): void;
}

function keychain(): HiveKeychain | undefined {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? (window as unknown as { hive_keychain?: HiveKeychain }).hive_keychain : undefined;
}

/** The extension injects itself shortly after page load. */
async function waitForKeychain(timeoutMs = 1500): Promise<HiveKeychain | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (!keychain() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  return keychain();
}

async function load(): Promise<string | undefined> {
  const name = await AsyncStorage.getItem(accountKey);
  return name && /^[a-z][a-z0-9.-]{2,15}$/.test(name) ? name : undefined;
}

function toAccount(name: string): NetworkAccount {
  return { network: 'hive', handle: `@${name}`, profileURL: `https://peakd.com/@${name}` };
}

export const hivePublisher: PublishingConnector = {
  id: 'hive',
  revokeHint: 'Hive Keychain asks you to approve each post, and Open Media never receives your keys.',

  async availability() {
    if (native) return { available: true };
    return (await waitForKeychain())
      ? { available: true }
      : { available: false, setup: 'device', reason: 'Install the Hive Keychain browser extension to post to Hive.' };
  },

  async account() {
    const name = await load();
    return name ? toAccount(name) : undefined;
  },

  async connect({ requestText, showApproval }) {
    if (native) {
      const typed = await requestText({ title: 'Your Hive username', message: 'Open Media asks Hive Keychain on this phone to approve it. Keychain keeps your keys; Open Media never sees them.', placeholder: 'username' });
      const name = typed.trim().replace(/^@/, '').toLowerCase();
      if (!/^[a-z][a-z0-9.-]{2,15}$/.test(name)) throw new PublishingError('That isn’t a valid Hive username.');
      try {
        const session = await hiveAuthLogin(name, (link) => showApproval({ title: 'Approve Open Media in Hive Keychain', message: 'Hive Keychain should open. Approve Open Media there, then come back. No Keychain on this phone? Open it on another device and scan the code in its HiveAuth screen.', url: link }));
        await deviceSecretStorage().setItem(sessionKey, JSON.stringify(session));
      } finally {
        showApproval(undefined);
      }
      await AsyncStorage.setItem(accountKey, name);
      return toAccount(name);
    }
    const extension = await waitForKeychain();
    if (!extension) throw new PublishingError('Install the Hive Keychain browser extension, then try again.');
    // Proves which account the person controls, without a transaction or any key leaving Keychain.
    const name = await new Promise<string>((resolve, reject) => {
      extension.requestSignBuffer(null, `Connect Open Media to Hive · ${new Date().toISOString()}`, 'Posting', (response) => {
        const username = response.data?.username;
        if (response.success && username) resolve(username); else reject(new PublishingError('Hive Keychain didn’t confirm an account.'));
      }, undefined, 'Connect Open Media');
    });
    await AsyncStorage.setItem(accountKey, name);
    return toAccount(name);
  },

  async disconnect() {
    await AsyncStorage.removeItem(accountKey);
    await deviceSecretStorage().removeItem(sessionKey);
  },

  async publish(content, idempotencyKey) {
    const name = await load();
    if (!name) throw new PublishingError('Connect Hive in Settings → Cross-posting.');
    const title = content.title ?? content.text.slice(0, 80);
    // Derived from the post's idempotency key, so a retry edits the same permlink instead of duplicating.
    const permlink = hivePermlink(title, hashToBase36(idempotencyKey));
    const metadata = JSON.stringify({ tags: [appTag, 'crosspost', ...(content.video ? ['video'] : [])], app: 'openmedia/1.0', format: 'markdown', ...(content.video ? { links: [content.video.url], ...(content.video.posterUrl ? { image: [content.video.posterUrl] } : {}) } : {}) });
    if (native) {
      const session = await loadSession();
      if (!session) throw new PublishingError('Your Hive Keychain approval expired. Reconnect Hive in Settings.');
      const op = ['comment', { parent_author: '', parent_permlink: appTag, author: name, permlink, title, body: content.text, json_metadata: metadata }];
      const txId = await hiveAuthBroadcast(session, [op], () => undefined).catch((error: unknown) => { throw error instanceof PublishingError ? error : new PublishingError(hiveError(String(error))); });
      return { externalId: txId, url: `https://peakd.com/@${name}/${permlink}` };
    }
    const extension = await waitForKeychain();
    if (!extension) throw new PublishingError('Hive Keychain isn’t available in this browser.');
    const txId = await new Promise<string>((resolve, reject) => {
      extension.requestPost(name, title, content.text, appTag, '', metadata, permlink, '', (response) => {
        if (response.success) resolve(response.result?.id ?? response.result?.tx_id ?? permlink);
        else reject(new PublishingError(hiveError(response.message ?? String(response.error ?? ''))));
      });
    });
    return { externalId: txId, url: `https://peakd.com/@${name}/${permlink}` };
  },
};

function hiveError(message: string): string {
  if (/cancel|denied|reject/i.test(message)) return 'The post was declined in Hive Keychain.';
  if (/HIVE_MIN_ROOT_COMMENT_INTERVAL|once every 5 minutes|interval/i.test(message)) return 'Hive allows one new post every 5 minutes. Try again shortly.';
  if (/RC|resource credit|bandwidth/i.test(message)) return 'Your Hive account doesn’t have enough Resource Credits right now.';
  return 'Hive didn’t accept the post.';
}

function hashToBase36(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

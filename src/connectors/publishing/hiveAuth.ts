import { getRandomBytes, randomUUID } from 'expo-crypto';
import { AppState, Linking } from 'react-native';

import { hiveAuthDecrypt, hiveAuthEncrypt, toBase64 } from './hiveAuthCrypto';
import { PublishingError } from './types';

/**
 * HiveAuth (HAS) client for iOS and Android: Hive Keychain mobile approves requests, and Open Media
 * never holds a Hive key. Protocol: https://docs.hiveauth.com (live server speaks protocol 0.8).
 * The app keeps an `auth_key` (encrypts payloads) and a session token from Keychain. While someone
 * is in Keychain, iOS may suspend this app; on return it reconnects and re-attaches the request.
 */
export const hiveAuthHost = 'wss://hive-auth.arcange.eu/';

export interface HiveAuthSession { account: string; token: string; key: string; expire: number }

type ServerMessage = { cmd: string; uuid?: string; expire?: number; data?: string; error?: string; message?: string };

const appInfo = { name: 'Open Media', description: 'Post once, publish everywhere.', icon: 'https://raw.githubusercontent.com/mihirkavi/open-media/main/assets/icon.png' };

function encrypt(value: unknown, key: string) {
  return hiveAuthEncrypt(JSON.stringify(value), key, getRandomBytes(8));
}

/** One request/response exchange, surviving the socket being dropped while the app is in the background. */
async function exchange(request: object, waitCmd: string, doneCmds: string[], onWait: (wait: ServerMessage) => void, timeoutMs = 120_000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined;
    let uuid: string | undefined;
    let settled = false;
    let expireTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(expireTimer);
      subscription.remove();
      try { socket?.close(); } catch { /* already closed */ }
      fn();
    };
    const open = (first: boolean) => {
      socket = new WebSocket(hiveAuthHost);
      socket.onmessage = (event) => {
        let message: ServerMessage;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.cmd === 'connected') {
          socket?.send(JSON.stringify(first || !uuid ? request : { cmd: 'attach_req', uuid }));
        } else if (message.cmd === waitCmd && message.uuid && !uuid) {
          uuid = message.uuid;
          clearTimeout(expireTimer);
          expireTimer = setTimeout(() => finish(() => reject(new PublishingError('Hive Keychain didn’t respond in time. Try again.'))), Math.max(10_000, (message.expire ?? Date.now() + 60_000) - Date.now()));
          onWait(message);
        } else if (message.uuid && message.uuid === uuid && doneCmds.includes(message.cmd)) {
          finish(() => resolve(message));
        } else if (message.cmd === 'error' && !uuid) {
          finish(() => reject(new PublishingError(message.error || message.message || 'HiveAuth refused the request.')));
        }
      };
      socket.onerror = () => undefined;
    };
    // Coming back from Keychain: the old socket is often gone, so reconnect and re-attach.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || settled || !uuid) return;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ cmd: 'attach_req', uuid }));
      else open(false);
    });
    expireTimer = setTimeout(() => finish(() => reject(new PublishingError('HiveAuth didn’t answer. Check your connection and try again.'))), timeoutMs);
    open(true);
  });
}

/** Asks Hive Keychain (on this phone, or by QR on another) to approve Open Media for `account`. */
export async function hiveAuthLogin(account: string, showLink: (link: string) => void): Promise<HiveAuthSession> {
  const key = randomUUID();
  const reply = await exchange(
    { cmd: 'auth_req', account, data: encrypt({ app: appInfo }, key) },
    'auth_wait', ['auth_ack', 'auth_nack', 'auth_err'],
    (wait) => {
      const link = `has://auth_req/${toBase64(new TextEncoder().encode(JSON.stringify({ account, uuid: wait.uuid, key, host: hiveAuthHost })))}`;
      showLink(link);
      Linking.openURL(link).catch(() => undefined);
    },
  );
  if (reply.cmd !== 'auth_ack' || !reply.data) throw new PublishingError('The connection was declined in Hive Keychain.');
  const approved = JSON.parse(hiveAuthDecrypt(reply.data, key)) as { token?: string; expire?: number };
  if (!approved.token) throw new PublishingError('Hive Keychain didn’t return a session.');
  return { account, token: approved.token, key, expire: approved.expire ?? Date.now() + 24 * 60 * 60 * 1000 };
}

/** Signs and broadcasts posting operations through Keychain; resolves with the transaction id. */
export async function hiveAuthBroadcast(session: HiveAuthSession, ops: unknown[], onWaiting: () => void): Promise<string> {
  const reply = await exchange(
    { cmd: 'sign_req', account: session.account, token: session.token, data: encrypt({ key_type: 'posting', ops, broadcast: true, nonce: Date.now() }, session.key) },
    'sign_wait', ['sign_ack', 'sign_nack', 'sign_err'],
    onWaiting,
  );
  if (reply.cmd === 'sign_ack' && typeof reply.data === 'string') return reply.data;
  const reason = reply.cmd === 'sign_err' && reply.error ? safeDecrypt(reply.error, session.key) : reply.error;
  throw new PublishingError(reason && /reject|cancel|declin/i.test(reason) ? 'The post was declined in Hive Keychain.' : 'Hive didn’t accept the post.');
}

function safeDecrypt(value: string, key: string) {
  try { return hiveAuthDecrypt(value, key); } catch { return value; }
}

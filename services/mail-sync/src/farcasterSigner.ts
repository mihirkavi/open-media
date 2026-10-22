/**
 * Farcaster cross-posting: Open Media's app account signs a "signed key request" for a key the
 * person's device generated, so the person can approve that key in the Farcaster app. Only the
 * public key reaches this service; the device keeps the private key. The app account's custody
 * mnemonic is a Worker secret and never leaves the Worker.
 *
 * Protocol: https://docs.farcaster.xyz/reference/farcaster/signer-requests
 */
import { mnemonicToAccount } from 'viem/accounts';

import { UserFacingError } from './errors.js';

export interface FarcasterSignerEnv {
  /** Open Media's own Farcaster account ID (FID). */
  FARCASTER_APP_FID?: string;
  /** Custody mnemonic of that account. Secret. */
  FARCASTER_APP_MNEMONIC?: string;
}

export const signedKeyRequestDomain = {
  name: 'Farcaster SignedKeyRequestValidator',
  version: '1',
  chainId: 10,
  verifyingContract: '0x00000000FC700472606ED4fA22623Acf62c60553',
} as const;

export const signedKeyRequestTypes = {
  SignedKeyRequest: [
    { name: 'requestFid', type: 'uint256' },
    { name: 'key', type: 'bytes' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const farcasterClientAPI = 'https://api.farcaster.xyz';
const requestLifetimeSeconds = 24 * 60 * 60;

export function farcasterPublishingConfigured(env: FarcasterSignerEnv): boolean {
  return Boolean(env.FARCASTER_APP_FID && /^\d+$/.test(env.FARCASTER_APP_FID) && env.FARCASTER_APP_MNEMONIC);
}

export function parseEd25519PublicKey(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new UserFacingError('A 32-byte Ed25519 public key (0x-prefixed hex) is required.');
  return value.toLowerCase() as `0x${string}`;
}

export interface SignedKeyRequest { token: string; deeplinkUrl: string; state: string }

/** Signs the EIP-712 request as the app account and registers it with the Farcaster client API. */
export async function createSignedKeyRequest(publicKey: `0x${string}`, env: FarcasterSignerEnv, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<SignedKeyRequest> {
  if (!farcasterPublishingConfigured(env)) throw new UserFacingError('Farcaster posting isn’t set up for this Open Media server yet.');
  const account = mnemonicToAccount(env.FARCASTER_APP_MNEMONIC!);
  const requestFid = BigInt(env.FARCASTER_APP_FID!);
  const deadline = BigInt(Math.floor(now / 1000) + requestLifetimeSeconds);
  const signature = await account.signTypedData({
    domain: signedKeyRequestDomain,
    types: signedKeyRequestTypes,
    primaryType: 'SignedKeyRequest',
    message: { requestFid, key: publicKey, deadline },
  });
  const response = await fetchImpl(`${farcasterClientAPI}/v2/signed-key-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: publicKey, requestFid: Number(requestFid), signature, deadline: Number(deadline) }),
  });
  const body = await response.json().catch(() => ({})) as { result?: { signedKeyRequest?: Partial<SignedKeyRequest> }; errors?: { message?: string }[] };
  const request = body.result?.signedKeyRequest;
  if (!response.ok || !request?.token || !request.deeplinkUrl?.startsWith('farcaster://')) {
    console.error(JSON.stringify({ event: 'farcaster_signed_key_request_failed', status: response.status }));
    throw new UserFacingError('Farcaster didn’t accept the connection request. Try again in a moment.');
  }
  return { token: request.token, deeplinkUrl: request.deeplinkUrl, state: request.state ?? 'pending' };
}

const snapchainNodes = ['https://crackle.farcaster.xyz:3381', 'https://haatz.quilibrium.com'];
const maxMessageBytes = 4096;

/**
 * Forwards a cast the device already signed to a public Snapchain node. Browsers can't post to the
 * node directly (its CORS preflight fails), and this service never sees the device's key.
 */
export async function forwardSignedMessage(bytes: ArrayBuffer, fetchImpl: typeof fetch = fetch): Promise<{ hash: string }> {
  if (!bytes.byteLength || bytes.byteLength > maxMessageBytes) throw new UserFacingError('That Farcaster message is empty or too large.');
  let lastError = 'Farcaster didn’t accept the post.';
  for (const node of snapchainNodes) {
    try {
      const response = await fetchImpl(`${node}/v1/submitMessage`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
      const body = await response.json().catch(() => ({})) as { hash?: string; error_detail?: string; errCode?: string };
      if (response.ok && typeof body.hash === 'string') return { hash: body.hash };
      if (response.status >= 400 && response.status < 500) throw new UserFacingError(farcasterRejection(body.error_detail ?? body.errCode ?? ''));
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      lastError = 'Couldn’t reach Farcaster. Try again.';
    }
  }
  throw new UserFacingError(lastError);
}

export function farcasterRejection(detail: string): string {
  if (/unknown signer|invalid signer|signer.*not found/i.test(detail)) return 'Farcaster no longer accepts Open Media’s key for this account. Reconnect Farcaster in Settings.';
  if (/storage|prunable|limit/i.test(detail)) return 'This Farcaster account is out of storage. Add storage in the Farcaster app, then try again.';
  if (/duplicate/i.test(detail)) return 'Farcaster already has this post.';
  return 'Farcaster didn’t accept the post.';
}

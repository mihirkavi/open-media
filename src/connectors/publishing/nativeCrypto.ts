import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { getRandomValues } from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * Hermes (iOS/Android) has no Web Crypto. The DeSo SDK signs with @noble/secp256k1, which reaches
 * for `crypto.getRandomValues` and `crypto.subtle` (SHA-256, HMAC). Give it a secure random source
 * from expo-crypto and the audited @noble/hashes implementations, and the `performance.timeOrigin`
 * the SDK uses for post timestamps. Browsers already have all of this, so web is untouched.
 */
let prepared: Promise<void> | undefined;

export function prepareNativeCrypto(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  prepared ??= (async () => {
    const scope = globalThis as unknown as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(array: T) => T }; performance?: { now(): number; timeOrigin?: number } };
    scope.crypto ??= {};
    scope.crypto.getRandomValues ??= <T extends ArrayBufferView>(array: T) => getRandomValues(array as never) as T;
    if (scope.performance && typeof scope.performance.timeOrigin !== 'number') {
      scope.performance.timeOrigin = Date.now() - scope.performance.now();
    }
    const secp = await import('@noble/secp256k1');
    secp.utils.sha256 = async (...messages: Uint8Array[]) => sha256(secp.utils.concatBytes(...messages));
    secp.utils.hmacSha256 = async (key: Uint8Array, ...messages: Uint8Array[]) => hmac(sha256, key, secp.utils.concatBytes(...messages));
  })();
  return prepared;
}

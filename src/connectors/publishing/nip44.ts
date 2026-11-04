import { chacha20 } from '@noble/ciphers/chacha';
import { secp256k1 } from '@noble/curves/secp256k1';
import { expand, extract } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

import { fromHexString } from '../../domain/openNetworkPosts';

/**
 * NIP-44 version 2 encryption, which Nostr remote signers (NIP-46) use for their messages.
 * Implemented from the NIP with audited @noble primitives: ECDH → HKDF → ChaCha20 + HMAC-SHA256.
 */
const salt = new TextEncoder().encode('nip44-v2');

export function conversationKey(secretKey: Uint8Array, publicKeyHex: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(secretKey, fromHexString(`02${publicKeyHex}`));
  return extract(sha256, shared.subarray(1, 33), salt);
}

function messageKeys(key: Uint8Array, nonce: Uint8Array) {
  const keys = expand(sha256, key, nonce, 76);
  return { chachaKey: keys.subarray(0, 32), chachaNonce: keys.subarray(32, 44), hmacKey: keys.subarray(44, 76) };
}

export function paddedLength(length: number): number {
  if (length <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(length - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((length - 1) / chunk) + 1);
}

function pad(plaintext: string): Uint8Array {
  const bytes = new TextEncoder().encode(plaintext);
  if (bytes.length < 1 || bytes.length > 65535) throw new Error('NIP-44 messages must be 1 to 65535 bytes.');
  const padded = new Uint8Array(2 + paddedLength(bytes.length));
  padded[0] = bytes.length >> 8; padded[1] = bytes.length & 0xff;
  padded.set(bytes, 2);
  return padded;
}

function unpad(padded: Uint8Array): string {
  const length = (padded[0] << 8) | padded[1];
  if (length < 1 || padded.length !== 2 + paddedLength(length)) throw new Error('Invalid NIP-44 padding.');
  return new TextDecoder().decode(padded.subarray(2, 2 + length));
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

const toBase64 = (bytes: Uint8Array) => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); };
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export function nip44Encrypt(plaintext: string, key: Uint8Array, nonce: Uint8Array): string {
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(key, nonce);
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext));
  const mac = hmac(sha256, hmacKey, new Uint8Array([...nonce, ...ciphertext]));
  return toBase64(new Uint8Array([2, ...nonce, ...ciphertext, ...mac]));
}

export function nip44Decrypt(payload: string, key: Uint8Array): string {
  if (payload.startsWith('#')) throw new Error('Unsupported NIP-44 version.');
  const data = fromBase64(payload);
  if (data[0] !== 2 || data.length < 99) throw new Error('Unsupported NIP-44 payload.');
  const nonce = data.subarray(1, 33);
  const ciphertext = data.subarray(33, data.length - 32);
  const mac = data.subarray(data.length - 32);
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(key, nonce);
  if (!equal(hmac(sha256, hmacKey, new Uint8Array([...nonce, ...ciphertext])), mac)) throw new Error('NIP-44 message failed authentication.');
  return unpad(chacha20(chachaKey, chachaNonce, ciphertext));
}

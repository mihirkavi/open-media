import { cbc } from '@noble/ciphers/aes';
import { md5 } from '@noble/hashes/legacy';

/**
 * HiveAuth encrypts every payload the way CryptoJS's passphrase mode does (OpenSSL "Salted__"):
 * base64("Salted__" ‖ 8-byte salt ‖ AES-256-CBC(PKCS7)), with the key and IV derived by
 * EVP_BytesToKey (MD5, one round). Implemented with audited @noble primitives so it runs on Hermes.
 * `hiveAuthCrypto.test.ts` checks it against OpenSSL.
 */
const prefix = new TextEncoder().encode('Salted__');

function evpBytesToKey(passphrase: Uint8Array, salt: Uint8Array) {
  const derived = new Uint8Array(48);
  let block: Uint8Array = new Uint8Array(0);
  for (let filled = 0; filled < 48; filled += block.length) {
    block = md5(concat(block, passphrase, salt));
    derived.set(block.subarray(0, Math.min(block.length, 48 - filled)), filled);
  }
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

export function hiveAuthEncrypt(plaintext: string, passphrase: string, salt: Uint8Array): string {
  if (salt.length !== 8) throw new Error('HiveAuth salt must be 8 bytes.');
  const { key, iv } = evpBytesToKey(new TextEncoder().encode(passphrase), salt);
  const ciphertext = cbc(key, iv).encrypt(new TextEncoder().encode(plaintext));
  return toBase64(concat(prefix, salt, ciphertext));
}

export function hiveAuthDecrypt(encrypted: string, passphrase: string): string {
  const bytes = fromBase64(encrypted);
  if (bytes.length < 32 || !prefix.every((byte, index) => bytes[index] === byte)) throw new Error('Not a HiveAuth payload.');
  const { key, iv } = evpBytesToKey(new TextEncoder().encode(passphrase), bytes.subarray(8, 16));
  return new TextDecoder().decode(cbc(key, iv).decrypt(bytes.subarray(16)));
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (alphabet.indexOf(clean[i]) << 18) | (alphabet.indexOf(clean[i + 1]) << 12) | ((clean[i + 2] ? alphabet.indexOf(clean[i + 2]) : 0) << 6) | (clean[i + 3] ? alphabet.indexOf(clean[i + 3]) : 0);
    out.push((n >> 16) & 255);
    if (clean[i + 2]) out.push((n >> 8) & 255);
    if (clean[i + 3]) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

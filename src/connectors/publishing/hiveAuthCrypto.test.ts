import assert from 'node:assert/strict';
import test from 'node:test';

import { fromBase64, hiveAuthDecrypt, hiveAuthEncrypt, toBase64 } from './hiveAuthCrypto';

// Produced by: printf '{"app":{"name":"Open Media"}}' | openssl enc -aes-256-cbc -md md5 -S 0011223344556677 -pass pass:test-auth-key -base64 -A
const openssl = 'U2FsdGVkX18AESIzRFVmd9lMJzPFD5qcDseIrphU+LtcO6RDjF9nkt+1Q9EwEXv0';
const salt = Uint8Array.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);

test('Encryption matches OpenSSL / CryptoJS passphrase mode byte for byte', () => {
  assert.equal(hiveAuthEncrypt('{"app":{"name":"Open Media"}}', 'test-auth-key', salt), openssl);
});

test('Decrypts OpenSSL output and round-trips Unicode', () => {
  assert.equal(hiveAuthDecrypt(openssl, 'test-auth-key'), '{"app":{"name":"Open Media"}}');
  const text = JSON.stringify({ body: 'Hëllo 👋 Hive', nonce: 1 });
  assert.equal(hiveAuthDecrypt(hiveAuthEncrypt(text, 'k', salt), 'k'), text);
  assert.throws(() => hiveAuthDecrypt(hiveAuthEncrypt(text, 'k', salt), 'wrong'));
});

test('Base64 matches the platform encoder', () => {
  for (const length of [0, 1, 2, 3, 4, 31]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37) & 255);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  }
});

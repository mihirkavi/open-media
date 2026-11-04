import assert from 'node:assert/strict';
import test from 'node:test';

import { fromHexString } from '../../domain/openNetworkPosts';
import { nostrPublicKeyFor } from '../nostrEvent';
import { conversationKey, nip44Decrypt, nip44Encrypt, paddedLength } from './nip44';

const one = fromHexString('0000000000000000000000000000000000000000000000000000000000000001');
const two = fromHexString('0000000000000000000000000000000000000000000000000000000000000002');

test('NIP-44 conversation key and payload match the spec’s first test vector', () => {
  const key = conversationKey(one, nostrPublicKeyFor(two));
  assert.equal(Buffer.from(key).toString('hex'), 'c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d');
  const payload = nip44Encrypt('a', key, one);
  assert.equal(payload, 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb');
  assert.equal(nip44Decrypt(payload, conversationKey(two, nostrPublicKeyFor(one))), 'a');
});

test('NIP-44 round-trips longer text and rejects tampering', () => {
  const key = conversationKey(one, nostrPublicKeyFor(two));
  const text = JSON.stringify({ id: 'abc', method: 'sign_event', params: ['é'.repeat(300)] });
  const payload = nip44Encrypt(text, key, two);
  assert.equal(nip44Decrypt(payload, key), text);
  const bytes = Buffer.from(payload, 'base64'); bytes[40] ^= 1;
  assert.throws(() => nip44Decrypt(bytes.toString('base64'), key));
});

test('NIP-44 padding follows the spec', () => {
  assert.deepEqual([1, 32, 33, 64, 65, 100, 257, 320, 383, 1000].map(paddedLength), [32, 32, 64, 64, 96, 128, 320, 320, 384, 1024]);
});

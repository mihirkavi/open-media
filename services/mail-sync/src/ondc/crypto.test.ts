import assert from 'node:assert/strict';
import { createCipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { authorizationHeader, bodyDigest, decryptChallenge, encryptionPublicKey, generateOndcKeys, parseAuthorization, signingPublicKey, signingString, signPlain, verifyAuthorization } from './crypto.js';

// ONDC's published example (developer-docs, registry/signing-verification.md).
const vector = {
  body: '{"context":{"domain":"nic2004:60212","country":"IND","city":"Kochi","action":"search","core_version":"0.9.1","bap_id":"bap.stayhalo.in","bap_uri":"https://8f9f-49-207-209-131.ngrok.io/protocol/","transaction_id":"e6d9f908-1d26-4ff3-a6d1-3af3d3721054","message_id":"a2fe6d52-9fe4-4d1a-9d0b-dccb8b48522d","timestamp":"2022-01-04T09:17:55.971Z","ttl":"P1M"},"message":{"intent":{"fulfillment":{"start":{"location":{"gps":"10.108768, 76.347517"}},"end":{"location":{"gps":"10.102997, 76.353480"}}}}}}',
  publicKey: 'awGPjRK6i/Vg/lWr+0xObclVxlwZXvTjWYtlu6NeOHk=',
  privateKey: 'lP3sHA+9gileOkXYJXh4Jg8tK0gEEMbf9yCPnFpbldhrAY+NErqL9WD+Vav7TE5tyVXGXBle9ONZi2W7o144eQ==',
  digest: 'b6lf6lRgOweajukcvcLsagQ2T60+85kRh/Rd2bdS+TG/5ALebOEgDJfyCrre/1+BMu5nA94o4DT3pTFXuUg7sw==',
  signature: 'cjbhP0PFyrlSCNszJM1F/YmHDVAWsZqJUPzojnE/7TJU3fJ/rmIlgaUHEr5E0/2PIyf0tpSnWtT6cyNNlpmoAQ==',
};

test('signing matches ONDC’s published example byte for byte', () => {
  assert.equal(bodyDigest(vector.body), vector.digest);
  assert.equal(signingPublicKey(vector.privateKey), vector.publicKey);
  assert.equal(signPlain(signingString(1641287875, 1641291475, vector.digest), vector.privateKey), vector.signature);
});

test('a signed header verifies; a changed body, a stale header or another key does not', () => {
  const header = authorizationHeader(vector.body, { subscriberId: 'example-bap.com', uniqueKeyId: 'bap1234', privateKey: vector.privateKey }, 1641287875, 3600);
  const parsed = parseAuthorization(header)!;
  assert.equal(parsed.signature, vector.signature);
  assert.equal(parsed.subscriberId, 'example-bap.com');
  assert.ok(verifyAuthorization(parsed, vector.body, vector.publicKey, 1641287900));
  assert.equal(verifyAuthorization(parsed, `${vector.body} `, vector.publicKey, 1641287900), false);
  assert.equal(verifyAuthorization(parsed, vector.body, vector.publicKey, 1641291476), false);
  assert.equal(verifyAuthorization(parsed, vector.body, generateOndcKeys().signingPublic, 1641287900), false);
  assert.equal(parseAuthorization(header.replace('|ed25519"', '|rsa"')), undefined, 'the keyId algorithm must be ed25519');
});

test('the on_subscribe challenge decrypts exactly as ONDC’s Node reference does', () => {
  const ours = generateOndcKeys();
  const registry = generateKeyPairSync('x25519');
  const registryDer = registry.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  // The registry's side, with Node's crypto as in ONDC's reference on_subscribe service.
  const shared = diffieHellman({ privateKey: registry.privateKey, publicKey: createPublicKey({ key: Buffer.from(ours.encryptionPublic, 'base64'), format: 'der', type: 'spki' }) });
  const cipher = createCipheriv('aes-256-ecb', shared, Buffer.alloc(0));
  const challenge = Buffer.concat([cipher.update('d7a1f3c2-challenge', 'utf8'), cipher.final()]).toString('base64');
  assert.equal(decryptChallenge(challenge, ours.encryptionPrivate, registryDer), 'd7a1f3c2-challenge');
  // Our DER keys are what Node itself reads and writes.
  const nodeKey = createPrivateKey({ key: Buffer.from(ours.encryptionPrivate, 'base64'), format: 'der', type: 'pkcs8' });
  assert.equal(createPublicKey(nodeKey).export({ format: 'der', type: 'spki' }).toString('base64'), encryptionPublicKey(ours.encryptionPrivate));
});

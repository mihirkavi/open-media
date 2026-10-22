import assert from 'node:assert/strict';
import test from 'node:test';

import { mnemonicToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';

import { createSignedKeyRequest, farcasterPublishingConfigured, farcasterRejection, forwardSignedMessage, parseEd25519PublicKey, signedKeyRequestDomain, signedKeyRequestTypes } from './farcasterSigner.js';

// The well-known public development mnemonic; it controls no real Farcaster account.
const env = { FARCASTER_APP_FID: '42', FARCASTER_APP_MNEMONIC: 'test test test test test test test test test test test junk' };
const key = `0x${'ab'.repeat(32)}` as const;

test('Farcaster publishing is off until both app settings exist', () => {
  assert.equal(farcasterPublishingConfigured({}), false);
  assert.equal(farcasterPublishingConfigured({ FARCASTER_APP_FID: 'x', FARCASTER_APP_MNEMONIC: 'm' }), false);
  assert.equal(farcasterPublishingConfigured(env), true);
});

test('Only 32-byte public keys are accepted', () => {
  assert.equal(parseEd25519PublicKey(key.toUpperCase().replace('0X', '0x')), key);
  assert.throws(() => parseEd25519PublicKey('0x1234'));
  assert.throws(() => parseEd25519PublicKey(undefined));
});

test('Key requests are signed by the app account under the Farcaster validator domain', async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ result: { signedKeyRequest: { token: '0xabc', deeplinkUrl: 'farcaster://signed-key-request?token=0xabc', state: 'pending' } } }), { status: 200 });
  }) as typeof fetch;
  const now = Date.UTC(2026, 9, 21);
  const result = await createSignedKeyRequest(key, env, fetchImpl, now);
  assert.equal(result.deeplinkUrl, 'farcaster://signed-key-request?token=0xabc');
  assert.equal(sent.requestFid, 42);
  assert.equal(sent.deadline, now / 1000 + 86_400);
  const valid = await verifyTypedData({
    address: mnemonicToAccount(env.FARCASTER_APP_MNEMONIC).address,
    domain: signedKeyRequestDomain, types: signedKeyRequestTypes, primaryType: 'SignedKeyRequest',
    message: { requestFid: 42n, key, deadline: BigInt(sent.deadline as number) },
    signature: sent.signature as `0x${string}`,
  });
  assert.equal(valid, true);
});

test('Key requests fail clearly when Farcaster refuses them', async () => {
  const fetchImpl = (async () => new Response('{}', { status: 400 })) as typeof fetch;
  await assert.rejects(createSignedKeyRequest(key, env, fetchImpl), /didn’t accept the connection request/);
  await assert.rejects(createSignedKeyRequest(key, {}, fetchImpl), /isn’t set up/);
});

test('Signed casts are forwarded and node rejections are explained', async () => {
  const ok = (async () => new Response(JSON.stringify({ hash: '0x01' }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await forwardSignedMessage(new Uint8Array([1, 2, 3]).buffer, ok), { hash: '0x01' });
  const rejected = (async () => new Response(JSON.stringify({ error_detail: 'bad_request.validation_failure/unknown signer' }), { status: 400 })) as typeof fetch;
  await assert.rejects(forwardSignedMessage(new Uint8Array([1]).buffer, rejected), /Reconnect Farcaster/);
  await assert.rejects(forwardSignedMessage(new ArrayBuffer(0), ok), /empty or too large/);
  assert.match(farcasterRejection('storage limit exceeded'), /out of storage/);
});

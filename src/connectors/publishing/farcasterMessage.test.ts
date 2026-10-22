import assert from 'node:assert/strict';
import test from 'node:test';

import { CastType, FarcasterNetwork, makeCastAdd, Message, MessageData, NobleEd25519Signer } from '@farcaster/core';

import { encodeCastAddData, fromHex, signCastAdd, toHex } from './farcasterMessage';

// Fixed test key: never a real account's key.
const privateKey = fromHex('1f'.repeat(32));
const timestampMs = Date.UTC(2026, 9, 21, 12, 0, 0);

async function reference(text: string, embeds: string[], parentUrl?: string) {
  const result = await makeCastAdd(
    { text, embeds: embeds.map((url) => ({ url })), embedsDeprecated: [], mentions: [], mentionsPositions: [], type: CastType.CAST, ...(parentUrl ? { parentUrl } : {}) },
    { fid: 123456, network: FarcasterNetwork.MAINNET, timestamp: Math.round(timestampMs / 1000 - Date.UTC(2021, 0, 1) / 1000) },
    new NobleEd25519Signer(privateKey),
  );
  if (result.isErr()) throw result.error;
  return result.value;
}

for (const [name, text, embeds, parentUrl] of [
  ['plain text', 'Hello from Open Media 👋', [], undefined],
  ['embeds and channel', 'With a link', ['https://example.com/a', 'https://example.com/b'], 'https://warpcast.com/~/channel/dev'],
] as const) {
  test(`CastAdd bytes match @farcaster/core (${name})`, async () => {
    const expected = await reference(text, [...embeds], parentUrl);
    const ours = signCastAdd({ fid: 123456, text, embedUrls: [...embeds], parentUrl, timestampMs }, privateKey);
    assert.equal(toHex(encodeCastAddData({ fid: 123456, text, embedUrls: [...embeds], parentUrl, timestampMs })), toHex(MessageData.encode(expected.data!).finish()));
    assert.equal(ours.hash, `0x${toHex(expected.hash)}`);
    const decoded = Message.decode(ours.bytes);
    assert.equal(toHex(decoded.signature), toHex(expected.signature));
    assert.equal(toHex(decoded.signer), toHex(expected.signer));
    assert.equal(decoded.hashScheme, expected.hashScheme);
    assert.equal(decoded.signatureScheme, expected.signatureScheme);
  });
}

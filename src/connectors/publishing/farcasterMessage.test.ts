import assert from 'node:assert/strict';
import test from 'node:test';

import { CastType, FarcasterNetwork, makeCastAdd, makeReactionAdd, makeReactionRemove, Message, MessageData, NobleEd25519Signer, ReactionType } from '@farcaster/core';

import { encodeCastAddData, encodeReactionAddData, encodeReactionRemoveData, fromHex, signCastAdd, signReactionAdd, signReactionRemove, toHex } from './farcasterMessage';

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
  ['video embed without text', '', ['https://abc.supabase.co/storage/v1/object/public/post-videos/a/b.mp4'], undefined],
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

test('a reply CastAdd matches @farcaster/core', async () => {
  const parentCastId = { fid: 42, hash: `0x${'ab'.repeat(20)}` as const };
  const result = await makeCastAdd(
    { text: 'Replying from Open Media', embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [], type: CastType.CAST, parentCastId: { fid: 42, hash: fromHex(parentCastId.hash) } },
    { fid: 123456, network: FarcasterNetwork.MAINNET, timestamp: Math.round(timestampMs / 1000 - Date.UTC(2021, 0, 1) / 1000) },
    new NobleEd25519Signer(privateKey),
  );
  if (result.isErr()) throw result.error;
  const ours = signCastAdd({ fid: 123456, text: 'Replying from Open Media', parentCastId, timestampMs }, privateKey);
  assert.equal(ours.hash, `0x${toHex(result.value.hash)}`);
  assert.equal(toHex(Message.decode(ours.bytes).signature), toHex(result.value.signature));
});

for (const [type, reference] of [['like', ReactionType.LIKE], ['recast', ReactionType.RECAST]] as const) {
  test(`ReactionAdd (${type}) matches @farcaster/core`, async () => {
    const target = { fid: 42, hash: `0x${'cd'.repeat(20)}` as const };
    const result = await makeReactionAdd(
      { type: reference, targetCastId: { fid: 42, hash: fromHex(target.hash) } },
      { fid: 123456, network: FarcasterNetwork.MAINNET, timestamp: Math.round(timestampMs / 1000 - Date.UTC(2021, 0, 1) / 1000) },
      new NobleEd25519Signer(privateKey),
    );
    if (result.isErr()) throw result.error;
    assert.equal(toHex(encodeReactionAddData({ fid: 123456, type, target, timestampMs })), toHex(MessageData.encode(result.value.data!).finish()));
    const ours = signReactionAdd({ fid: 123456, type, target, timestampMs }, privateKey);
    assert.equal(ours.hash, `0x${toHex(result.value.hash)}`);
    assert.equal(toHex(Message.decode(ours.bytes).signature), toHex(result.value.signature));
  });
}

// Likes and recasts of a web link (an event's page, a news article), and taking them back.
for (const [type, reference] of [['like', ReactionType.LIKE], ['recast', ReactionType.RECAST]] as const) {
  const url = 'https://lu.ma/golden-gate-run';
  const meta = { fid: 123456, network: FarcasterNetwork.MAINNET, timestamp: Math.round(timestampMs / 1000 - Date.UTC(2021, 0, 1) / 1000) };
  test(`ReactionAdd (${type}) of a link matches @farcaster/core`, async () => {
    const result = await makeReactionAdd({ type: reference, targetUrl: url }, meta, new NobleEd25519Signer(privateKey));
    if (result.isErr()) throw result.error;
    assert.equal(toHex(encodeReactionAddData({ fid: 123456, type, target: { url }, timestampMs })), toHex(MessageData.encode(result.value.data!).finish()));
    const ours = signReactionAdd({ fid: 123456, type, target: { url }, timestampMs }, privateKey);
    assert.equal(ours.hash, `0x${toHex(result.value.hash)}`);
    assert.equal(toHex(Message.decode(ours.bytes).signature), toHex(result.value.signature));
  });
  test(`ReactionRemove (${type}) of a link matches @farcaster/core`, async () => {
    const result = await makeReactionRemove({ type: reference, targetUrl: url }, meta, new NobleEd25519Signer(privateKey));
    if (result.isErr()) throw result.error;
    assert.equal(toHex(encodeReactionRemoveData({ fid: 123456, type, target: { url }, timestampMs })), toHex(MessageData.encode(result.value.data!).finish()));
    assert.equal(signReactionRemove({ fid: 123456, type, target: { url }, timestampMs }, privateKey).hash, `0x${toHex(result.value.hash)}`);
  });
}

test('a comment on a link is a CastAdd whose parent is the link', async () => {
  const parentUrl = 'https://lu.ma/golden-gate-run';
  const result = await makeCastAdd(
    { text: 'See you there', embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [], type: CastType.CAST, parentUrl },
    { fid: 123456, network: FarcasterNetwork.MAINNET, timestamp: Math.round(timestampMs / 1000 - Date.UTC(2021, 0, 1) / 1000) },
    new NobleEd25519Signer(privateKey),
  );
  if (result.isErr()) throw result.error;
  assert.equal(signCastAdd({ fid: 123456, text: 'See you there', parentUrl, timestampMs }, privateKey).hash, `0x${toHex(result.value.hash)}`);
});

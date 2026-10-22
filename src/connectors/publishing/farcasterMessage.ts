import { ed25519 } from '@noble/curves/ed25519';
import { blake3 } from '@noble/hashes/blake3';

/**
 * Builds a signed Farcaster CastAdd message (protobuf bytes) for Snapchain's HTTP `submitMessage`.
 * Uses audited @noble primitives instead of the 5 MB+ official SDK; `farcasterMessage.test.ts`
 * checks the bytes against @farcaster/core so the encoding cannot silently drift.
 *
 * Schema: farcasterxyz/snapchain proto/message.proto (Message, MessageData, CastAddBody).
 */
const MESSAGE_TYPE_CAST_ADD = 1;
const FARCASTER_NETWORK_MAINNET = 1;
const HASH_SCHEME_BLAKE3 = 1;
const SIGNATURE_SCHEME_ED25519 = 1;
const farcasterEpochSeconds = Date.UTC(2021, 0, 1) / 1000;

export interface CastInput {
  fid: number;
  text: string;
  embedUrls?: string[];
  /** Channel URL, e.g. `https://warpcast.com/~/channel/dev`. */
  parentUrl?: string;
  /** Unix milliseconds; defaults to now. */
  timestampMs?: number;
}

export interface SignedFarcasterMessage { bytes: Uint8Array; hash: `0x${string}` }

export function farcasterTime(unixMs: number): number {
  return Math.round(unixMs / 1000 - farcasterEpochSeconds);
}

export function encodeCastAddData(input: CastInput): Uint8Array {
  const body = new ProtoWriter();
  body.packedVarints(2, []); // mentions
  if (input.parentUrl) body.string(7, input.parentUrl);
  body.string(4, input.text);
  body.packedVarints(5, []); // mentionsPositions
  for (const url of input.embedUrls ?? []) body.message(6, new ProtoWriter().string(1, url));
  const data = new ProtoWriter();
  data.varint(1, MESSAGE_TYPE_CAST_ADD);
  data.varint(2, input.fid);
  data.varint(3, farcasterTime(input.timestampMs ?? Date.now()));
  data.varint(4, FARCASTER_NETWORK_MAINNET);
  data.message(5, body);
  return data.finish();
}

export function signCastAdd(input: CastInput, privateKey: Uint8Array): SignedFarcasterMessage {
  const dataBytes = encodeCastAddData(input);
  const hash = blake3(dataBytes, { dkLen: 20 });
  const signature = ed25519.sign(hash, privateKey);
  const signer = ed25519.getPublicKey(privateKey);
  const message = new ProtoWriter()
    .bytes(1, dataBytes)
    .bytes(2, hash)
    .varint(3, HASH_SCHEME_BLAKE3)
    .bytes(4, signature)
    .varint(5, SIGNATURE_SCHEME_ED25519)
    .bytes(6, signer);
  return { bytes: message.finish(), hash: `0x${toHex(hash)}` };
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error('Invalid hex.');
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

/** Minimal protobuf writer for the handful of field types a cast needs. */
class ProtoWriter {
  private chunks: number[] = [];

  varint(field: number, value: number) { this.tag(field, 0); this.rawVarint(value); return this; }
  string(field: number, value: string) { return this.bytes(field, new TextEncoder().encode(value)); }
  bytes(field: number, value: Uint8Array) { this.tag(field, 2); this.rawVarint(value.length); this.chunks.push(...value); return this; }
  message(field: number, value: ProtoWriter) { return this.bytes(field, value.finish()); }
  /** Matches ts-proto, which always writes packed repeated fields, even when empty. */
  packedVarints(field: number, values: number[]) {
    const inner = new ProtoWriter();
    values.forEach((value) => inner.rawVarint(value));
    return this.bytes(field, inner.finish());
  }
  finish() { return Uint8Array.from(this.chunks); }

  private tag(field: number, wireType: number) { this.rawVarint(field * 8 + wireType); }
  private rawVarint(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Varint out of range.');
    let rest = value;
    while (rest > 0x7f) { this.chunks.push((rest % 0x80) | 0x80); rest = Math.floor(rest / 0x80); }
    this.chunks.push(rest);
  }
}

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

import { fromHexString, NostrEvent, toHexString } from '../domain/openNetworkPosts';

/**
 * Nostr event IDs and signatures (NIP-01). Kept out of the feed module so the curve code loads
 * only when Nostr notes are read or signed.
 */
export type UnsignedNostrEvent = Omit<NostrEvent, 'id' | 'sig'>;

export function nostrEventId(event: UnsignedNostrEvent): string {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  return toHexString(sha256(new TextEncoder().encode(serialized)));
}

/** True only when the ID is the event's hash and the signature is its author's. */
export function verifyNostrEvent(event: NostrEvent): boolean {
  try {
    if (!/^[0-9a-f]{64}$/.test(event.id) || !/^[0-9a-f]{128}$/.test(event.sig) || !/^[0-9a-f]{64}$/.test(event.pubkey)) return false;
    if (nostrEventId(event) !== event.id) return false;
    return schnorr.verify(fromHexString(event.sig), fromHexString(event.id), fromHexString(event.pubkey));
  } catch { return false; }
}

export function signNostrEvent(event: UnsignedNostrEvent, secretKey: Uint8Array): NostrEvent {
  const id = nostrEventId(event);
  return { ...event, id, sig: toHexString(schnorr.sign(fromHexString(id), secretKey)) };
}

export function nostrPublicKeyFor(secretKey: Uint8Array): string {
  return toHexString(schnorr.getPublicKey(secretKey));
}

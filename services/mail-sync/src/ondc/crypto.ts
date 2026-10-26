/**
 * ONDC message signing and registry onboarding crypto (ADR 0015).
 *
 * Requests and callbacks carry `Authorization: Signature keyId="{subscriber}|{key}|ed25519",…`:
 * an Ed25519 signature over "(created): …\n(expires): …\ndigest: BLAKE-512=…", where the digest is
 * BLAKE2b-512 of the exact body. Onboarding also needs the signed request_id for the site
 * verification page and the on_subscribe answer: the registry's challenge, AES-256-ECB encrypted
 * with the X25519 shared secret between ONDC's key and ours. Key formats follow ONDC's reference
 * utilities: signing keys are raw base64 (64-byte private, 32-byte public); encryption keys are
 * DER (PKCS#8 private, SPKI public), base64.
 */
import { ecb } from '@noble/ciphers/aes';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';

/** ONDC's own encryption keys, used to answer the registry's on_subscribe challenge. */
export const ondcRegistryKeys = {
  preprod: 'MCowBQYDK2VuAyEARa/WcMCzNQp4DWjvTI4DK7vHL6EdaHqN4GjFIu9wxxM=',
  prod: 'MCowBQYDK2VuAyEAwASk2D4O3p/tuD8f9sNQAQlwOU2w3DAumcOK9qHCFwI=',
} as const;

const encoder = new TextEncoder();
const pkcs8Prefix = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const spkiPrefix = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

export class OndcKeyError extends Error {}

/** BLAKE2b-512 of the body, base64. */
export function bodyDigest(body: string): string {
  return toBase64(blake2b(encoder.encode(body), { dkLen: 64 }));
}

export function signingString(created: number, expires: number, digest: string): string {
  return `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;
}

/** The 32-byte Ed25519 seed from ONDC's 64-byte private key (seed then public key), or a bare seed. */
function signingSeed(privateKey: string): Uint8Array {
  const bytes = fromBase64(privateKey);
  if (bytes.length !== 64 && bytes.length !== 32) throw new OndcKeyError('The ONDC signing private key must be 32 or 64 bytes, base64.');
  return bytes.subarray(0, 32);
}

export function signingPublicKey(privateKey: string): string {
  return toBase64(ed25519.getPublicKey(signingSeed(privateKey)));
}

/** Signs text as is, with no hashing: the site-verification request_id. */
export function signPlain(text: string, privateKey: string): string {
  return toBase64(ed25519.sign(encoder.encode(text), signingSeed(privateKey)));
}

export interface SignerKey { subscriberId: string; uniqueKeyId: string; privateKey: string }

export function authorizationHeader(body: string, key: SignerKey, now = Math.floor(Date.now() / 1000), ttlSeconds = 300): string {
  const created = now; const expires = now + ttlSeconds;
  const signature = signPlain(signingString(created, expires, bodyDigest(body)), key.privateKey);
  return `Signature keyId="${key.subscriberId}|${key.uniqueKeyId}|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

export interface ParsedAuthorization { subscriberId: string; uniqueKeyId: string; algorithm: string; created: number; expires: number; signature: string }

export function parseAuthorization(header: string | null): ParsedAuthorization | undefined {
  if (!header?.trim().startsWith('Signature')) return undefined;
  const fields: Record<string, string> = {};
  for (const match of header.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) fields[match[1]] = match[2];
  const [subscriberId, uniqueKeyId, keyAlgorithm] = (fields.keyId ?? '').split('|');
  const created = Number(fields.created); const expires = Number(fields.expires);
  if (!subscriberId || !uniqueKeyId || !fields.signature || !Number.isInteger(created) || !Number.isInteger(expires)) return undefined;
  // The algorithm named in keyId must match the algorithm parameter (ONDC signing spec, step 3).
  if (keyAlgorithm !== 'ed25519' || (fields.algorithm ?? 'ed25519') !== 'ed25519') return undefined;
  return { subscriberId, uniqueKeyId, algorithm: 'ed25519', created, expires, signature: fields.signature };
}

/** Checks the signature against the sender's registered public key and the time window. */
export function verifyAuthorization(parsed: ParsedAuthorization, body: string, publicKey: string, now = Math.floor(Date.now() / 1000)): boolean {
  if (parsed.created > now + 60 || parsed.expires < now) return false;
  try {
    return ed25519.verify(fromBase64(parsed.signature), encoder.encode(signingString(parsed.created, parsed.expires, bodyDigest(body))), fromBase64(publicKey));
  } catch {
    return false;
  }
}

function x25519Private(der: string): Uint8Array {
  const bytes = fromBase64(der);
  if (bytes.length !== 48 || !pkcs8Prefix.every((byte, index) => bytes[index] === byte)) throw new OndcKeyError('The ONDC encryption private key must be an X25519 PKCS#8 DER key, base64.');
  return bytes.subarray(16);
}

function x25519Public(der: string): Uint8Array {
  const bytes = fromBase64(der);
  if (bytes.length !== 44 || !spkiPrefix.every((byte, index) => bytes[index] === byte)) throw new OndcKeyError('An X25519 public key must be SPKI DER, base64.');
  return bytes.subarray(12);
}

const spki = (raw: Uint8Array) => toBase64(Uint8Array.from([...spkiPrefix, ...raw]));

export function encryptionPublicKey(privateDer: string): string {
  return spki(x25519.getPublicKey(x25519Private(privateDer)));
}

/** The answer to the registry's on_subscribe challenge. */
export function decryptChallenge(challenge: string, privateDer: string, registryPublicDer: string): string {
  const shared = x25519.getSharedSecret(x25519Private(privateDer), x25519Public(registryPublicDer));
  return new TextDecoder().decode(ecb(shared).decrypt(fromBase64(challenge)));
}

/** New key pairs for `npm run ondc:keys`. */
export function generateOndcKeys() {
  const seed = ed25519.utils.randomPrivateKey();
  const encryption = x25519.utils.randomPrivateKey();
  const signingPrivate = toBase64(Uint8Array.from([...seed, ...ed25519.getPublicKey(seed)]));
  const encryptionPrivate = toBase64(Uint8Array.from([...pkcs8Prefix, ...encryption]));
  return { signingPrivate, signingPublic: signingPublicKey(signingPrivate), encryptionPrivate, encryptionPublic: encryptionPublicKey(encryptionPrivate) };
}

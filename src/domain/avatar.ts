/**
 * Profile pictures. A person either picks a photo or, until they do, Open Media offers the
 * Gravatar they already made public for their account email. Either way the image is copied into
 * Open Media's public `avatars` bucket, so the profile never publishes the email's Gravatar hash.
 * Location, camera and other metadata are removed on the device before anything is uploaded.
 */

export const avatarBucket = 'avatars';
export const avatarMaxBytes = 5 * 1024 * 1024;
/** Pictures are drawn at most this many pixels square on web; phones crop to a square in the picker. */
export const avatarSize = 512;

export type AvatarContentType = 'image/jpeg' | 'image/png';

export function avatarContentType(bytes: Uint8Array): AvatarContentType | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return undefined;
}

/**
 * Removes metadata from a JPEG or PNG: in a JPEG every APP1–APP15 segment (EXIF with GPS, XMP,
 * ICC, maker notes) and comments; in a PNG the text and EXIF chunks. The pixels are untouched.
 */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  const type = avatarContentType(bytes);
  if (type === 'image/jpeg') return stripJpeg(bytes);
  if (type === 'image/png') return stripPng(bytes);
  throw new Error('Choose a JPEG or PNG picture.');
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('That picture couldn’t be read. Try another one.');
    const marker = bytes[at + 1];
    // Start of scan: the rest is image data.
    if (marker === 0xda) { kept.push(bytes.subarray(at)); break; }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) throw new Error('That picture couldn’t be read. Try another one.');
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) kept.push(bytes.subarray(at, end));
    at = end;
  }
  return concat(kept);
}

const pngMetadataChunks = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

function stripPng(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length) throw new Error('That picture couldn’t be read. Try another one.');
    if (!pngMetadataChunks.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  return concat(kept);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Gravatar hashes the trimmed, lower-cased address (SHA-256 is its current scheme). */
export function gravatarAddress(email: string): string {
  return email.trim().toLowerCase();
}

/** `d=404` makes Gravatar answer 404 instead of a generated picture when the address has none. */
export function gravatarUrl(sha256: string, size = avatarSize): string {
  return `https://gravatar.com/avatar/${sha256}?s=${size}&d=404`;
}

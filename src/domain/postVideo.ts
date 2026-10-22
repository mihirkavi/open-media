import { maxClipSeconds } from './posts';

/**
 * Short videos on Open Media posts (ADR 0009). Pure rules for what can be posted, how the file is
 * cleaned before it leaves the device, and where a stored video is played from. Uploading lives in
 * `src/data/videoUpload.ts`; picking and recording in `src/ui/VideoPicker.ts`.
 */

/** Matches the `post-videos` bucket limit and stays under Grove's 125 MB upload limit for Lens. */
export const maxVideoBytes = 100 * 1024 * 1024;
export const maxVideoSeconds = maxClipSeconds;
export const postVideoBucket = 'post-videos';

export type VideoContentType = 'video/mp4' | 'video/quicktime' | 'video/webm';
const extensions: Record<VideoContentType, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/** What the picker reports about a chosen video. Any field may be missing on some platforms. */
export interface VideoCandidate {
  sizeBytes?: number;
  durationSeconds?: number;
  mimeType?: string | null;
  fileName?: string | null;
}

export type VideoCheck = { ok: true } | { ok: false; reason: string };

/** Checks a picked video against Open Media's limits before anything is read or uploaded. */
export function checkVideoCandidate(candidate: VideoCandidate): VideoCheck {
  if (!videoContentTypeFor(candidate.mimeType, candidate.fileName)) return { ok: false, reason: 'Choose an MP4, MOV, or WebM video.' };
  if (candidate.sizeBytes !== undefined && candidate.sizeBytes > maxVideoBytes) {
    return { ok: false, reason: `This video is ${formatBytes(candidate.sizeBytes)}; the limit is ${formatBytes(maxVideoBytes)}. Trim it or export it at a lower quality.` };
  }
  if (candidate.sizeBytes === 0) return { ok: false, reason: 'This video file is empty.' };
  if (candidate.durationSeconds !== undefined && candidate.durationSeconds > maxVideoSeconds + 0.5) {
    return { ok: false, reason: `This video is ${formatDuration(candidate.durationSeconds)}; clips can be up to ${formatDuration(maxVideoSeconds)}. Trim it and try again.` };
  }
  return { ok: true };
}

export function videoContentTypeFor(mimeType?: string | null, fileName?: string | null): VideoContentType | undefined {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (mime === 'video/mp4' || mime === 'video/x-m4v') return 'video/mp4';
  if (mime === 'video/quicktime' || mime === 'video/mov') return 'video/quicktime';
  if (mime === 'video/webm') return 'video/webm';
  const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime';
  if (extension === 'webm') return 'video/webm';
  return undefined;
}

export function videoExtension(type: VideoContentType): string {
  return extensions[type];
}

/** Reads the container from the file's own bytes rather than trusting its name. */
export function sniffVideoContainer(bytes: Uint8Array): 'iso-bmff' | 'webm' | undefined {
  if (bytes.length >= 12 && fourcc(bytes, 4) === 'ftyp') return 'iso-bmff';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return undefined;
}

/** MP4 and MOV share a container; the brand tells QuickTime files apart. */
export function contentTypeFromBytes(bytes: Uint8Array): VideoContentType | undefined {
  const container = sniffVideoContainer(bytes);
  if (container === 'webm') return 'video/webm';
  if (container === 'iso-bmff') return fourcc(bytes, 8) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  return undefined;
}

export interface StrippedVideo {
  bytes: Uint8Array;
  /** Box paths that were neutralized, e.g. `moov/udta`. Empty when there was nothing to remove. */
  removed: string[];
}

const containerBoxes = new Set(['moov', 'trak', 'mdia', 'minf', 'edts']);
const metadataBoxes = new Set(['udta', 'meta']);
// Adobe XMP packets, which can carry GPS coordinates, live in this top-level uuid box.
const xmpUuid = 'be7acfcb97a942e89c71999491e3afac';

/**
 * Removes location and device metadata from an MP4 or MOV file without re-encoding: every `udta`
 * and `meta` box (where phones store GPS coordinates, camera make and model, and software) and the
 * XMP box are zeroed and renamed to `free`, which every player skips. Sizes and offsets stay the
 * same, so the video and audio are untouched. WebM recordings from browsers carry no location and pass through.
 */
export function stripVideoLocationMetadata(input: Uint8Array): StrippedVideo {
  if (sniffVideoContainer(input) !== 'iso-bmff') return { bytes: input, removed: [] };
  const bytes = input.slice();
  const removed: string[] = [];
  const walk = (start: number, end: number, path: string) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = readUint32(bytes, offset);
      const type = fourcc(bytes, offset + 4);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        size = readUint32(bytes, offset + 8) * 2 ** 32 + readUint32(bytes, offset + 12);
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) return; // Truncated or malformed: leave the rest as is.
      const here = path ? `${path}/${type}` : type;
      const isXmp = type === 'uuid' && !path && size >= header + 16 && toHex(bytes.subarray(offset + header, offset + header + 16)) === xmpUuid;
      if (metadataBoxes.has(type) || isXmp) {
        // Rename so players skip it, and zero the contents so the values are gone from the file.
        writeFourcc(bytes, offset + 4, 'free');
        bytes.fill(0, offset + header, offset + size);
        removed.push(here);
      } else if (containerBoxes.has(type)) {
        walk(offset + header, offset + size, here);
      }
      offset += size;
    }
  };
  walk(0, bytes.length, '');
  return { bytes, removed };
}

/** The canonical video attached to an Open Media post, as stored and returned by the public API. */
export interface StoredPostVideo {
  path: string;
  posterPath?: string | null;
  durationSeconds: number;
  width: number;
  height: number;
  contentType: VideoContentType;
  sha256: string;
}

/** Public URL of a file in the post-videos bucket for a Supabase project URL. */
export function postVideoPublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${postVideoBucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function isStoredPostVideo(value: unknown): value is StoredPostVideo {
  if (!value || typeof value !== 'object') return false;
  const video = value as Partial<StoredPostVideo>;
  return typeof video.path === 'string' && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm)$/.test(video.path)
    && (video.posterPath === undefined || video.posterPath === null || (typeof video.posterPath === 'string' && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(video.posterPath)))
    && Number(video.durationSeconds) > 0
    && Number(video.width) > 0 && Number(video.height) > 0
    && typeof video.contentType === 'string' && video.contentType in extensions
    && typeof video.sha256 === 'string' && /^[0-9a-f]{64}$/.test(video.sha256);
}

/**
 * Whether other networks' servers and apps can fetch a URL. Videos stored by a local development
 * stack (localhost, private addresses, plain http) cannot be embedded on Farcaster or Hive.
 */
export function isPubliclyReachableUrl(value: string | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test') || host.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return false;
  return true;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function writeFourcc(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

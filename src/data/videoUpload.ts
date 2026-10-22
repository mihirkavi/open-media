import { CryptoDigestAlgorithm, digest } from 'expo-crypto';

import { getAPIAccessToken, getSupabaseClient } from '../auth/supabase';
import { CrossPostVideo } from '../domain/crossPosting';
import { checkVideoCandidate, contentTypeFromBytes, maxVideoSeconds, postVideoBucket, postVideoPublicUrl, StoredPostVideo, stripVideoLocationMetadata, VideoContentType, videoExtension } from '../domain/postVideo';
import { PickedVideo, previewUri, probeVideo, readPickedVideo, releasePreview, uploadBytes } from './videoFiles';

export type { PickedVideo } from './videoFiles';

/** A picked video after it was read, checked, and cleaned on this device; nothing has left it yet. */
export interface PreparedVideo {
  bytes: Uint8Array;
  contentType: VideoContentType;
  durationSeconds: number;
  width: number;
  height: number;
  sha256: string;
  poster?: Uint8Array;
  /** Plays the cleaned file in the composer. Release it with `discardPreparedVideo`. */
  previewUri: string;
  /** How many metadata blocks (location, device, software) were removed. */
  removedMetadata: number;
}

export class VideoError extends Error {}

/** Reads the picked file, rejects anything over the limits, and removes location metadata. */
export async function prepareVideo(picked: PickedVideo): Promise<PreparedVideo> {
  const early = checkVideoCandidate({ sizeBytes: picked.sizeBytes, durationSeconds: picked.durationSeconds, mimeType: picked.mimeType, fileName: picked.fileName });
  if (!early.ok) throw new VideoError(early.reason);
  let raw: Uint8Array;
  try { raw = await readPickedVideo(picked); } catch { throw new VideoError('Open Media couldn’t read that video. Try another one.'); }
  const contentType = contentTypeFromBytes(raw);
  if (!contentType) throw new VideoError('That file isn’t an MP4, MOV, or WebM video.');
  const { bytes, removed } = stripVideoLocationMetadata(raw);
  const probe = await probeVideo(picked, bytes, contentType);
  const durationSeconds = probe.durationSeconds ?? picked.durationSeconds;
  const width = probe.width || picked.width;
  const height = probe.height || picked.height;
  if (!durationSeconds || !width || !height) throw new VideoError('Open Media couldn’t read this video’s length or size. Try an MP4 or MOV file.');
  const check = checkVideoCandidate({ sizeBytes: bytes.length, durationSeconds, mimeType: contentType });
  if (!check.ok) throw new VideoError(check.reason);
  const sha256 = hex(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as BufferSource)));
  return { bytes, contentType, durationSeconds: Math.min(durationSeconds, maxVideoSeconds), width, height, sha256, poster: probe.poster, previewUri: previewUri(picked, bytes, contentType), removedMetadata: removed.length };
}

export function discardPreparedVideo(video: PreparedVideo | undefined) {
  if (video) releasePreview(video.previewUri);
}

export interface UploadedVideo { stored: StoredPostVideo; url: string; posterUrl?: string }

/**
 * Uploads the cleaned file (and poster) to the author's folder in the public `post-videos` bucket.
 * The path is derived from the draft's client ID, so a retry replaces the same file.
 */
export async function uploadPostVideo(video: PreparedVideo, clientId: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<UploadedVideo> {
  const client = getSupabaseClient();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!client || !supabaseUrl || !apiKey) throw new VideoError('Open Media is not connected to its backend.');
  const userId = (await client.auth.getSession()).data.session?.user.id;
  const token = await getAPIAccessToken();
  if (!userId || !token) throw new VideoError('Sign in to post a video.');
  const path = `${userId}/${clientId}.${videoExtension(video.contentType)}`;
  const posterPath = video.poster ? `${userId}/${clientId}.jpg` : undefined;
  const headers = { authorization: `Bearer ${token}`, apikey: apiKey, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' };
  const objectUrl = (objectPath: string) => `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${postVideoBucket}/${objectPath}`;

  const posterShare = posterPath ? Math.max(0.01, video.poster!.length / (video.bytes.length + video.poster!.length)) : 0;
  const send = async (objectPath: string, bytes: Uint8Array, contentType: string, progress: (fraction: number) => void) => {
    const result = await uploadBytes({ url: objectUrl(objectPath), headers, bytes, contentType, onProgress: progress, signal })
      .catch((error: unknown) => { throw error instanceof Error && error.name === 'AbortError' ? error : new VideoError('The upload was interrupted. Check your connection and try again.'); });
    if (result.status === 413) throw new VideoError('This video is larger than the server accepts. Trim it or export it at a lower quality.');
    if (result.status === 401 || result.status === 403) throw new VideoError('Your session expired. Sign in again to post a video.');
    if (result.status < 200 || result.status >= 300) throw new VideoError(storageMessage(result.body) ?? 'The video didn’t upload. Try again.');
  };
  await send(path, video.bytes, video.contentType, (fraction) => onProgress(fraction * (1 - posterShare)));
  if (posterPath) await send(posterPath, video.poster!, 'image/jpeg', (fraction) => onProgress(1 - posterShare + fraction * posterShare)).catch(() => undefined);
  onProgress(1);
  const stored: StoredPostVideo = { path, posterPath: posterPath ?? null, durationSeconds: Math.round(video.durationSeconds * 100) / 100, width: video.width, height: video.height, contentType: video.contentType, sha256: video.sha256 };
  return { stored, url: postVideoPublicUrl(supabaseUrl, path), posterUrl: posterPath ? postVideoPublicUrl(supabaseUrl, posterPath) : undefined };
}

/** Removes a post's video files after the post itself was deleted. Failures are left for cleanup. */
export async function deletePostVideoFiles(paths: string[]): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !paths.length) return;
  await client.storage.from(postVideoBucket).remove(paths).catch(() => undefined);
}

/** What each network receives: the public URL plus the cleaned bytes for networks that keep a copy. */
export function crossPostVideo(video: PreparedVideo, uploaded: UploadedVideo, altText: string): CrossPostVideo {
  return { url: uploaded.url, posterUrl: uploaded.posterUrl, contentType: video.contentType, durationSeconds: video.durationSeconds, width: video.width, height: video.height, bytes: video.bytes, altText };
}

function storageMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    const message = parsed.message ?? parsed.error;
    if (!message) return undefined;
    if (/mime|type/i.test(message)) return 'That file type isn’t accepted. Choose an MP4, MOV, or WebM video.';
    if (/size|large/i.test(message)) return 'This video is larger than the server accepts. Trim it or export it at a lower quality.';
    return undefined;
  } catch {
    return undefined;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Stand-in for the post's video before it is uploaded, so the composer can show per-network limits. */
export function draftCrossPostVideo(video: PreparedVideo): CrossPostVideo {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const placeholder = `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`;
  return { url: postVideoPublicUrl(supabaseUrl, `${placeholder}/${placeholder}.${videoExtension(video.contentType)}`), contentType: video.contentType, durationSeconds: video.durationSeconds, width: video.width, height: video.height, bytes: video.bytes, altText: 'Video' };
}

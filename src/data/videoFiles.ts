import { File, Paths } from 'expo-file-system';

/**
 * iOS and Android: reading, probing, and uploading a picked video through expo-file-system.
 * `videoFiles.web.ts` covers web. Both export the same functions.
 */

/** A video chosen in the picker or just recorded. */
export interface PickedVideo {
  uri: string;
  /** Web only: the browser's File. */
  file?: Blob;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface VideoProbe {
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** JPEG still for the poster, when this platform can make one. */
  poster?: Uint8Array;
}

export interface UploadRequest {
  url: string;
  headers: Record<string, string>;
  bytes: Uint8Array;
  contentType: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function readPickedVideo(picked: PickedVideo): Promise<Uint8Array> {
  return new File(picked.uri).bytes();
}

/** The picker already reports duration and size on iOS and Android; no poster is made here yet. */
export async function probeVideo(picked: PickedVideo, _bytes?: Uint8Array, _contentType?: string): Promise<VideoProbe> {
  return { durationSeconds: picked.durationSeconds, width: picked.width, height: picked.height };
}

/** A local URI that can play the cleaned file in the composer preview. */
export function previewUri(picked: PickedVideo, _bytes?: Uint8Array, _contentType?: string): string {
  return picked.uri;
}

export function releasePreview(_uri: string) {}

/**
 * Uploads raw bytes with progress. The cleaned bytes are written to a cache file first, because
 * native uploads stream from a file rather than from memory.
 */
export async function uploadBytes(request: UploadRequest): Promise<{ status: number; body: string }> {
  const file = new File(Paths.cache, `open-media-upload-${Date.now()}`);
  try {
    file.create({ overwrite: true });
    file.write(request.bytes);
    const task = file.createUploadTask(request.url, {
      httpMethod: 'POST',
      headers: { ...request.headers, 'content-type': request.contentType },
      mimeType: request.contentType,
      onProgress: ({ bytesSent, totalBytes }) => request.onProgress?.(totalBytes ? bytesSent / totalBytes : 0),
    });
    const abort = () => task.cancel();
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await task.uploadAsync();
      return { status: result.status, body: result.body };
    } finally {
      request.signal?.removeEventListener('abort', abort);
    }
  } finally {
    try { file.delete(); } catch { /* already gone */ }
  }
}

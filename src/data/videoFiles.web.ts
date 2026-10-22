import type { PickedVideo, UploadRequest, VideoProbe } from './videoFiles';

export type { PickedVideo, UploadRequest, VideoProbe } from './videoFiles';

/** Web: the browser File in memory, a <video> element for duration and size, a canvas for the poster. */
export async function readPickedVideo(picked: PickedVideo): Promise<Uint8Array> {
  const blob = picked.file ?? await (await fetch(picked.uri)).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

const posterMaxWidth = 720;

/** Loads the video (from the cleaned bytes) to read its duration and size and draw a poster frame. */
export async function probeVideo(_picked: PickedVideo, bytes?: Uint8Array, contentType?: string): Promise<VideoProbe> {
  if (!bytes) return {};
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  try {
    await once(video, 'loadedmetadata', 15_000);
    const durationSeconds = Number.isFinite(video.duration) ? video.duration : await realDuration(video);
    const width = video.videoWidth || undefined;
    const height = video.videoHeight || undefined;
    let poster: Uint8Array | undefined;
    if (width && height && durationSeconds) {
      video.currentTime = Math.min(1, durationSeconds / 4);
      await once(video, 'seeked', 10_000).catch(() => undefined);
      poster = await drawPoster(video, width, height).catch(() => undefined);
    }
    return { durationSeconds, width, height, poster };
  } catch {
    return {};
  } finally {
    video.removeAttribute('src'); video.load();
    URL.revokeObjectURL(url);
  }
}

/** Browser recordings (WebM) often report an infinite duration until the end is reached. */
async function realDuration(video: HTMLVideoElement): Promise<number | undefined> {
  video.currentTime = Number.MAX_SAFE_INTEGER;
  await once(video, 'durationchange', 5_000).catch(() => undefined);
  const duration = Number.isFinite(video.duration) ? video.duration : undefined;
  video.currentTime = 0;
  return duration;
}

async function drawPoster(video: HTMLVideoElement, width: number, height: number): Promise<Uint8Array> {
  const scale = Math.min(1, posterMaxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('No poster');
  return new Uint8Array(await blob.arrayBuffer());
}

function once(target: HTMLVideoElement, event: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${event} timed out`)); }, timeoutMs);
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('This video can’t be read in this browser.')); };
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', failed); };
    target.addEventListener(event, done); target.addEventListener('error', failed);
  });
}

const previews = new Set<string>();

export function previewUri(picked: PickedVideo, bytes?: Uint8Array, contentType?: string): string {
  if (!bytes) return picked.uri;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
  previews.add(url);
  return url;
}

export function releasePreview(uri: string) {
  if (previews.delete(uri)) URL.revokeObjectURL(uri);
}

/** XMLHttpRequest, because fetch can't report upload progress. */
export function uploadBytes(request: UploadRequest): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', request.url);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader('content-type', request.contentType);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) request.onProgress?.(event.loaded / event.total); };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    request.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(new Blob([request.bytes as BlobPart], { type: request.contentType }));
  });
}

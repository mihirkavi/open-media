import assert from 'node:assert/strict';
import test from 'node:test';

import { checkVideoCandidate, contentTypeFromBytes, formatBytes, formatDuration, isPubliclyReachableUrl, isStoredPostVideo, maxVideoBytes, postVideoPublicUrl, stripVideoLocationMetadata, videoContentTypeFor } from './postVideo';

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const size = 8 + children.reduce((total, child) => total + child.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  let offset = 8;
  for (const child of children) { out.set(child, offset); offset += child.length; }
  return out;
}
const text = (value: string) => new TextEncoder().encode(value);
const types = (bytes: Uint8Array) => {
  const found: string[] = [];
  for (let index = 4; index + 4 <= bytes.length; index += 1) {
    const type = String.fromCharCode(...bytes.subarray(index, index + 4));
    if (['udta', 'meta', 'free', 'mdat', 'trak', 'moov'].includes(type)) found.push(type);
  }
  return found;
};

const iphoneLocation = '+37.7749-122.4194+010.000/';
const mp4 = box('ftyp', text('isom'), new Uint8Array(4), text('isommp42'));
const mov = box('ftyp', text('qt  '), new Uint8Array(4), text('qt  '));
const moov = box('moov',
  box('mvhd', new Uint8Array(20)),
  box('trak', box('tkhd', new Uint8Array(12)), box('udta', box('name', text('Camera')))),
  box('udta', box('©xyz', text(iphoneLocation))),
  box('meta', box('keys', text('com.apple.quicktime.location.ISO6709')), box('ilst', text(iphoneLocation))),
);
const mdat = box('mdat', text('frames'));

test('removes location and device metadata from MP4 and MOV without moving media data', () => {
  const file = new Uint8Array([...mp4, ...moov, ...mdat]);
  const { bytes, removed } = stripVideoLocationMetadata(file);
  assert.deepEqual(removed, ['moov/trak/udta', 'moov/udta', 'moov/meta']);
  assert.equal(bytes.length, file.length);
  assert.equal(types(bytes).filter((type) => type === 'udta' || type === 'meta').length, 0);
  const asText = (value: Uint8Array) => Buffer.from(value).toString('latin1');
  assert.ok(asText(file).includes(iphoneLocation));
  assert.equal(asText(bytes).includes(iphoneLocation), false, 'the coordinates are gone from the bytes, not just hidden');
  assert.equal(asText(bytes).includes('Camera'), false);
  // Offsets are unchanged, so the media payload is byte-for-byte where it was.
  assert.deepEqual(bytes.subarray(bytes.length - mdat.length), mdat);
  assert.notEqual(file, bytes, 'the original buffer is not modified');
  assert.equal(types(file).includes('udta'), true);
});

test('neutralizes top-level XMP, which can carry GPS', () => {
  const xmpId = Uint8Array.from('be7acfcb97a942e89c71999491e3afac'.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const otherId = new Uint8Array(16).fill(7);
  const file = new Uint8Array([...mp4, ...box('uuid', xmpId, text('<x:xmpmeta GPS/>')), ...box('uuid', otherId, text('keep')), ...mdat]);
  const { bytes, removed } = stripVideoLocationMetadata(file);
  assert.deepEqual(removed, ['uuid']);
  assert.equal(Buffer.from(bytes).toString('latin1').includes('GPS'), false);
  assert.ok(Buffer.from(bytes).toString('latin1').includes('keep'));
});

test('leaves WebM, unknown, and malformed files intact', () => {
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  assert.deepEqual(stripVideoLocationMetadata(webm), { bytes: webm, removed: [] });
  const truncated = new Uint8Array([...mp4, ...moov.subarray(0, 20)]);
  assert.doesNotThrow(() => stripVideoLocationMetadata(truncated));
});

test('detects the container from the bytes, not the file name', () => {
  assert.equal(contentTypeFromBytes(new Uint8Array([...mp4, ...mdat])), 'video/mp4');
  assert.equal(contentTypeFromBytes(new Uint8Array([...mov, ...mdat])), 'video/quicktime');
  assert.equal(contentTypeFromBytes(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm');
  assert.equal(contentTypeFromBytes(text('GIF89a........')), undefined);
  assert.equal(videoContentTypeFor(null, 'IMG_0001.MOV'), 'video/quicktime');
  assert.equal(videoContentTypeFor('video/webm;codecs=vp9'), 'video/webm');
  assert.equal(videoContentTypeFor('image/gif', 'clip.gif'), undefined);
});

test('checks size, length, and type limits with plain-language reasons', () => {
  assert.deepEqual(checkVideoCandidate({ sizeBytes: 5_000_000, durationSeconds: 42, mimeType: 'video/mp4' }), { ok: true });
  assert.deepEqual(checkVideoCandidate({ mimeType: 'video/mp4' }), { ok: true }, 'missing details are checked again after reading the file');
  const tooBig = checkVideoCandidate({ sizeBytes: maxVideoBytes + 1, mimeType: 'video/mp4' });
  assert.equal(tooBig.ok, false);
  assert.match((tooBig as { reason: string }).reason, /limit is 100 MB/);
  const tooLong = checkVideoCandidate({ durationSeconds: 200, mimeType: 'video/mp4' });
  assert.match((tooLong as { reason: string }).reason, /3:20.*up to 3:00/);
  assert.equal(checkVideoCandidate({ durationSeconds: 180.3, mimeType: 'video/mp4' }).ok, true);
  assert.equal(checkVideoCandidate({ mimeType: 'application/pdf' }).ok, false);
  assert.equal(checkVideoCandidate({ sizeBytes: 0, mimeType: 'video/mp4' }).ok, false);
});

test('only public HTTPS hosts count as reachable by other networks', () => {
  assert.equal(isPubliclyReachableUrl('https://abc.supabase.co/storage/v1/object/public/post-videos/a/b.mp4'), true);
  for (const local of ['http://127.0.0.1:54321/x.mp4', 'https://localhost/x.mp4', 'https://192.168.1.4/x.mp4', 'https://10.0.0.2/x', 'https://172.20.1.1/x', 'https://[::1]/x', 'https://openmedia.test/x', 'http://example.com/x.mp4', 'not a url', undefined]) {
    assert.equal(isPubliclyReachableUrl(local), false, String(local));
  }
});

test('stored videos resolve to public bucket URLs and are validated', () => {
  const author = '10000000-0000-0000-0000-000000000001';
  const post = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(postVideoPublicUrl('https://abc.supabase.co/', `${author}/${post}.mp4`), `https://abc.supabase.co/storage/v1/object/public/post-videos/${author}/${post}.mp4`);
  const stored = { path: `${author}/${post}.mp4`, posterPath: null, durationSeconds: 12, width: 720, height: 1280, contentType: 'video/mp4', sha256: 'f'.repeat(64) };
  assert.equal(isStoredPostVideo(stored), true);
  assert.equal(isStoredPostVideo({ ...stored, path: '../../secret.mp4' }), false);
  assert.equal(isStoredPostVideo({ ...stored, contentType: 'video/avi' }), false);
  assert.equal(isStoredPostVideo(null), false);
});

test('formats sizes and durations for people', () => {
  assert.equal(formatBytes(maxVideoBytes), '100 MB');
  assert.equal(formatBytes(1536), '2 KB');
  assert.equal(formatDuration(42.4), '42s');
  assert.equal(formatDuration(180), '3:00');
});

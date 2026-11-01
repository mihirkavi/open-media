import assert from 'node:assert/strict';
import test from 'node:test';

import { avatarContentType, gravatarAddress, gravatarUrl, stripImageMetadata } from './avatar';

const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];

test('JPEG metadata (EXIF with GPS, XMP, comments) is removed and the image data kept', () => {
  const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
  const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]);
  const comment = segment(0xfe, [0x68, 0x69]);
  const quant = segment(0xdb, [0, 1, 2]);
  const scan = [0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9];
  const jpeg = new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...comment, ...quant, ...scan]);
  assert.equal(avatarContentType(jpeg), 'image/jpeg');
  assert.deepEqual([...stripImageMetadata(jpeg)], [0xff, 0xd8, ...app0, ...quant, ...scan]);
});

test('PNG text and EXIF chunks are removed', () => {
  const chunk = (type: string, body: number[]) => [0, 0, 0, body.length, ...[...type].map((c) => c.charCodeAt(0)), ...body, 1, 2, 3, 4];
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = chunk('IHDR', [1, 2, 3]);
  const text = chunk('tEXt', [65, 0, 66]);
  const exif = chunk('eXIf', [7]);
  const idat = chunk('IDAT', [5, 6]);
  const iend = chunk('IEND', []);
  const png = new Uint8Array([...signature, ...ihdr, ...text, ...exif, ...idat, ...iend]);
  assert.deepEqual([...stripImageMetadata(png)], [...signature, ...ihdr, ...idat, ...iend]);
});

test('other formats and broken files are refused', () => {
  assert.throws(() => stripImageMetadata(new Uint8Array([0x47, 0x49, 0x46, 0x38])), /JPEG or PNG/);
  assert.throws(() => stripImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), /couldn’t be read/);
});

test('Gravatar uses the trimmed lower-case address and asks for a 404 when there is none', () => {
  assert.equal(gravatarAddress('  Ana@Example.ORG '), 'ana@example.org');
  assert.equal(gravatarUrl('abc', 256), 'https://gravatar.com/avatar/abc?s=256&d=404');
});

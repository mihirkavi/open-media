import assert from 'node:assert/strict';
import test from 'node:test';

import { findSenderIcon, iconCandidates, iconPixels, isIconDomain } from './senderIcons.js';

/** A PNG header of the given size (enough for iconPixels). */
function png(size: number): Uint8Array {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(16, size);
  view.setUint32(20, size);
  return bytes;
}

/** An .ico directory listing the given sizes. */
function ico(...sizes: number[]): Uint8Array {
  const bytes = new Uint8Array(6 + sizes.length * 16);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, sizes.length, true);
  sizes.forEach((size, index) => { bytes[6 + index * 16] = size % 256; bytes[7 + index * 16] = size % 256; });
  return bytes;
}

test('reads real pixel sizes, so small favicons are recognised', () => {
  assert.equal(iconPixels(png(180), 'image/png'), 180);
  assert.equal(iconPixels(ico(16, 32), 'image/x-icon'), 32);
  assert.equal(iconPixels(ico(16, 256), 'image/x-icon'), 256);
  assert.equal(iconPixels(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'), Infinity);
});

test('finds declared icons and their sizes, skipping monochrome mask icons', () => {
  const html = `<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/touch.png"><link rel="mask-icon" href="/mask.svg"><link rel="icon" type="image/svg+xml" href="https://cdn.example.com/logo.svg"><link rel="icon" href="http://insecure.example/x.png" sizes="512x512">`;
  assert.deepEqual(iconCandidates(html, 'https://www.brand.example/'), [
    { url: 'https://www.brand.example/favicon-32.png', declared: 32 },
    { url: 'https://www.brand.example/touch.png', declared: 180 },
    { url: 'https://cdn.example.com/logo.svg', declared: Infinity },
  ]);
});

test('only plain registrable domains are looked up', () => {
  assert.ok(isIconDomain('vivino.com'));
  assert.ok(isIconDomain('bbc.co.uk'));
  for (const bad of ['localhost', '127.0.0.1', 'a.b.example.com', 'evil.com/path', '-x.com']) assert.ok(!isIconDomain(bad), bad);
});

test('picks the largest real icon and refuses blurry ones', async () => {
  const site = (files: Record<string, { type: string; bytes: Uint8Array } | string>) => async (url: string) => {
    const file = files[url];
    if (file === undefined) return new Response(null, { status: 404 });
    if (typeof file === 'string') return new Response(file, { headers: { 'content-type': 'text/html' } });
    return new Response(new Uint8Array(file.bytes), { headers: { 'content-type': file.type } });
  };
  const sharp = await findSenderIcon('brand.example', site({
    'https://brand.example/': '<link rel="icon" href="/fav.ico"><link rel="icon" sizes="192x192" href="/icon-192.png">',
    'https://brand.example/fav.ico': { type: 'image/x-icon', bytes: ico(16, 32) },
    'https://brand.example/icon-192.png': { type: 'image/png', bytes: png(192) },
  }));
  assert.equal(sharp?.contentType, 'image/png');
  assert.equal(iconPixels(sharp!.bytes, sharp!.contentType), 192);

  const blurry = await findSenderIcon('tiny.example', site({
    'https://tiny.example/': '<link rel="icon" href="/fav.ico">',
    'https://tiny.example/fav.ico': { type: 'image/x-icon', bytes: ico(16, 32) },
  }));
  assert.equal(blurry, undefined, 'initials look better than a 32 px icon');
});

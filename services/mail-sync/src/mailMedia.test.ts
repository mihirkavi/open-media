import assert from 'node:assert/strict';
import test from 'node:test';

import { attachmentPath, collectAttachments, collectRemoteImages, maxAttachmentBytes } from './mailMedia.js';

test('keeps real images and drops tracking pixels', () => {
  const html = `
    <img src="https://images.brand.example/hero.jpg" width="600" height="300">
    <img src="https://t.brand.example/open?u=1" width="1" height="1">
    <img src='https://cdn.brand.example/logo.png' style="width:120px">
    <img src="http://insecure.example/x.png">
    <img src="https://cdn.brand.example/hidden.png" style="display:none">
    <img src="https://cdn.brand.example/a.png?x=1&amp;y=2">
    <img src="https://images.brand.example/hero.jpg">`;
  assert.deepEqual(collectRemoteImages(html), [
    'https://images.brand.example/hero.jpg',
    'https://cdn.brand.example/logo.png',
    'https://cdn.brand.example/a.png?x=1&y=2',
  ]);
  assert.deepEqual(collectRemoteImages(undefined), []);
});

test('collects attachments with safe names and size limits', () => {
  const small = Buffer.from('hello');
  const [file, inline, huge, unnamed] = collectAttachments([
    { filename: '../../etc/passwd: report?.pdf', contentType: 'application/PDF', content: small },
    { filename: 'photo.jpg', contentType: 'image/jpeg', content: small, contentDisposition: 'inline' },
    { filename: 'video.mov', contentType: 'video/quicktime', size: maxAttachmentBytes + 1, content: Buffer.alloc(8) },
    { contentType: 'image/png', content: small },
  ]);
  assert.equal(file.filename, '..-..-etc-passwd- report-.pdf');
  assert.equal(file.contentType, 'application/pdf');
  assert.equal(file.content?.toString(), 'hello');
  assert.equal(inline.inline, true);
  assert.equal(huge.content, undefined, 'files over the limit keep metadata only');
  assert.equal(unnamed.filename, 'attachment-4.png');
});

test('storage paths live in the person’s folder and are stable', () => {
  const path = attachmentPath('user-1', 'acct-1', '<a@x>', 2, 'photo.jpg');
  assert.match(path, /^user-1\/acct-1\/[0-9a-f]{32}\/2-photo\.jpg$/);
  assert.equal(path, attachmentPath('user-1', 'acct-1', '<a@x>', 2, 'photo.jpg'));
});

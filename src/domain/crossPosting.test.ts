import assert from 'node:assert/strict';
import test from 'node:test';

import { CrossPostVideo, defaultDestinations, destinationSummary, hivePermlink, hiveTitle, outcomeSummary, prepareCrossPost, utf8Length } from './crossPosting';

test('Every connected network is a default destination unless turned off', () => {
  assert.deepEqual(defaultDestinations(['deso', 'farcaster'], { excludedByDefault: [] }), ['farcaster', 'deso']);
  assert.deepEqual(defaultDestinations(['deso', 'farcaster'], { excludedByDefault: ['deso'] }), ['farcaster']);
  assert.deepEqual(defaultDestinations([], { excludedByDefault: [] }), []);
});

test('The composer summarizes destinations without listing every provider', () => {
  assert.equal(destinationSummary([]), 'Open Media only');
  assert.equal(destinationSummary(['hive']), 'Open Media + Hive');
  assert.equal(destinationSummary(['hive', 'lens', 'deso']), 'Open Media + 3');
});

test('Farcaster limits are counted in UTF-8 bytes and explained before publishing', () => {
  assert.equal(utf8Length('é'), 2);
  assert.ok(prepareCrossPost('a'.repeat(320), 'farcaster').ok);
  const tooLong = prepareCrossPost('é'.repeat(161), 'farcaster');
  assert.equal(tooLong.ok, false);
  assert.match(!tooLong.ok ? tooLong.reason : '', /322 of 320 bytes/);
  assert.ok(prepareCrossPost('é'.repeat(161), 'deso').ok);
});

test('Hive posts get a short title from the first line or sentence', () => {
  const prepared = prepareCrossPost('Shipping day. We moved the whole feed to one stream.\nMore soon', 'hive');
  assert.ok(prepared.ok);
  assert.equal(prepared.ok && prepared.content.title, 'Shipping day. We moved the whole feed to one stream.');
  assert.equal(hiveTitle('Hi'), 'Hi');
  const long = hiveTitle('word '.repeat(40));
  assert.ok(long.length <= 80 && long.endsWith('…'));
});

test('Hive permlinks are lowercase, dash-separated, and unique', () => {
  assert.equal(hivePermlink('Héllo, World! 2026', 'A1B2-C3'), 'hello-world-2026-a1b2c3');
  assert.equal(hivePermlink('🎉🎉', 'xyz'), 'open-media-xyz');
  assert.match(hivePermlink('x'.repeat(300), 'abc'), /^[a-z0-9-]{1,256}$/);
});

test('Outcome summaries name what was and was not posted', () => {
  assert.equal(outcomeSummary([{ network: 'deso', status: 'published' }]), 'Posted to Open Media, DeSo.');
  assert.equal(outcomeSummary([{ network: 'deso', status: 'published' }, { network: 'hive', status: 'failed' }]), 'Posted to Open Media, DeSo. Not posted to Hive.');
});

const publicVideo: CrossPostVideo = { url: 'https://abc.supabase.co/storage/v1/object/public/post-videos/a/b.mp4', posterUrl: 'https://abc.supabase.co/storage/v1/object/public/post-videos/a/b.jpg', contentType: 'video/mp4', durationSeconds: 14, width: 720, height: 1280, bytes: new Uint8Array([1, 2, 3]), altText: 'Video: sunrise' };
const localVideo: CrossPostVideo = { ...publicVideo, url: 'http://127.0.0.1:54321/storage/v1/object/public/post-videos/a/b.mp4', posterUrl: undefined };

test('Video posts may have no text', () => {
  assert.equal(prepareCrossPost('', 'lens').ok, false);
  for (const network of ['farcaster', 'lens', 'hive', 'deso'] as const) assert.ok(prepareCrossPost('', network, publicVideo).ok, network);
});

test('Farcaster embeds the public video URL; Hive gets a markdown link with the poster', () => {
  const farcaster = prepareCrossPost('Sunrise', 'farcaster', publicVideo);
  assert.ok(farcaster.ok && farcaster.content.video?.url === publicVideo.url && farcaster.note);
  const hive = prepareCrossPost('', 'hive', publicVideo);
  assert.ok(hive.ok);
  assert.equal(hive.ok && hive.content.title, 'Video');
  assert.match(hive.ok ? hive.content.text : '', /\[!\[Video: sunrise\]\(https:\/\/abc\.supabase\.co\/.+b\.jpg\)\]\(https:\/\/abc\.supabase\.co\/.+b\.mp4\)/);
  assert.match(hive.ok ? hive.note ?? '' : '', /no native video/);
});

test('Videos only on a local server are skipped where a network needs a public link', () => {
  for (const network of ['farcaster', 'hive'] as const) {
    const prepared = prepareCrossPost('Sunrise', network, localVideo);
    assert.equal(prepared.ok, false, network);
    assert.match(!prepared.ok ? prepared.reason : '', /local Open Media server/);
  }
  // Lens and DeSo upload their own copy of the file, so a local URL doesn't matter.
  assert.ok(prepareCrossPost('Sunrise', 'lens', localVideo).ok);
  assert.ok(prepareCrossPost('Sunrise', 'deso', localVideo).ok);
});

test('DeSo needs the file itself; Lens can fall back to the public URL', () => {
  const withoutBytes = { ...publicVideo, bytes: undefined };
  assert.equal(prepareCrossPost('Sunrise', 'deso', withoutBytes).ok, false);
  assert.ok(prepareCrossPost('Sunrise', 'lens', withoutBytes).ok);
  assert.equal(prepareCrossPost('Sunrise', 'lens', { ...localVideo, bytes: undefined }).ok, false);
});

test('Farcaster video posts still respect the text limit and the embed URL limit', () => {
  assert.equal(prepareCrossPost('a'.repeat(321), 'farcaster', publicVideo).ok, false);
  const longUrl = { ...publicVideo, url: `https://abc.supabase.co/${'x'.repeat(260)}.mp4` };
  assert.match((prepareCrossPost('Hi', 'farcaster', longUrl) as { reason: string }).reason, /too long for a Farcaster embed/);
});

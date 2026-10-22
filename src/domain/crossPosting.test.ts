import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultDestinations, destinationSummary, hivePermlink, hiveTitle, outcomeSummary, prepareCrossPost, utf8Length } from './crossPosting';

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

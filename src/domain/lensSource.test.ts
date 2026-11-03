import assert from 'node:assert/strict';
import test from 'node:test';

import { relevantLens, tuneLens } from './feedLenses';
import { changedLines, lensImpact, lensSource, sourceDiff } from './lensSource';
import { SocialPost } from './posts';

const now = Date.parse('2026-11-03T12:00:00Z');
const post = (id: string, source: string, hours: number): SocialPost => ({
  id, author: { id, displayName: id, handle: `@${id}`, initials: 'X' }, body: '', kind: 'text', createdAt: new Date(now - hours * 3_600_000).toISOString(),
  topics: [], provenance: { connectorId: source }, relevance: { followsAuthor: false, selectedInterestMatches: [] },
});

test('the source is the manifest the runner reads, without where-it-came-from fields', () => {
  const source = JSON.parse(lensSource(relevantLens));
  assert.equal(source.id, 'relevant');
  assert.equal(source.order, 'ranked');
  assert.equal('builtIn' in source, false);
});

test('a change in words shows as the exact lines it edits', () => {
  const tuned = tuneLens(relevantLens, 'less hive').lens;
  const changed = changedLines(sourceDiff(lensSource(relevantLens), lensSource(tuned)));
  assert.ok(changed.some((line) => line.kind === 'add' && line.text.includes('"hive"')), 'the new boost line is added');
  assert.ok(changed.some((line) => line.kind === 'remove'), 'and the old lines it replaces are removed');
  assert.ok(changed.length < lensSource(tuned).split('\n').length, 'only the changed region, not the whole file');
  assert.deepEqual(sourceDiff('a\nb', 'a\nb').map((line) => line.kind), ['same', 'same']);
});

test('the impact counts how a change moves networks in the top of the Feed', () => {
  // Hive posts are the newest, so Relevant leads with them; "much less hive" pushes them down.
  const posts = [...Array.from({ length: 6 }, (_, index) => post(`h${index}`, 'hive', index * 0.1)), ...Array.from({ length: 6 }, (_, index) => post(`f${index}`, 'farcaster', 2 + index * 0.1))];
  const tuned = tuneLens(relevantLens, 'much less hive').lens;
  const shifts = lensImpact(posts, relevantLens, tuned, { now }, 6);
  const hive = shifts.find((shift) => shift.network === 'Hive');
  assert.ok(hive && hive.after < hive.before, `Hive drops in the top 6: ${JSON.stringify(shifts)}`);
});

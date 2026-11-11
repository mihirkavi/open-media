import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Guard rails for the performance architecture (ADR 0038). Each rule names the fix in its message,
 * so an agent that trips one knows what to do instead of guessing.
 */
const uiDir = join(__dirname, '..', 'ui');
const uiFiles = readdirSync(uiDir).filter((name) => /\.tsx?$/.test(name)).map((name) => ({ name, source: readFileSync(join(uiDir, name), 'utf8') }));

test('video players are only created by screens that bound them', () => {
  // ClipsView mounts players for the active clip ±1 only; Feed videos go through usePlayback.
  const allowed = new Set(['ClipVideo.tsx', 'ClipVideo.web.tsx', 'ClipsView.tsx', 'OpenMediaFeed.tsx']);
  const offenders = uiFiles.filter(({ name, source }) => !allowed.has(name) && /<ClipVideo\b/.test(source)).map(({ name }) => name);
  assert.deepEqual(offenders, [], 'Render inline videos through usePlayback (src/ui/usePlayback.ts) so at most two players exist and one plays; then add the file here.');
  const feed = uiFiles.find(({ name }) => name === 'OpenMediaFeed.tsx')!.source;
  assert.match(feed, /usePlayback\(/, 'Feed videos must take their player from usePlayback.');
});

test('the Feed and Clips are virtualized lists', () => {
  for (const name of ['OpenMediaFeed.tsx', 'ClipsView.tsx']) {
    const source = uiFiles.find((file) => file.name === name)!.source;
    assert.match(source, /<FlatList\b/, `${name}: render the stream with FlatList, not ScrollView + map, so off-screen rows unmount.`);
    assert.doesNotMatch(source, /<ScrollView\b/, `${name}: a ScrollView here keeps every loaded post mounted for the whole session.`);
  }
});

test('styles are built once per theme, not once per component instance', () => {
  const offenders = uiFiles.filter(({ name, source }) => name !== 'useThemedStyles.ts' && /useMemo\(\(\) => createStyles\(colors\)/.test(source)).map(({ name }) => name);
  assert.deepEqual(offenders, [], 'Use useThemedStyles(createStyles) from src/ui/useThemedStyles.ts.');
});

test('rows rendered many times are memoized', () => {
  const feed = uiFiles.find(({ name }) => name === 'OpenMediaFeed.tsx')!.source;
  const clips = uiFiles.find(({ name }) => name === 'ClipsView.tsx')!.source;
  assert.match(feed, /export const PostCard = memo\(/, 'PostCard must stay React.memo: Feed, Search and profiles render hundreds.');
  assert.match(clips, /const Clip = memo\(/, 'Clip must stay React.memo so changing clips re-renders three rows, not all.');
});

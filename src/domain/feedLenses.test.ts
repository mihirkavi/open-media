import assert from 'node:assert/strict';
import test from 'node:test';

import { builtInLenses, describeLensRules, explainLensPost, forbiddenSignals, lensFromRequest, lensKeeps, LensError, looksLikeLensRequest, parseLens, rawLens, relevantLens, runLens } from './feedLenses';
import { SocialPost } from './posts';

const now = Date.parse('2026-10-27T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

function post(id: string, options: Partial<Omit<SocialPost, 'author'>> & { author?: string; hours: number; source?: string }): SocialPost {
  const author = options.author ?? id;
  return {
    id, author: { id: author, displayName: author, handle: `@${author}`, initials: 'X' }, body: options.body ?? '', kind: options.kind ?? 'text',
    createdAt: hoursAgo(options.hours), topics: options.topics ?? [], media: options.media,
    provenance: { connectorId: options.source ?? 'open-media' }, relevance: { followsAuthor: false, selectedInterestMatches: [] },
    ...(options.listing ? { listing: options.listing } : {}), ...(options.engagement ? { engagement: options.engagement } : {}),
  };
}

const ids = (posts: SocialPost[]) => posts.map((item) => item.id);

test('Raw is newest first across every age, with ties broken by id', () => {
  const posts = [post('week-old', { hours: 24 * 7 }), post('b-new', { hours: 1 }), post('month-old', { hours: 24 * 30 }), post('a-new', { hours: 1 }), post('day-old', { hours: 30 })];
  assert.deepEqual(ids(runLens(posts, rawLens, { now })), ['a-new', 'b-new', 'day-old', 'week-old', 'month-old']);
});

test('Relevant keeps posts older than two days in time order instead of leaving them unsorted', () => {
  // The old score was 0 for anything older than 48 hours, so these kept their arrival order.
  const posts = [post('five-days', { hours: 120 }), post('three-days', { hours: 72 }), post('ten-days', { hours: 240 })];
  assert.deepEqual(ids(runLens(posts, relevantLens, { now })), ['three-days', 'five-days', 'ten-days']);
});

test('Relevant lifts people you follow and your topics, only with those signals', () => {
  const posts = [post('stranger', { hours: 1 }), post('friend', { hours: 6, author: 'friend' }), post('topic', { hours: 6, body: 'New #design system notes' })];
  const context = { now, followedAuthorIds: new Set(['friend']), interests: ['design'] };
  const ordered = ids(runLens(posts, relevantLens, context));
  assert.equal(ordered[0], 'friend');
  assert.ok(ordered.indexOf('topic') < ordered.indexOf('stranger'));
  // Without follows or interests Relevant is recency-led.
  assert.equal(ids(runLens(posts, relevantLens, { now }))[0], 'stranger');
  // Raw never reads them even when given.
  assert.deepEqual(ids(runLens(posts, rawLens, context)), ['stranger', 'friend', 'topic']);
});

test('Relevant spreads one prolific author out without hiding them', () => {
  const posts = [post('m1', { hours: 1, author: 'many' }), post('m2', { hours: 1.1, author: 'many' }), post('m3', { hours: 1.2, author: 'many' }), post('other', { hours: 3, author: 'other' })];
  const ordered = ids(runLens(posts, relevantLens, { now }));
  assert.equal(ordered.length, 4);
  assert.ok(ordered.indexOf('other') < ordered.indexOf('m3'));
});

test('Explanations list what was used, the rules, and what is never used', () => {
  const item = post('friend', { hours: 2, author: 'friend', body: 'about design' });
  const explanation = explainLensPost(item, relevantLens, { now, followedAuthorIds: new Set(['friend']), interests: ['design'] });
  assert.ok(explanation.used.includes('You follow this author'));
  assert.ok(explanation.used.includes('Matches your design interest'));
  assert.ok(explanation.used.includes('Posted 2 hours ago'));
  assert.ok(explanation.used.includes('Selected by Relevant'));
  for (const signal of forbiddenSignals) assert.ok(explanation.notUsed.includes(signal));
  const raw = explainLensPost(item, rawLens, { now, followedAuthorIds: new Set(['friend']) });
  assert.ok(!raw.used.includes('You follow this author'));
  assert.ok(raw.notUsed.includes('Who you follow'));
  assert.deepEqual(raw.rules, ['Newest first']);
});

test('Manifests are validated: unknown fields, forbidden signals and missing permissions are refused', () => {
  assert.throws(() => parseLens({ name: 'Spy', filters: { privateMessages: true } }), LensError);
  assert.throws(() => parseLens({ name: 'Spy', permissions: ['private_messages'] }), LensError);
  assert.throws(() => parseLens({ name: 'Spy', exactLocation: true }), LensError);
  assert.throws(() => parseLens({ name: 'Friends', filters: { followedOnly: true } }), /permissions must include "follows"/);
  assert.throws(() => parseLens({ name: 'Hot', objectives: { engagement: 0.5 } }), /public_engagement/);
  assert.throws(() => parseLens({ name: 'Bad', objectives: { recency: 3 } }), LensError);
  assert.throws(() => parseLens({ name: '' }), LensError);
  const lens = parseLens({ name: 'Calm videos', filters: { kinds: ['video'], mute: ['Crypto'] }, order: 'newest' });
  assert.equal(lens.id, 'calm-videos');
  assert.deepEqual(lens.filters.mute, ['crypto']);
  // Built-ins survive a round trip through JSON.
  for (const builtIn of builtInLenses) assert.deepEqual(parseLens(JSON.parse(JSON.stringify(builtIn))), builtIn);
});

test('A manifest that claims to be built in cannot change the built-in or take its id', () => {
  assert.equal(parseLens({ ...rawLens, builtIn: true, filters: { kinds: ['video'] } }), rawLens);
  assert.throws(() => parseLens({ ...rawLens, builtIn: false, filters: { kinds: ['video'] } }), /built-in/);
  const copy = parseLens({ ...relevantLens, builtIn: false, id: 'my-relevant', objectives: { ...relevantLens.objectives, follows: 0.6 } });
  assert.equal(copy.builtIn, undefined);
  assert.equal(parseLens({ name: 'Raw' }).id, 'raw-lens');
});

test('Filters keep and drop posts by kind, network, words, authors and age', () => {
  const lens = parseLens({ name: 'Test', filters: { kinds: ['video'], hideSources: ['hive'], mute: ['crypto'], muteAuthors: ['@loud'], maxAgeHours: 24 }, order: 'newest' });
  const video = { media: [{ kind: 'video' as const, aspectRatio: 1, altText: '' }], kind: 'video' as const };
  assert.equal(lensKeeps(post('ok', { hours: 2, ...video }), lens, { now }).kept, true);
  assert.match(lensKeeps(post('text', { hours: 2 }), lens, { now }).reason!, /Not videos/);
  assert.match(lensKeeps(post('hive', { hours: 2, source: 'hive', ...video }), lens, { now }).reason!, /Hides Hive/);
  assert.match(lensKeeps(post('coin', { hours: 2, body: 'Buy Crypto now', ...video }), lens, { now }).reason!, /Mutes crypto/);
  assert.equal(lensKeeps(post('crypto-adjacent', { hours: 2, body: 'cryptography lecture', ...video }), lens, { now }).kept, true);
  assert.match(lensKeeps(post('loud', { hours: 2, author: 'loud', ...video }), lens, { now }).reason!, /Mutes @loud/);
  assert.match(lensKeeps(post('old', { hours: 30, ...video }), lens, { now }).reason!, /Older than 24 hours/);
});

test('Plain words become a lens, with what was understood shown back', () => {
  const draft = lensFromRequest('Only videos about cooking from people I follow, no crypto, nothing from Hive');
  assert.deepEqual(draft.lens.filters.kinds, ['video']);
  assert.deepEqual(draft.lens.filters.about, ['cooking']);
  assert.equal(draft.lens.filters.followedOnly, true);
  assert.deepEqual(draft.lens.filters.mute, ['crypto']);
  assert.deepEqual(draft.lens.filters.hideSources, ['hive']);
  assert.ok(draft.lens.permissions.includes('follows'));
  assert.ok(draft.understood.includes('Only videos'));
  assert.ok(draft.understood.includes('Only people you follow'));
  assert.equal(draft.lens.name, 'Following Cooking Videos');
});

test('Plain words cover ordering, naming, time and lifting topics', () => {
  const newest = lensFromRequest('chronological feed from farcaster and lens today called Open Web');
  assert.equal(newest.lens.order, 'newest');
  assert.equal(newest.lens.name, 'Open Web');
  assert.deepEqual(newest.lens.filters.sources, ['farcaster', 'lens']);
  assert.equal(newest.lens.filters.maxAgeHours, 24);
  const lifted = lensFromRequest("I'm into ai and design, more from people I follow, no listings");
  assert.deepEqual(lifted.lens.interests, ['ai', 'design']);
  assert.equal(lifted.lens.filters.followedOnly, undefined);
  assert.ok(lifted.lens.objectives.follows > 0);
  assert.deepEqual(lifted.lens.filters.hideKinds, ['product', 'service']);
  const vague = lensFromRequest('a calm feed');
  assert.deepEqual(vague.unused, ['calm']);
  assert.equal(vague.lens.order, 'ranked');
});

test('Rules read as plain sentences', () => {
  assert.deepEqual(describeLensRules(relevantLens), ['Ranked by newness 50%, who you follow 30%, your topics 20%', 'Spreads authors and networks out']);
  assert.deepEqual(describeLensRules(lensFromRequest('only videos, mute @spam').lens).slice(0, 2), ['Only videos', 'Mutes @spam']);
});

test('Search tells feed requests from ordinary searches', () => {
  for (const value of ['only videos', 'hide crypto', 'make me a feed about cooking', 'posts from people I follow', 'newest first please']) assert.equal(looksLikeLensRequest(value), true, value);
  for (const value of ['videos about cooking today', 'ethereum on lens', 'dark mode', 'connect farcaster']) assert.equal(looksLikeLensRequest(value), false, value);
});

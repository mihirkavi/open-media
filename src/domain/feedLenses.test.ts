import assert from 'node:assert/strict';
import test from 'node:test';

import { authorVolumes, boostLimits, keepOrder, builtInLenses, describeLensRules, describeScore, explainLensPost, forbiddenSignals, lensFormat, lensFormatV2, lensFromRequest, lensKeeps, LensError, lensScoreParts, looksLikeLensRequest, looksLikeTuneRequest, parseLens, rawLens, relevantLens, runLens, tuneLens } from './feedLenses';
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

// ---------- Your own algorithm (ADR 0021) ----------

test('Boosts lean a ranked lens toward or away from a network, kind, topic or person without hiding anything', () => {
  const posts = [post('hive-new', { hours: 1, source: 'hive' }), post('farcaster-older', { hours: 4, source: 'farcaster' }), post('video-oldest', { hours: 8, kind: 'video' })];
  const flat = parseLens({ name: 'Flat', order: 'ranked', objectives: { recency: 1 } });
  assert.deepEqual(ids(runLens(posts, flat, { now })), ['hive-new', 'farcaster-older', 'video-oldest']);
  const leaning = parseLens({ name: 'Leaning', order: 'ranked', objectives: { recency: 1 }, boosts: [{ source: 'hive', weight: -1 }, { kind: 'video', weight: 1 }] });
  const ordered = ids(runLens(posts, leaning, { now }));
  assert.equal(ordered.length, 3, 'boosts never hide a post');
  // The 8-hour-old video (×1.5) passes the 4-hour-old post; the newest falls behind both (×0.5).
  assert.deepEqual(ordered, ['video-oldest', 'farcaster-older', 'hive-new']);
  // Topic and author boosts read only the post.
  const topical = parseLens({ name: 'Topical', boosts: [{ topic: '#Design', weight: 0.5 }, { author: '@Bot', weight: -0.5 }] });
  assert.deepEqual(topical.boosts, [{ weight: 0.5, topic: 'design' }, { weight: -0.5, author: 'bot' }]);
  assert.deepEqual(topical.permissions, []);
});

test('All of a post’s boosts together are capped, so no rule can bury a post or let it take over', () => {
  const item = post('everything', { hours: 0, source: 'hive', kind: 'video', body: 'design and art', author: 'maker' });
  const up = parseLens({ name: 'Up', boosts: [{ source: 'hive', weight: 1 }, { kind: 'video', weight: 1 }, { topic: 'design', weight: 1 }, { author: 'maker', weight: 1 }] });
  const down = parseLens({ name: 'Down', boosts: [{ source: 'hive', weight: -1 }, { kind: 'video', weight: -1 }, { topic: 'design', weight: -1 }] });
  assert.equal(lensScoreParts(item, up, { now }).factor, boostLimits.max);
  assert.equal(lensScoreParts(item, down, { now }).factor, boostLimits.min);
  assert.match(describeScore(item, up, { now }).join('\n'), /capped at ×2/);
});

test('Boosts are validated: one target each, weights from -1 to 1, known networks and kinds, no extra fields', () => {
  assert.throws(() => parseLens({ name: 'X', boosts: [{ weight: 0.5 }] }), LensError);
  assert.throws(() => parseLens({ name: 'X', boosts: [{ source: 'hive', kind: 'video', weight: 0.5 }] }), LensError);
  assert.throws(() => parseLens({ name: 'X', boosts: [{ source: 'hive', weight: 2 }] }), LensError);
  assert.throws(() => parseLens({ name: 'X', boosts: [{ source: 'hive', weight: 0 }] }), LensError);
  assert.throws(() => parseLens({ name: 'X', boosts: [{ source: 'myspace', weight: 0.5 }] }), LensError);
  assert.throws(() => parseLens({ name: 'X', boosts: [{ topic: 'ai', weight: 0.5, privateMessages: true }] }), /Unknown boost field/);
  assert.throws(() => parseLens({ name: 'X', boosts: Array.from({ length: 25 }, (_, index) => ({ topic: `t${index}`, weight: 0.5 })) }), LensError);
  // A later boost for the same thing replaces the earlier one.
  assert.deepEqual(parseLens({ name: 'X', boosts: [{ source: 'hive', weight: 0.5 }, { source: 'hive', weight: -0.5 }] }).boosts, [{ weight: -0.5, source: 'hive' }]);
});

test('Format 2 is written only when a lens uses boosts or discovery, so older app builds keep reading the rest', () => {
  assert.equal(parseLens({ name: 'Plain', objectives: { recency: 1 } }).format, lensFormat);
  assert.equal('discovery' in parseLens({ name: 'Plain', objectives: { recency: 1, discovery: 0 } }).objectives, false);
  assert.equal(parseLens({ name: 'Leaning', boosts: [{ kind: 'video', weight: 0.5 }] }).format, lensFormatV2);
  assert.equal(parseLens({ format: lensFormatV2, name: 'New', permissions: ['follows'], objectives: { recency: 0.5, discovery: 0.5 } }).format, lensFormatV2);
  assert.throws(() => parseLens({ format: 'open-media.feed-lens/3', name: 'Future' }), LensError);
});

test('Discovery lifts people you don’t follow yet, and needs the follows permission', () => {
  assert.throws(() => parseLens({ name: 'New voices', objectives: { discovery: 0.5 } }), /permissions must include "follows"/);
  const lens = parseLens({ name: 'New voices', permissions: ['follows'], objectives: { recency: 0.5, discovery: 0.5 } });
  const posts = [post('friend', { hours: 1, author: 'friend' }), post('stranger', { hours: 2, author: 'stranger' })];
  assert.equal(ids(runLens(posts, lens, { now, followedAuthorIds: new Set(['friend']) }))[0], 'stranger');
  assert.deepEqual(describeLensRules(lens).slice(0, 1), ['Ranked by newness 50%, new voices 50%']);
});

test('Tuning a built-in lens makes the person’s own copy and never changes the built-in', () => {
  const before = JSON.stringify(relevantLens);
  const tuned = tuneLens(relevantLens, 'less hive, a lot more videos');
  assert.equal(JSON.stringify(relevantLens), before);
  assert.equal(tuned.lens.id, 'my-relevant');
  assert.equal(tuned.lens.name, 'My Relevant');
  assert.equal(tuned.lens.forkedFrom, 'relevant');
  assert.equal(tuned.lens.builtIn, undefined);
  assert.deepEqual(tuned.lens.permissions, relevantLens.permissions);
  assert.deepEqual(tuned.lens.objectives, relevantLens.objectives);
  assert.deepEqual(tuned.lens.boosts, [{ weight: -0.5, source: 'hive' }, { weight: 1, kind: 'video' }]);
  assert.deepEqual(tuned.understood, ['Less Hive', 'Much more videos']);
  assert.deepEqual(tuned.changes, ['Now: Less Hive', 'Now: Much more videos']);
  // Tuning the copy again changes the copy and adds up on the same thing.
  const again = tuneLens(tuned.lens, 'a bit more hive');
  assert.equal(again.lens.id, 'my-relevant');
  assert.equal(again.lens.version, tuned.lens.version + 1);
  assert.deepEqual(again.lens.boosts, [{ weight: 1, kind: 'video' }, { weight: -0.25, source: 'hive' }]);
  assert.deepEqual(again.changes, ['Now: Slightly less Hive', 'No longer: Less Hive']);
});

test('Tuning words change objectives, filters and order, and say what they skipped', () => {
  const follows = tuneLens(relevantLens, 'more from people I follow');
  assert.equal(follows.lens.objectives.follows, 0.5);
  const voices = tuneLens(relevantLens, 'a lot more new voices');
  assert.equal(voices.lens.objectives.discovery, 0.4);
  const popular = tuneLens(relevantLens, 'more popular');
  assert.ok(popular.lens.permissions.includes('public_engagement'));
  assert.equal(popular.lens.objectives.engagement, 0.2);
  const quiet = tuneLens(relevantLens, 'no crypto, only videos');
  assert.deepEqual(quiet.lens.filters, { mute: ['crypto'], kinds: ['video'] });
  assert.equal(tuneLens(relevantLens, 'chronological').lens.order, 'newest');
  assert.deepEqual(tuneLens(relevantLens, 'more zxq').lens.boosts, [{ weight: 0.5, topic: 'zxq' }]);
  assert.deepEqual(tuneLens(relevantLens, 'tune it').understood, []);
});

test('Showing something again removes whatever hid or lowered it', () => {
  let lens = tuneLens(relevantLens, 'no hive, mute crypto, less events').lens;
  assert.deepEqual(lens.filters, { hideSources: ['hive'], mute: ['crypto'] });
  lens = tuneLens(lens, 'show hive again, unmute crypto, bring back events').lens;
  assert.deepEqual(lens.filters, {});
  assert.equal(lens.boosts, undefined);
  // Asking for more of something hidden shows it again and lifts it.
  const hidden = tuneLens(relevantLens, 'no videos').lens;
  const more = tuneLens(hidden, 'more videos').lens;
  assert.deepEqual(more.filters, {});
  assert.deepEqual(more.boosts, [{ weight: 0.5, kind: 'video' }]);
});

test('Leaning a newest-first lens ranks it by newness so the change can apply', () => {
  const tuned = tuneLens(rawLens, 'more videos');
  assert.equal(tuned.lens.id, 'my-raw');
  assert.equal(tuned.lens.order, 'ranked');
  assert.deepEqual(tuned.lens.objectives, { recency: 1, follows: 0, interests: 0, engagement: 0, diversity: 0 });
  assert.ok(tuned.understood.includes('Ranked by newness so your changes apply'));
  // Raw itself stays newest first.
  assert.equal(rawLens.order, 'newest');
});

test('“Why this?” shows the post’s score under the person’s own weights, and changes when they tune', () => {
  const item = post('clip', { hours: 0, source: 'hive', kind: 'video', media: [{ kind: 'video', aspectRatio: 1, altText: '' }] });
  const plain = explainLensPost(item, relevantLens, { now });
  assert.deepEqual(plain.scoring.slice(0, 2), ['Score 32 of 100', 'Fit 10 of 100 (who you follow 0 of 60, your topics 0 of 40) × Newness 100 of 100']);
  const tuned = tuneLens(tuneLens(relevantLens, 'less hive').lens, 'more videos').lens;
  const explained = explainLensPost(item, tuned, { now });
  assert.deepEqual(explained.scoring.slice(0, 3), ['Score 30 of 100', 'Fit 10 of 100 (who you follow 0 of 60, your topics 0 of 40) × Newness 100 of 100', 'Less Hive ×0.75 · More videos ×1.25']);
  assert.equal(explained.tuneHint, 'My Relevant has only newness and the network mix to go on: you follow no one yet and chose no topics. Follow people, or type “more about design” (any topic), and it will lift those posts. To change My Relevant, type “less hive” or “more videos” in Settings → Feed or in Search.');
  // Once there is something to go on, only the tuning words are shown.
  assert.equal(explainLensPost(item, tuned, { now, interests: ['design'] }).tuneHint, 'To change My Relevant, type “less hive” or “more videos” in Settings → Feed or in Search.');
  assert.deepEqual(explainLensPost(item, rawLens, { now }).scoring, ['Raw is newest first: posts have no score']);
});

test('Search tells changes to the lens in use from new lenses and ordinary searches', () => {
  for (const value of ['less hive', 'more videos', 'a lot more about design', 'fewer events', 'show hive again', 'unmute crypto', 'mute crypto and more farcaster']) assert.equal(looksLikeTuneRequest(value), true, value);
  for (const value of ['ethereum on lens', 'only videos from people I follow', 'more', 'cooking videos']) assert.equal(looksLikeTuneRequest(value), false, value);
});

test('Relevant spreads networks out, so one busy network can’t fill the top of the Feed like it does in Raw', () => {
  // Hive posts every few minutes; the other networks less often. Raw shows Hive first, all of it.
  const hive = Array.from({ length: 8 }, (_, index) => post(`hive-${index}`, { hours: index * 0.1, source: 'hive' }));
  const others = [post('farcaster-1', { hours: 1, source: 'farcaster' }), post('lens-1', { hours: 1.5, source: 'lens' }), post('deso-1', { hours: 2, source: 'deso' })];
  const posts = [...hive, ...others];
  assert.deepEqual(ids(runLens(posts, rawLens, { now })).slice(0, 8).map((id) => id.split('-')[0]), Array(8).fill('hive'));
  const relevant = runLens(posts, relevantLens, { now });
  const top = relevant.slice(0, 6).map((item) => item.provenance.connectorId);
  assert.equal(new Set(top).size, 4, `every network shows in the first six: ${top.join(', ')}`);
  // Never three in a row from one network while another network still has posts nearby.
  for (let index = 2; index < 6; index += 1) assert.ok(!(top[index] === top[index - 1] && top[index] === top[index - 2]), top.join(', '));
  // Nobody is hidden: every post is still there.
  assert.equal(relevant.length, posts.length);
});

// ---------- ADR 0030: relevance × newness, busy authors, a still Feed ----------

function feedItem(id: string, hours: number, site: string): SocialPost {
  return { ...post(id, { hours, author: `rss:${site}`, source: 'rss' }), relevance: { followsAuthor: true, selectedInterestMatches: [] } };
}

test('A followed newsroom posting all day can’t bury a friend, a small blog or your topics', () => {
  // What the owner saw: every New York Times headline counted as “someone you follow” and was new,
  // so the top of Relevant was nothing but the Times.
  const times = Array.from({ length: 40 }, (_, index) => feedItem(`nyt-${index}`, index * 0.4, 'nytimes.com'));
  const blog = feedItem('blog', 9, 'simonwillison.net');
  const friend = post('friend-post', { hours: 10, author: 'friend' });
  const topic = post('topic-post', { hours: 5, body: 'Notes on #design systems', source: 'farcaster' });
  const strangers = Array.from({ length: 6 }, (_, index) => post(`stranger-${index}`, { hours: index * 0.2, source: index % 2 ? 'hive' : 'lens' }));
  const posts = [...times, blog, friend, topic, ...strangers];
  const context = { now, followedAuthorIds: new Set(['friend']), interests: ['design'] };
  const top = ids(runLens(posts, relevantLens, context)).slice(0, 6);
  for (const id of ['friend-post', 'blog', 'topic-post']) assert.ok(top.includes(id), `${id} in the first six: ${top.join(', ')}`);
  assert.ok(top.filter((id) => id.startsWith('nyt')).length <= 2, top.join(', '));
  // The Times is still there, lower down, and nothing is hidden.
  assert.equal(runLens(posts, relevantLens, context).length, posts.length);
  // “Why this?” says why a headline counts less.
  const why = explainLensPost(times[0], relevantLens, { ...context, authorVolumes: authorVolumes(posts, now) }).scoring.join('\n');
  assert.match(why, /posted \d+ times in the last day, so each post counts \d+% of a follow/);
});

test('A brand-new post about nothing you chose no longer outranks a friend’s post from this morning', () => {
  const posts = [post('stranger', { hours: 0 }), post('friend-post', { hours: 8, author: 'friend' })];
  assert.equal(ids(runLens(posts, relevantLens, { now, followedAuthorIds: new Set(['friend']) }))[0], 'friend-post');
  // But relevance alone can’t hold the top for days: a three-day-old follow falls below fresh posts.
  const old = [post('stranger', { hours: 0 }), post('friend-post', { hours: 72, author: 'friend' })];
  assert.equal(ids(runLens(old, relevantLens, { now, followedAuthorIds: new Set(['friend']) }))[0], 'stranger');
});

test('Relevant never shows the same author twice in a row while anyone else is available', () => {
  const posts = [...Array.from({ length: 6 }, (_, index) => post(`many-${index}`, { hours: index * 0.1, author: 'many' })), post('a', { hours: 20 }), post('b', { hours: 30 })];
  const authors = runLens(posts, relevantLens, { now, followedAuthorIds: new Set(['many']) }).map((item) => item.author.id);
  for (let index = 1; index < 5; index += 1) assert.ok(authors[index] !== authors[index - 1], authors.join(', '));
});

test('The order is the same for the same posts and moment, whatever order they arrive in', () => {
  const posts = [...Array.from({ length: 12 }, (_, index) => post(`p${index}`, { hours: index * 0.7, source: ['hive', 'lens', 'farcaster'][index % 3], author: `a${index % 4}` }))];
  const context = { now, followedAuthorIds: new Set(['a1']) };
  assert.deepEqual(ids(runLens([...posts].reverse(), relevantLens, context)), ids(runLens(posts, relevantLens, context)));
});

test('Posts on screen keep their places when slower networks or the next page arrive', () => {
  const first = runLens([post('x', { hours: 1 }), post('y', { hours: 2 })], relevantLens, { now });
  const later = runLens([post('x', { hours: 1 }), post('y', { hours: 2 }), post('fresh', { hours: 0, author: 'friend' })], relevantLens, { now, followedAuthorIds: new Set(['friend']) });
  assert.equal(later[0].id, 'fresh');
  assert.deepEqual(ids(keepOrder(ids(first), later)), [...ids(first), 'fresh']);
  // A post that went away is dropped, the rest keep their order.
  assert.deepEqual(ids(keepOrder(['gone', ...ids(first)], later)), [...ids(first), 'fresh']);
  assert.deepEqual(ids(keepOrder([], later)), ids(later));
});

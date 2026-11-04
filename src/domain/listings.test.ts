import assert from 'node:assert/strict';
import test from 'node:test';

import { eventFeedTime, eventMetaLine, eventRegistration, eventWhen, formatPrice, listingLine, parsePrice, PublicEvent, socialPostFromEvent, validateListing } from './listings';
import { parseLens, rawLens, runLens } from './feedLenses';
import { SocialPost } from './posts';
import { parseSearchQuery, postMatchesSearch } from './searchQuery';

test('prices are whole minor units; an empty price means "ask"', () => {
  assert.equal(parsePrice('25', 'USD'), 2500);
  assert.equal(parsePrice('$1,200.50', 'USD'), 120050);
  assert.equal(parsePrice('1200', 'JPY'), 1200);
  assert.equal(parsePrice('', 'USD'), null);
  assert.equal(parsePrice('12.345', 'USD'), 'invalid');
  assert.equal(parsePrice('free', 'USD'), 'invalid');
  assert.equal(parsePrice('2000000', 'USD'), 'invalid');
  assert.equal(formatPrice(null, 'USD'), 'Ask for price');
  assert.equal(formatPrice(0, 'USD'), 'Free');
});

test('listings are checked before they are sent', () => {
  assert.deepEqual(validateListing({ kind: 'product', title: '  ' }), { error: 'Give the listing a title.' });
  assert.ok('error' in validateListing({ kind: 'service', title: 'Tutoring', price: 'abc' }));
  const ok = validateListing({ kind: 'service', title: ' Math tutoring ', price: '40', currency: 'usd', remote: true });
  assert.ok('listing' in ok);
  if ('listing' in ok) {
    assert.deepEqual(ok.listing, { kind: 'service', title: 'Math tutoring', priceMinor: 4000, currency: 'USD', location: undefined, remote: true, availability: 'available' });
    assert.match(listingLine(ok.listing), /Remote/);
  }
});

const event: PublicEvent = {
  id: 'e1', title: 'AI founders breakfast', startsAt: '2026-11-01T16:30:00.000Z', dateOnly: false, timezone: 'America/Los_Angeles', place: 'Mox, San Francisco',
  online: false, free: true, organizer: 'SF Builders', availability: 'open', registrationUrl: 'https://lu.ma/abc',
  sources: [{ provider: 'luma', url: 'https://lu.ma/abc' }, { provider: 'meetup', url: 'https://www.meetup.com/x/events/1' }], area: 'San Francisco Bay Area', updatedAt: '2026-10-25T00:00:00.000Z',
};

test('an event becomes a Feed post that keeps its sources and says why it is there', () => {
  const post = socialPostFromEvent(event);
  assert.equal(post.provenance.connectorId, 'events');
  assert.equal(post.event?.registrationUrl, 'https://lu.ma/abc');
  assert.equal(post.title, 'AI founders breakfast', 'the title reads like a post title');
  assert.equal(post.media, undefined, 'no cover, no image');
  const covered = socialPostFromEvent({ ...event, imageUrl: 'https://images.lumacdn.com/cover.png', description: '  Coffee and demos.  ' });
  assert.equal(covered.body, 'Coffee and demos.', 'the description is the body');
  assert.equal(covered.media?.[0]?.url, 'https://images.lumacdn.com/cover.png');
  assert.equal(socialPostFromEvent({ ...event, imageUrl: 'http://insecure.example/cover.png' }).media, undefined, 'only HTTPS covers load');
  assert.match(post.eligibility!.selection, /San Francisco Bay Area, from Luma, Meetup/);
  // Daylight saving time ends that morning in California, so 16:30 UTC is 8:30 AM local time.
  assert.equal(eventWhen(post.event!, 'en-US'), 'Sun, Nov 1 · 8:30 AM');
  assert.equal(eventWhen({ startsAt: '2026-11-01', dateOnly: true }, 'en-US'), 'Sun, Nov 1');
});

test('an event reads as one meta line, and its one action says what the official page offers', () => {
  assert.equal(eventMetaLine(event, 'en-US'), 'Sun, Nov 1 · 8:30 AM · Mox, San Francisco · Free');
  assert.equal(eventMetaLine({ ...event, online: true, free: undefined, priceText: '$20', availability: 'sold_out' }, 'en-US'), 'Sun, Nov 1 · 8:30 AM · Online · $20 · Sold out');
  assert.deepEqual(eventRegistration(event), { url: 'https://lu.ma/abc', label: 'Register on Luma', short: 'Register' });
  assert.deepEqual(eventRegistration({ ...event, availability: 'waitlist' }), { url: 'https://lu.ma/abc', label: 'Join waitlist on Luma', short: 'Waitlist' });
  assert.deepEqual(eventRegistration({ ...event, availability: 'sold_out' }), { url: 'https://lu.ma/abc', label: 'See on Luma', short: 'Sold out' });
});

test('events are ranked by the person’s own lens like every other post', () => {
  const now = Date.parse('2026-10-26T00:00:00.000Z');
  const text = (id: string, createdAt: string) => ({ id, author: { id: `a-${id}`, displayName: id, handle: `@${id}`, initials: 'A' }, body: 'Hello', kind: 'text', createdAt, topics: [], provenance: { connectorId: 'farcaster' }, relevance: { followsAuthor: false, selectedInterestMatches: [] } }) as SocialPost;
  // e1 starts 2026-11-01T16:30Z, 6.7 days after `now`, so it ranks like a post from about 40 hours ago.
  const soon = { ...event, id: 'e2', startsAt: '2026-10-27T00:00:00.000Z' };
  const posts = [text('older', '2026-10-24T00:00:00.000Z'), text('newer', '2026-10-25T21:00:00.000Z'), socialPostFromEvent(event, now), socialPostFromEvent(soon, now)];
  assert.equal(eventFeedTime(soon, now), '2026-10-25T18:00:00.000Z', 'a day away counts as six hours old');
  assert.deepEqual(runLens(posts, rawLens, { now }).map((post) => post.id), ['newer', 'event:e2', 'event:e1', 'older'], 'Raw places events by how soon they start');
  const noEvents = parseLens({ name: 'No events', filters: { hideSources: ['events'] }, order: 'newest' });
  assert.equal(runLens(posts, noEvents, { now }).some((post) => post.event), false, 'a lens can leave events out');
  const moreEvents = parseLens({ format: 'open-media.feed-lens/2', name: 'More events', order: 'ranked', objectives: { recency: 1 }, boosts: [{ source: 'events', weight: 1 }] });
  assert.equal(runLens(posts, moreEvents, { now })[0].id, 'event:e2', 'a lens can lean toward events');
});

test('search understands products, services and events', () => {
  const events = parseSearchQuery('ai events this weekend');
  assert.equal(events.structured, 'event');
  assert.deepEqual(events.keywords, ['ai']);
  assert.ok(events.understood.includes('Upcoming'));
  assert.equal(events.sinceMs, undefined, 'events are upcoming, not a past window');
  assert.equal(parseSearchQuery('desk for sale').structured, 'product');
  assert.equal(parseSearchQuery('hire a designer').structured, 'service');
  const listing = { id: 'l', author: { displayName: 'Sam', handle: '@sam' }, body: 'Walnut desk', topics: ['products'], provenance: { connectorId: 'open-media' }, createdAt: '2026-10-25T00:00:00Z', listing: { kind: 'product', title: 'Walnut desk', priceMinor: 100, currency: 'USD', remote: false, availability: 'available' } } as unknown as SocialPost;
  assert.ok(postMatchesSearch(listing, parseSearchQuery('desk for sale')));
  assert.ok(!postMatchesSearch(listing, parseSearchQuery('desk services')));
  assert.ok(postMatchesSearch(socialPostFromEvent(event), parseSearchQuery('breakfast events')));
});

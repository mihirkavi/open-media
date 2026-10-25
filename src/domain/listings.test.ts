import assert from 'node:assert/strict';
import test from 'node:test';

import { eventWhen, interleaveEvents, formatPrice, listingLine, parsePrice, PublicEvent, socialPostFromEvent, validateListing } from './listings';
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
  assert.match(post.eligibility!.selection, /San Francisco Bay Area, from Luma, Meetup/);
  // Daylight saving time ends that morning in California, so 16:30 UTC is 8:30 AM local time.
  assert.equal(eventWhen(post.event!, 'en-US'), 'Sun, Nov 1 · 8:30 AM');
  assert.equal(eventWhen({ startsAt: '2026-11-01', dateOnly: true }, 'en-US'), 'Sun, Nov 1');
});

test('events sit among posts without pushing any out', () => {
  const posts = Array.from({ length: 13 }, (_, index) => ({ id: `p${index}` }) as SocialPost);
  const events = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] as SocialPost[];
  const mixed = interleaveEvents(posts, events, 6).map((post) => post.id);
  assert.deepEqual(mixed.filter((id) => id.startsWith('p')), posts.map((post) => post.id));
  assert.equal(mixed.indexOf('e1'), 6);
  assert.equal(mixed.indexOf('e2'), 13);
  assert.equal(mixed.includes('e3'), false);
  assert.deepEqual(interleaveEvents([], events).map((post) => post.id), ['e1']);
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

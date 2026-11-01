import assert from 'node:assert/strict';
import test from 'node:test';

import type { CanonicalEvent, DiscoveredEvent } from './events/types.js';
import { publicEvent, withEventDetails } from './publicEvents';

function event(id: string, provider: string, extra: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    id, title: `Event ${id}`, startsAt: '2026-11-01T02:00:00.000Z', dateOnly: false, status: 'scheduled', attendanceMode: 'in_person', categories: [],
    imageUrl: 'https://images.lumacdn.com/cover.png', registration: { availability: 'open', url: `https://lu.ma/${id}` },
    sources: [{ provider, providerEventId: `evt-${id}`, url: `https://lu.ma/${id}`, retrievedAt: '2026-10-31T00:00:00.000Z' }], updatedAt: '2026-10-31T00:00:00.000Z', ...extra,
  };
}

test('Luma events get their description from the single-event lookup; others are left alone', async () => {
  const asked: string[] = [];
  const source = { readEventPage: async () => [], lumaEvent: async (id: string) => { asked.push(id); return { description: id === 'evt-b' ? '' : `About ${id}` } as DiscoveredEvent; } };
  const [a, b, c, d] = await withEventDetails([event('a', 'luma'), event('b', 'luma'), event('c', 'meetup'), event('d', 'luma', { description: 'Already here' })], source);
  assert.equal(a.description, 'About evt-a');
  assert.equal(b.description, undefined, 'an empty description stays absent');
  assert.equal(c.description, undefined);
  assert.equal(d.description, 'Already here');
  assert.deepEqual(asked, ['evt-a', 'evt-b'], 'only Luma events without a description are looked up');
});

test('Meetup events get the picture and description from their own page', async () => {
  const meetup = (id: string, extra: Partial<CanonicalEvent> = {}) => event(id, 'meetup', {
    imageUrl: '/images/fallbacks/redesign/group-cover-2-square.webp',
    sources: [{ provider: 'meetup', providerEventId: `group/${id}`, url: `https://www.meetup.com/group/events/${id}/`, retrievedAt: '2026-10-31T00:00:00.000Z' }], ...extra,
  });
  const read: string[] = [];
  const source = {
    lumaEvent: async () => { throw new Error('not Luma'); },
    readEventPage: async (url: string) => { read.push(url); return [{ url, description: 'Morning tennis for all levels. This is a', imageUrl: 'https://secure-content.meetupstatic.com/images/classic-events/1/676x676.jpg' } as DiscoveredEvent]; },
  };
  const [a, b] = await withEventDetails([meetup('1'), meetup('2', { description: 'Kept', imageUrl: 'https://secure.meetupstatic.com/photos/event/2.jpeg' })], source);
  assert.equal(a.description, 'Morning tennis for all levels. This is…', 'a cut-off description ends on a whole word');
  assert.equal(a.imageUrl, 'https://secure-content.meetupstatic.com/images/classic-events/1/676x676.jpg', 'the generic cover is replaced by the event photo');
  assert.equal(b.description, 'Kept');
  assert.deepEqual(read, ['https://www.meetup.com/group/events/1/'], 'events that already have both are not fetched');
});

test('a failing lookup never drops the event', async () => {
  const [a] = await withEventDetails([event('a', 'luma')], { readEventPage: async () => [], lumaEvent: async () => { throw new Error('rate limited'); } });
  assert.equal(a.title, 'Event a');
  assert.equal(a.description, undefined);
});

test('the public event carries the cover image and a bounded description', () => {
  const shown = publicEvent(event('a', 'luma', { description: 'word '.repeat(200) }), 'San Francisco Bay Area');
  assert.equal(shown?.imageUrl, 'https://images.lumacdn.com/cover.png');
  assert.ok(shown!.description!.length <= 500);
  assert.match(shown!.description!, /word…$/, 'long descriptions end at a whole word');
});

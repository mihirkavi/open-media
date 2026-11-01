import assert from 'node:assert/strict';
import test from 'node:test';

import type { CanonicalEvent, DiscoveredEvent } from './events/types.js';
import { publicEvent, withLumaDescriptions } from './publicEvents';

function event(id: string, provider: string, extra: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    id, title: `Event ${id}`, startsAt: '2026-11-01T02:00:00.000Z', dateOnly: false, status: 'scheduled', attendanceMode: 'in_person', categories: [],
    imageUrl: 'https://images.lumacdn.com/cover.png', registration: { availability: 'open', url: `https://lu.ma/${id}` },
    sources: [{ provider, providerEventId: `evt-${id}`, url: `https://lu.ma/${id}`, retrievedAt: '2026-10-31T00:00:00.000Z' }], updatedAt: '2026-10-31T00:00:00.000Z', ...extra,
  };
}

test('Luma events get their description from the single-event lookup; others are left alone', async () => {
  const asked: string[] = [];
  const source = { lumaEvent: async (id: string) => { asked.push(id); return { description: id === 'evt-b' ? '' : `About ${id}` } as DiscoveredEvent; } };
  const [a, b, c, d] = await withLumaDescriptions([event('a', 'luma'), event('b', 'luma'), event('c', 'meetup'), event('d', 'luma', { description: 'Already here' })], source);
  assert.equal(a.description, 'About evt-a');
  assert.equal(b.description, undefined, 'an empty description stays absent');
  assert.equal(c.description, undefined);
  assert.equal(d.description, 'Already here');
  assert.deepEqual(asked, ['evt-a', 'evt-b'], 'only Luma events without a description are looked up');
});

test('a failing lookup never drops the event', async () => {
  const [a] = await withLumaDescriptions([event('a', 'luma')], { lumaEvent: async () => { throw new Error('rate limited'); } });
  assert.equal(a.title, 'Event a');
  assert.equal(a.description, undefined);
});

test('the public event carries the cover image and a bounded description', () => {
  const shown = publicEvent(event('a', 'luma', { description: 'word '.repeat(200) }), 'San Francisco Bay Area');
  assert.equal(shown?.imageUrl, 'https://images.lumacdn.com/cover.png');
  assert.ok(shown!.description!.length <= 500);
  assert.match(shown!.description!, /word…$/, 'long descriptions end at a whole word');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveArea } from './areas.js';
import { CalendarCapability, estimateTravelMinutes, planWindow } from './calendar.js';
import { clusterListings, mergeCluster, sameOccurrence, titleSimilarity } from './dedupe.js';
import { voiceSummary } from './engine.js';
import { assertTransition, calendarStatusFor, canTransition, describeRegistration, planStateForRegistration } from './lifecycle.js';
import { daypartOf, rankEvent, selectWithExploration, type RankingContext } from './ranking.js';
import { DEFAULT_PREFERENCES } from './store.js';
import { formatLocal, resolvePeriod } from './time.js';
import { grantedScopes, TOOLS } from './tools.js';
import type { CanonicalEvent, DiscoveredEvent } from './types.js';

const TZ = 'America/Los_Angeles';

function listing(overrides: Partial<DiscoveredEvent>): DiscoveredEvent {
  return {
    provider: 'luma',
    providerEventId: 'evt-1',
    url: 'https://lu.ma/one',
    title: 'AI Founders Dinner',
    startsAt: '2026-10-17T02:00:00.000Z',
    endsAt: '2026-10-17T04:00:00.000Z',
    status: 'scheduled',
    attendanceMode: 'in_person',
    venue: { city: 'Palo Alto', latitude: 37.44, longitude: -122.16 },
    retrievedAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  };
}

function canonical(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return { ...mergeCluster('evt_00000000000000000001', [listing({})]), ...overrides };
}

function context(overrides: Partial<RankingContext> = {}): RankingContext {
  return {
    now: new Date('2026-10-13T12:00:00Z'),
    windowStart: new Date('2026-10-13T12:00:00Z'),
    windowEnd: new Date('2026-10-20T07:00:00Z'),
    timezone: TZ,
    center: { latitude: 37.35, longitude: -121.96 },
    radiusKm: 28,
    interests: ['entrepreneurship'],
    exclude: [],
    dayparts: ['evening'],
    inPersonOnly: true,
    preferences: { ...DEFAULT_PREFERENCES },
    learned: [],
    ...overrides,
  };
}

test('deduplicates the same occurrence listed on two platforms', () => {
  const luma = listing({});
  const eventbrite = listing({ provider: 'eventbrite', providerEventId: '123456789', url: 'https://www.eventbrite.com/e/x-123456789', title: 'AI Founders Dinner — Palo Alto', startsAt: '2026-10-17T02:05:00.000Z' });
  assert.equal(sameOccurrence(luma, eventbrite, TZ).match, true);
  const clusters = clusterListings([luma, eventbrite], TZ);
  assert.equal(clusters.length, 1);
  const merged = mergeCluster('evt_x', clusters[0]!);
  assert.equal(merged.sources.length, 2);
});

test('keeps recurring occurrences and different events separate', () => {
  const week1 = listing({ title: 'Weekly volleyball', providerEventId: 'a', url: 'https://x/a' });
  const week2 = listing({ title: 'Weekly volleyball', providerEventId: 'b', url: 'https://x/b', startsAt: '2026-10-24T02:00:00.000Z', endsAt: undefined });
  const other = listing({ title: 'Robotics hardware demo night', providerEventId: 'c', url: 'https://x/c' });
  assert.equal(clusterListings([week1, week2, other], TZ).length, 3);
  assert.ok(titleSimilarity('Weekly volleyball', 'Robotics hardware demo night') < 0.2);
});

test('merges a date-only listing with a timed one on the same local day', () => {
  const timed = listing({});
  const dateOnly = listing({ provider: 'eventbrite', providerEventId: '999', url: 'https://eb/999', startsAt: '2026-10-16', dateOnly: true, endsAt: undefined });
  const [cluster] = clusterListings([timed, dateOnly], TZ);
  assert.equal(cluster?.length, 2);
  const merged = mergeCluster('evt_y', cluster!);
  assert.equal(merged.dateOnly, false);
  assert.equal(merged.startsAt, timed.startsAt);
});

test('does not merge same-titled events in different cities', () => {
  const a = listing({ venue: { city: 'San Francisco', latitude: 37.77, longitude: -122.42 } });
  const b = listing({ provider: 'meetup', providerEventId: 'm', url: 'https://m', venue: { city: 'San Jose', latitude: 37.33, longitude: -121.89 } });
  assert.equal(sameOccurrence(a, b, TZ).match, false);
});

test('ranking applies hard constraints', () => {
  assert.equal(rankEvent(canonical({ status: 'cancelled' }), context()).excluded, 'cancelled');
  assert.equal(rankEvent(canonical({ attendanceMode: 'online' }), context()).excluded, 'online only');
  assert.match(rankEvent(canonical({ title: 'Founders networking mixer' }), context({ exclude: ['networking mixer'] })).excluded ?? '', /excluded/);
  assert.equal(rankEvent(canonical({ registration: { availability: 'closed', url: 'x' } }), context()).excluded, 'registration closed');
  assert.equal(rankEvent(canonical({ startsAt: '2026-11-01T02:00:00.000Z', endsAt: undefined }), context()).excluded, 'outside the requested dates');
  assert.match(rankEvent(canonical({ price: { isFree: false, minCents: 9000 } }), context({ maxPriceUsd: 40 })).excluded ?? '', /costs more/);
  // Unknown prices fail strict price filters instead of passing as free.
  assert.equal(rankEvent(canonical({ price: undefined }), context({ freeOnly: true })).excluded, 'price not listed');
  assert.equal(rankEvent(canonical({ price: undefined }), context({ maxPriceUsd: 20 })).excluded, 'price not listed');
  assert.equal(rankEvent(canonical({ price: { isFree: true } }), context({ freeOnly: true, maxPriceUsd: 0 })).excluded, undefined);
});

test('ranking explains interest, format and schedule fit', () => {
  const dinner = rankEvent(canonical(), context());
  assert.ok(dinner.reasons.some((reason) => reason.includes('Entrepreneurship')));
  assert.ok(dinner.reasons.some((reason) => reason.includes('evening')));
  assert.ok(dinner.formats.includes('dinner'));
  const conference = rankEvent(canonical({ title: 'Startup Expo Conference' }), context());
  assert.ok(dinner.breakdown.conversation > conference.breakdown.conversation);
  assert.ok(dinner.score > conference.score);
  assert.ok(dinner.relevance.professional_networking > 0.5);
});

test('calendar conflicts zero the schedule score', () => {
  const busy = [{ start: '2026-10-17T01:30:00.000Z', end: '2026-10-17T03:00:00.000Z' }];
  const ranked = rankEvent(canonical(), context({ busy }));
  assert.equal(ranked.breakdown.schedule, 0);
  assert.ok(ranked.cautions.some((caution) => caution.includes('calendar')));
});

test('far-away events are excluded and avoided formats are penalized', () => {
  const far = rankEvent(canonical({ venue: { city: 'Sacramento', latitude: 38.58, longitude: -121.49 } }), context());
  assert.match(far.excluded ?? '', /km away/);
  const mixer = canonical({ title: 'Founder mixer' });
  const plain = rankEvent(mixer, context());
  const avoided = rankEvent(mixer, context({ preferences: { ...DEFAULT_PREFERENCES, formatsAvoided: ['mixer'] } }));
  assert.ok(avoided.score < plain.score);
});

test('exploration keeps slots for events outside stated interests', () => {
  const aligned = Array.from({ length: 6 }, (_, index) => rankEvent(canonical({ id: `evt_a${index}`, title: `Founder dinner ${index}` }), context()));
  const novel = rankEvent(canonical({ id: 'evt_novel', title: 'Pottery wheel class' }), context());
  const picked = selectWithExploration([...aligned, novel], 5, 0.2);
  assert.equal(picked.length, 5);
  assert.ok(picked.some((item) => item.event.id === 'evt_novel'));
});

test('plan lifecycle keeps holds, registrations and attendance separate', () => {
  assert.equal(canTransition(undefined, 'held'), true);
  assert.equal(canTransition('held', 'registered'), true);
  assert.equal(canTransition('attended', 'held'), false);
  assert.throws(() => assertTransition('cancelled', 'registered'), /cannot move/);
  assert.equal(calendarStatusFor('held'), 'TENTATIVE');
  assert.equal(calendarStatusFor('registered'), 'CONFIRMED');
  assert.equal(calendarStatusFor('interested'), undefined);
  assert.equal(planStateForRegistration('handoff_started'), 'registration_pending');
  assert.match(describeRegistration('registered', 'user_reported'), /not verified with the provider/);
});

test('named periods resolve in the person’s timezone', () => {
  // Tuesday Oct 13 2026, 9 AM Pacific.
  const now = new Date('2026-10-13T16:00:00Z');
  const weekend = resolvePeriod('this_weekend', now, TZ);
  assert.equal(weekend.start.toISOString(), '2026-10-17T00:00:00.000Z'); // Fri 5 PM PDT
  assert.equal(weekend.end.toISOString(), '2026-10-19T07:00:00.000Z'); // Mon 00:00 PDT
  const tonight = resolvePeriod('tonight', now, TZ);
  assert.equal(tonight.start.toISOString(), '2026-10-14T00:00:00.000Z');
  const today = resolvePeriod('today', now, TZ);
  assert.equal(today.start.toISOString(), now.toISOString());
  assert.equal(daypartOf(new Date('2026-10-17T02:00:00Z'), TZ), 'evening');
  assert.equal(formatLocal('2026-10-17T02:00:00.000Z', TZ), 'Fri, Oct 16, 7:00 PM');
});

test('areas resolve by city, region and alias', () => {
  assert.equal(resolveArea('South Bay')?.key, 'south_bay');
  assert.equal(resolveArea('palo alto, ca')?.name, 'Palo Alto');
  assert.equal(resolveArea('SF')?.key, 'san_francisco');
  assert.equal(resolveArea('Atlantis'), undefined);
});

test('travel estimates are labeled heuristics and holds include buffers', () => {
  assert.equal(estimateTravelMinutes(undefined, 'driving'), undefined);
  assert.equal(estimateTravelMinutes(20, 'driving'), 51);
  const event = canonical();
  const block = planWindow({ travelBeforeMinutes: 30, travelAfterMinutes: 30 }, event)!;
  assert.equal(block.start.toISOString(), '2026-10-17T01:30:00.000Z');
  assert.equal(block.end.toISOString(), '2026-10-17T04:30:00.000Z');
  assert.equal(planWindow({ travelBeforeMinutes: 0, travelAfterMinutes: 0 }, canonical({ dateOnly: true })), undefined);
});

test('plan calendar feed is signed and shows holds as tentative', async () => {
  const calendar = new CalendarCapability({ feedSigningKey: 'k'.repeat(32), publicOrigin: 'https://example.test' });
  const url = await calendar.feedUrl('owner', 3);
  const signature = /\/3\/([0-9a-f]{40})\.ics$/.exec(url!)?.[1];
  assert.ok(signature);
  assert.equal(await calendar.verifyFeed('owner', 3, signature!), true);
  assert.equal(await calendar.verifyFeed('owner', 4, signature!), false);
  const now = new Date().toISOString();
  const ics = calendar.buildFeed([
    { event: canonical(), plan: { id: 'plan_1', userId: 'owner', eventId: 'evt_00000000000000000001', state: 'held', travelBeforeMinutes: 20, travelAfterMinutes: 20, calendarSequence: 1, createdAt: now, updatedAt: now } },
    { event: canonical({ id: 'evt_2' }), plan: { id: 'plan_2', userId: 'owner', eventId: 'evt_2', state: 'interested', travelBeforeMinutes: 0, travelAfterMinutes: 0, calendarSequence: 1, createdAt: now, updatedAt: now } },
  ]);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /SUMMARY:Hold: AI Founders Dinner/);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
});

test('availability without Cal.com is reported, not invented', async () => {
  const calendar = new CalendarCapability({ publicOrigin: 'https://example.test' });
  const availability = await calendar.availability(new Date(), new Date(Date.now() + 3_600_000), TZ);
  assert.equal(availability.connected, false);
  assert.deepEqual(availability.busy, []);
  assert.match(availability.note ?? '', /not connected/);
});

test('tool contract: unique names, scopes, JSON-schema-able inputs, write tools are not read-only', async () => {
  const { z } = await import('zod');
  const names = new Set(TOOLS.map((tool) => tool.name));
  assert.equal(names.size, TOOLS.length);
  for (const tool of TOOLS) {
    assert.ok(['events:read', 'events:write'].includes(tool.scope), tool.name);
    assert.equal(z.toJSONSchema(tool.input).type, 'object', tool.name);
    if (tool.scope === 'events:write') assert.equal(tool.annotations.readOnlyHint, false, tool.name);
  }
  for (const required of ['search_events', 'get_event', 'compare_events', 'get_event_options', 'get_my_events', 'save_event', 'check_schedule', 'plan_event', 'register_event', 'get_registration_status', 'cancel_registration', 'update_event_preferences', 'submit_event_feedback', 'list_event_sources']) {
    assert.ok(names.has(required), required);
  }
  assert.equal(TOOLS.find((tool) => tool.name === 'rotate_calendar_feed')?.scope, 'events:write', 'rotating the feed is a write');
  assert.equal(TOOLS.find((tool) => tool.name === 'get_calendar_feed')?.annotations.readOnlyHint, true);
  const plan = TOOLS.find((tool) => tool.name === 'plan_event')!;
  assert.equal(plan.input.safeParse({ event_id: 'evt_00000000000000000001', state: 'registered' }).success, false, 'registration states cannot be set by plan_event');
});

test('OAuth scopes are limited to supported ones', () => {
  assert.deepEqual(grantedScopes(['events:read', 'admin']), ['events:read']);
  assert.deepEqual(grantedScopes(undefined), ['events:read', 'events:write']);
});

test('voice summary stays short', () => {
  const summary = voiceSummary(Array.from({ length: 6 }, (_, index) => ({ title: `Event ${index}`, when: 'Fri', where: 'Palo Alto', why: ['Because'] })));
  assert.match(summary, /^I found 6 good options\. 1\. Event 0/);
  assert.match(summary, /Plus 3 more\.$/);
});

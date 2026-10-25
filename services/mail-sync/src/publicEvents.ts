/**
 * Upcoming public events for the Feed and for agents (ADR 0013, phase 3). Reuses the events
 * engine's providers and de-duplication, but never its personal data: no preferences, plans,
 * calendar or history are read, so anyone may call it. Results are cached by the providers' own
 * cache (D1 in production, memory elsewhere).
 */
import { AREAS, resolveArea } from './events/areas.js';
import { canonicalIdFor, clusterListings, mergeCluster } from './events/dedupe.js';
import { ProviderRouter } from './events/providers.js';
import type { EventStore } from './events/store.js';
import { interestsInText } from './events/taxonomy.js';
import type { CanonicalEvent } from './events/types.js';
import { EventAvailability, PublicEvent } from '../../../src/domain/listings';

export interface PublicEventsEnv { EVENTS_DB?: D1Database }

const timeZone = 'America/Los_Angeles';
const memory = new Map<string, { expires: number; value: unknown }>();

/** The two cache methods the provider router needs, without a database. */
const memoryStore = {
  async cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>, fresh = false): Promise<T> {
    const hit = memory.get(key);
    if (!fresh && hit && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    memory.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
    if (memory.size > 500) memory.delete(memory.keys().next().value!);
    return value;
  },
  async recordProviderHealth() {},
} as unknown as EventStore;

export class EventsUnavailable extends Error {}

function sortKey(event: CanonicalEvent): number {
  return event.dateOnly ? Date.parse(`${event.startsAt.slice(0, 10)}T23:59:00-07:00`) : Date.parse(event.startsAt);
}

export function publicEvent(event: CanonicalEvent, area: string): PublicEvent | undefined {
  const registration = event.registration?.url ?? event.sources[0]?.url;
  if (!registration?.startsWith('https://')) return undefined;
  const venue = event.venue;
  // Some listings put whole instructions in the venue name; keep the card to one readable line.
  const short = (value?: string) => value && value.length > 48 ? `${value.slice(0, 47).trimEnd()}…` : value;
  const place = [short(venue?.name), venue?.city].filter((part, index, all) => part && all.indexOf(part) === index).join(', ') || undefined;
  const price = event.price;
  const priceText = price?.isFree ? undefined : price?.text ?? (price?.minCents !== undefined ? `From ${new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency ?? 'USD' }).format(price.minCents / 100)}` : undefined);
  return {
    id: event.id,
    title: event.title,
    description: event.description?.slice(0, 500),
    imageUrl: event.imageUrl?.startsWith('https://') ? event.imageUrl : undefined,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    dateOnly: event.dateOnly,
    timezone: event.timezone ?? timeZone,
    place,
    online: event.attendanceMode === 'online',
    free: price?.isFree === true ? true : undefined,
    priceText,
    organizer: event.organizer?.name,
    availability: (event.registration?.availability ?? 'unknown') as EventAvailability,
    registrationUrl: registration,
    sources: event.sources.map((source) => ({ provider: source.provider, url: source.url })),
    area,
    updatedAt: event.updatedAt,
  };
}

export async function upcomingEvents(env: PublicEventsEnv, options: { area?: string; days?: number; query?: string; limit?: number } = {}, now = new Date()) {
  const area = options.area ? resolveArea(options.area) : AREAS.bay_area;
  if (!area) throw new EventsUnavailable(`Events are available for the San Francisco Bay Area for now (south bay, peninsula, san francisco, east bay, bay area).`);
  const days = Math.min(14, Math.max(1, Math.round(options.days ?? 7)));
  const store = env.EVENTS_DB ? new (await import('./events/store.js')).EventStore(env.EVENTS_DB) : memoryStore;
  const router = new ProviderRouter(store);
  const discovery = await router.discover({
    area, windowStart: now, windowEnd: new Date(now.getTime() + days * 86_400_000),
    interests: interestsInText(options.query ?? ''), userSources: [],
  });
  const ordered = [...discovery.listings].sort((a, b) => Number(Boolean(a.dateOnly)) - Number(Boolean(b.dateOnly)));
  const clusters = clusterListings(ordered, timeZone);
  const events = await Promise.all(clusters.map(async (cluster) => mergeCluster(await canonicalIdFor(cluster[0]!), cluster)));
  // Recognised interests already steered the providers; other words must appear in the event.
  const words = (options.query ?? '').toLowerCase().split(/\W+/).filter((word) => word.length >= 3);
  const steered = interestsInText(options.query ?? '').length > 0;
  const matches = (event: CanonicalEvent) => steered || !words.length || words.some((word) => `${event.title} ${event.description ?? ''} ${event.categories.join(' ')}`.toLowerCase().includes(word));
  const upcoming = events
    .filter((event) => event.status !== 'cancelled')
    .filter((event) => (event.dateOnly ? Date.parse(`${event.startsAt.slice(0, 10)}T23:59:59Z`) : Date.parse(event.startsAt)) >= now.getTime())
    .filter(matches)
    // Events with only a date sort after that day's timed events.
    .sort((left, right) => sortKey(left) - sortKey(right))
    .map((event) => publicEvent(event, area.name))
    .filter((event): event is PublicEvent => Boolean(event))
    .slice(0, Math.min(50, Math.max(1, options.limit ?? 20)));
  return {
    area: area.name,
    data: upcoming,
    providers: discovery.statuses.filter((status) => status.provider !== 'feeds').map((status) => ({ provider: status.provider, status: status.status })),
    note: 'Public listings only. Register on the official page; Open Media never registers anyone.',
  };
}

import { LumaDiscoveryClient } from 'luma-discovery';
import { providerForUrl, sources, StructuredFeedClient } from 'structured-event-feeds';

import { PLACES, type Area } from './areas.js';
import type { EventStore } from './store.js';
import type { Interest } from './taxonomy.js';
import type { DiscoveredEvent } from './types.js';

export type CapabilitySupport = 'supported' | 'handoff' | 'unsupported' | 'not_configured';

export interface ProviderCapability {
  provider: string;
  name: string;
  role: 'discovery' | 'calendar';
  access: string;
  extension?: string;
  capabilities: {
    discover: CapabilitySupport;
    get_event: CapabilitySupport;
    get_my_events: CapabilitySupport;
    register: CapabilitySupport;
    cancel_registration: CapabilitySupport;
    open_registration_url: CapabilitySupport;
  };
  notes: string;
}

/**
 * Verified capability registry (2026-10-13). It lists only what this
 * integration actually does. A missing capability is reported, never simulated.
 */
export const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    provider: 'luma',
    name: 'Luma',
    role: 'discovery',
    access: 'Public discovery data from api.lu.ma (undocumented, read-only, no account)',
    extension: 'https://github.com/mihirkavi/luma-discovery',
    capabilities: { discover: 'supported', get_event: 'supported', get_my_events: 'unsupported', register: 'handoff', cancel_registration: 'handoff', open_registration_url: 'supported' },
    notes: "Luma's documented API is organizer-only (Luma Plus, calendar-scoped). Attendee RSVP has no permitted API, so registration is a link handoff.",
  },
  {
    provider: 'meetup',
    name: 'Meetup',
    role: 'discovery',
    access: "schema.org Event data on Meetup's public, sitemap-listed find pages; group ICS feeds you add",
    extension: 'https://github.com/mihirkavi/structured-event-feeds',
    capabilities: { discover: 'supported', get_event: 'supported', get_my_events: 'unsupported', register: 'handoff', cancel_registration: 'handoff', open_registration_url: 'supported' },
    notes: "Meetup's GraphQL API needs a Meetup Pro subscription and OAuth approval for RSVP. robots.txt disallows search query parameters, so only topic pages are read.",
  },
  {
    provider: 'eventbrite',
    name: 'Eventbrite',
    role: 'discovery',
    access: 'schema.org Event data on public /d/ browse pages and event pages',
    extension: 'https://github.com/mihirkavi/structured-event-feeds',
    capabilities: { discover: 'supported', get_event: 'supported', get_my_events: 'unsupported', register: 'handoff', cancel_registration: 'handoff', open_registration_url: 'supported' },
    notes: "Eventbrite's public event-search API was discontinued; ticket orders require Eventbrite checkout. Browse pages give dates only; the event page supplies the time.",
  },
  {
    provider: 'feeds',
    name: 'Organization feeds',
    role: 'discovery',
    access: 'Any public ICS/webcal feed or page with schema.org events that you add (universities, IEEE/ACM chapters, cities, venues, Meetup groups, Luma calendars)',
    extension: 'https://github.com/mihirkavi/structured-event-feeds',
    capabilities: { discover: 'supported', get_event: 'supported', get_my_events: 'unsupported', register: 'handoff', cancel_registration: 'handoff', open_registration_url: 'supported' },
    notes: 'robots.txt is respected. Sources without structured data are reported, not guessed.',
  },
  {
    provider: 'calcom',
    name: 'Cal.com (connected to iCloud)',
    role: 'calendar',
    access: 'Cal.com API v2 busy times across connected calendars (needs CALCOM_API_KEY)',
    extension: 'https://github.com/mihirkavi/calcom-availability',
    capabilities: { discover: 'unsupported', get_event: 'unsupported', get_my_events: 'unsupported', register: 'unsupported', cancel_registration: 'unsupported', open_registration_url: 'unsupported' },
    notes: 'Read-only availability. Cal.com cannot create arbitrary events on iCloud, so holds go to the Open Media plan calendar you subscribe to.',
  },
  {
    provider: 'ticketmaster',
    name: 'Ticketmaster',
    role: 'discovery',
    access: 'Not configured (Discovery API key required)',
    capabilities: { discover: 'not_configured', get_event: 'not_configured', get_my_events: 'unsupported', register: 'handoff', cancel_registration: 'handoff', open_registration_url: 'not_configured' },
    notes: 'Planned P1 adapter for concerts, sports and performances.',
  },
];

export interface ProviderRunStatus {
  provider: string;
  status: 'ok' | 'failed' | 'skipped';
  events: number;
  requests: number;
  detail?: string;
}

export interface DiscoveryRequest {
  area: Area;
  windowStart: Date;
  windowEnd: Date;
  interests: Interest[];
  providers?: string[];
  userSources: Array<{ id: string; url: string; label: string }>;
}

const PROVIDER_TIMEOUT_MS = 12_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; OpenMediaEvents/0.1; +https://github.com/mihirkavi/open-media)';

export class ProviderRouter {
  private readonly luma = new LumaDiscoveryClient({ userAgent: USER_AGENT, timeoutMs: 9_000 });
  private readonly feeds = new StructuredFeedClient({ userAgent: USER_AGENT, timeoutMs: 9_000 });

  constructor(private readonly store: EventStore) {}

  /** Queries providers in parallel. One failing provider never fails the search. */
  async discover(request: DiscoveryRequest): Promise<{ listings: DiscoveredEvent[]; statuses: ProviderRunStatus[]; sourceStatuses: Array<{ id: string; status: string }> }> {
    const wanted = new Set(request.providers?.length ? request.providers : ['luma', 'meetup', 'eventbrite', 'feeds']);
    const tasks: Array<Promise<ProviderRunStatus & { listings: DiscoveredEvent[] }>> = [];
    const sourceStatuses: Array<{ id: string; status: string }> = [];

    if (wanted.has('luma')) tasks.push(this.run('luma', () => this.lumaListings(request)));
    if (wanted.has('meetup')) tasks.push(this.run('meetup', () => this.pageListings(meetupUrls(request), request, 'meetup')));
    if (wanted.has('eventbrite')) tasks.push(this.run('eventbrite', () => this.pageListings(eventbriteUrls(request), request, 'eventbrite')));
    if (wanted.has('feeds') && request.userSources.length) {
      tasks.push(this.run('feeds', async () => {
        const result = await this.pageListings(request.userSources.slice(0, 8).map((source) => source.url), request, undefined, (url, status) => {
          const source = request.userSources.find((item) => item.url === url);
          if (source) sourceStatuses.push({ id: source.id, status });
        });
        return result;
      }));
    }

    const results = await Promise.all(tasks);
    const statuses = results.map(({ listings: _listings, ...status }) => status);
    for (const provider of ['luma', 'meetup', 'eventbrite', 'feeds']) {
      if (!statuses.some((status) => status.provider === provider)) {
        statuses.push({ provider, status: 'skipped', events: 0, requests: 0, detail: provider === 'feeds' ? 'No personal sources added yet' : 'Not requested' });
      }
    }
    return { listings: results.flatMap((result) => result.listings), statuses, sourceStatuses };
  }

  /** Reads one event page or feed URL (used to fetch exact times and details). */
  async readEventPage(url: string, fresh = false): Promise<DiscoveredEvent[]> {
    return this.store.cached(`detail:${url}`, 6 * 3600, async () => (await this.feeds.read(url)).events.slice(0, 5), fresh);
  }

  async lumaEvent(id: string, fresh = false): Promise<DiscoveredEvent> {
    return this.store.cached(`luma-event:${id}`, 3 * 3600, () => this.luma.getEvent(id), fresh);
  }

  async readFeed(url: string, windowStart: Date, windowEnd: Date) {
    return this.feeds.read(url, { windowStart, windowEnd });
  }

  private async run(provider: string, load: () => Promise<{ listings: DiscoveredEvent[]; requests: number; detail?: string }>) {
    try {
      const result = await withTimeout(load(), PROVIDER_TIMEOUT_MS, `${provider} timed out`);
      await this.store.recordProviderHealth(provider);
      return { provider, status: 'ok' as const, events: result.listings.length, requests: result.requests, detail: result.detail, listings: result.listings };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed';
      await this.store.recordProviderHealth(provider, detail);
      return { provider, status: 'failed' as const, events: 0, requests: 0, detail, listings: [] };
    }
  }

  private async lumaListings(request: DiscoveryRequest) {
    const day = (date: Date) => date.toISOString().slice(0, 13);
    const key = `luma:${request.area.latitude.toFixed(2)},${request.area.longitude.toFixed(2)}:${day(request.windowStart)}:${day(request.windowEnd)}`;
    const result = await this.store.cached(key, 20 * 60, () => this.luma.searchNearby({
      latitude: request.area.latitude,
      longitude: request.area.longitude,
      startsAfter: request.windowStart,
      startsBefore: request.windowEnd,
      limit: 300,
      maxPages: 6,
    }));
    return { listings: result.events, requests: result.pagesFetched, detail: result.truncated ? 'More Luma events exist beyond the page budget' : undefined };
  }

  private async pageListings(urls: string[], request: DiscoveryRequest, provider?: string, onSource?: (url: string, status: string) => void) {
    const settled = await Promise.allSettled(urls.map(async (url) => {
      const events = await this.store.cached(`page:${url}`, 30 * 60, async () => slim((await this.feeds.read(url, {
        provider,
        windowStart: new Date(Date.now() - 86_400_000),
        windowEnd: new Date(Date.now() + 120 * 86_400_000),
      })).events));
      onSource?.(url, `ok: ${events.length} events`);
      return events;
    }));
    const listings: DiscoveredEvent[] = [];
    const failures: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') listings.push(...result.value);
      else {
        const message = result.reason instanceof Error ? result.reason.message : 'failed';
        failures.push(message);
        onSource?.(urls[index]!, `error: ${message}`);
      }
    });
    if (failures.length === urls.length && urls.length) throw new Error(failures[0]);
    const start = request.windowStart.getTime();
    const end = request.windowEnd.getTime();
    const inWindow = listings.filter((event) => {
      const time = Date.parse(event.startsAt);
      return event.dateOnly ? time >= start - 86_400_000 && time < end + 86_400_000 : time >= start && time < end;
    });
    return { listings: inWindow, requests: urls.length, detail: failures.length ? `${failures.length} of ${urls.length} pages failed` : undefined };
  }
}

function meetupUrls(request: DiscoveryRequest): string[] {
  const places = request.area.places.map((key) => PLACES[key]).filter((place) => place !== undefined).slice(0, 2);
  const topics = [...new Set(request.interests.flatMap((interest) => interest.meetupTopics))].slice(0, 3);
  const urls: string[] = [];
  const [primary, secondary] = places;
  if (primary) {
    urls.push(sources.meetupFind({ place: primary.meetup }));
    for (const topic of topics) urls.push(sources.meetupFind({ place: primary.meetup, topic }));
  }
  if (secondary) urls.push(sources.meetupFind({ place: secondary.meetup, topic: topics[0] }));
  return [...new Set(urls)].slice(0, 5);
}

function eventbriteUrls(request: DiscoveryRequest): string[] {
  const place = PLACES[request.area.places[0] ?? 'san_jose'];
  if (!place) return [];
  const topics = [...new Set(request.interests.map((interest) => interest.eventbriteTopic).filter((topic): topic is string => Boolean(topic)))].slice(0, 2);
  const range = { start: request.windowStart, end: request.windowEnd };
  return [
    sources.eventbriteSearch({ place: place.eventbrite, topic: 'events', ...range }),
    ...topics.map((topic) => sources.eventbriteSearch({ place: place.eventbrite, topic, ...range })),
  ];
}

/** Keeps cached pages small: the nearest 400 events with trimmed descriptions. */
function slim(events: DiscoveredEvent[]): DiscoveredEvent[] {
  return [...events]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 400)
    .map((event) => (event.description && event.description.length > 700 ? { ...event, description: `${event.description.slice(0, 700)}…` } : event));
}

export function providerLabel(url: string): string {
  try {
    return providerForUrl(url);
  } catch {
    return 'web';
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

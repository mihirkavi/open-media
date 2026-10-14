import { buildCalendar, CalComAvailabilityClient, CalComError, findConflicts, type BusyInterval, type CalendarEntry } from 'calcom-availability';

import { calendarStatusFor } from './lifecycle.js';
import type { CanonicalEvent, EventPlan } from './types.js';

/**
 * The one calendar-facing capability agents see. Behind it:
 * - availability: Cal.com busy times across connected calendars (iCloud via Cal.com),
 * - holds and confirmations: the Open Media plan calendar, a signed ICS feed the
 *   person subscribes to once in Apple Calendar.
 * Cal.com bookings are never used to imitate external events.
 */
export interface Availability {
  connected: boolean;
  source: 'calcom' | 'none';
  busy: BusyInterval[];
  note?: string;
}

export class CalendarCapability {
  private readonly calcom?: CalComAvailabilityClient;

  constructor(private readonly options: { calcomApiKey?: string; feedSigningKey?: string; publicOrigin: string }) {
    if (options.calcomApiKey) this.calcom = new CalComAvailabilityClient({ apiKey: options.calcomApiKey, timeoutMs: 8_000 });
  }

  get availabilityConfigured(): boolean {
    return Boolean(this.calcom);
  }

  get feedConfigured(): boolean {
    return Boolean(this.options.feedSigningKey);
  }

  async availability(from: Date, to: Date, timeZone: string): Promise<Availability> {
    if (!this.calcom) {
      return { connected: false, source: 'none', busy: [], note: 'Cal.com is not connected yet, so existing calendar commitments were not checked. Only Open Media plans were checked.' };
    }
    try {
      return { connected: true, source: 'calcom', busy: await this.calcom.busyTimes({ from, to, timeZone }) };
    } catch (error) {
      const message = error instanceof CalComError ? error.message : 'Cal.com availability failed.';
      return { connected: false, source: 'none', busy: [], note: `${message} Existing calendar commitments were not checked.` };
    }
  }

  conflicts(busy: BusyInterval[], start: Date, end: Date) {
    return findConflicts(busy, start, end);
  }

  async listCalendars() {
    if (!this.calcom) return undefined;
    return this.calcom.listCalendars();
  }

  /** Signed, revocable subscription URL. Rotating the version invalidates older URLs. */
  async feedUrl(userId: string, version: number): Promise<string | undefined> {
    if (!this.options.feedSigningKey) return undefined;
    const signature = await this.sign(`${userId}:${version}`);
    return `${this.options.publicOrigin}/v1/events/calendar/${encodeURIComponent(userId)}/${version}/${signature}.ics`;
  }

  async verifyFeed(userId: string, version: number, signature: string): Promise<boolean> {
    if (!this.options.feedSigningKey) return false;
    const expected = await this.sign(`${userId}:${version}`);
    return timingSafeEqual(expected, signature);
  }

  buildFeed(plans: Array<{ plan: EventPlan; event: CanonicalEvent; registrationLabel?: string }>): string {
    const entries: CalendarEntry[] = [];
    for (const { plan, event, registrationLabel } of plans) {
      const status = calendarStatusFor(plan.state);
      if (!status) continue;
      const window = planWindow(plan, event);
      if (!window) continue;
      const prefix = status === 'TENTATIVE' ? (plan.state === 'waitlisted' ? 'Waitlisted: ' : 'Hold: ') : '';
      const location = event.venue?.address ?? event.venue?.name ?? (event.attendanceMode === 'online' ? 'Online' : undefined);
      const description = [
        registrationLabel ?? (plan.state === 'held' ? 'Time held. Not registered yet.' : undefined),
        plan.travelBeforeMinutes ? `Includes about ${plan.travelBeforeMinutes} min of travel before (estimate).` : undefined,
        plan.travelAfterMinutes ? `Includes about ${plan.travelAfterMinutes} min of travel after (estimate).` : undefined,
        event.sources[0]?.url ? `Event page: ${event.sources[0].url}` : undefined,
        plan.notes ? `Notes: ${plan.notes}` : undefined,
        'Managed by Open Media Events.',
      ].filter(Boolean).join('\n');
      entries.push({
        uid: `${plan.id}@events.open-media`,
        title: `${prefix}${event.title}`,
        start: window.start,
        end: window.end,
        status,
        location,
        description,
        url: event.sources[0]?.url,
        sequence: plan.calendarSequence,
        updatedAt: new Date(plan.updatedAt),
        alarmMinutes: status === 'CANCELLED' ? undefined : 60 + plan.travelBeforeMinutes,
      });
    }
    return buildCalendar({ name: 'Open Media plans', description: 'Event holds and confirmed plans from Open Media Events', refreshMinutes: 15, productId: '-//Open Media//Events//EN', entries });
  }

  private async sign(value: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.options.feedSigningKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
    return [...signature.slice(0, 20)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

/** The calendar block for a plan: event time plus any travel buffers. */
export function planWindow(plan: Pick<EventPlan, 'holdStart' | 'holdEnd' | 'travelBeforeMinutes' | 'travelAfterMinutes'>, event: CanonicalEvent): { start: Date; end: Date } | undefined {
  if (plan.holdStart && plan.holdEnd) return { start: new Date(plan.holdStart), end: new Date(plan.holdEnd) };
  if (event.dateOnly) return undefined;
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : start + 2 * 3_600_000;
  return { start: new Date(start - plan.travelBeforeMinutes * 60_000), end: new Date(end + plan.travelAfterMinutes * 60_000) };
}

/**
 * Labeled travel estimate from straight-line distance. No traffic or transit
 * schedules are consulted, and callers must present it as an estimate.
 */
export function estimateTravelMinutes(distanceKm: number | undefined, mode: 'driving' | 'transit' | 'walking' | 'cycling'): number | undefined {
  if (distanceKm === undefined) return undefined;
  const road = distanceKm * 1.35;
  const speedKmh = { driving: 40, transit: 22, walking: 4.8, cycling: 15 }[mode];
  const overhead = { driving: 10, transit: 15, walking: 0, cycling: 5 }[mode];
  return Math.round((road / speedKmh) * 60 + overhead);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

import type { CanonicalEvent, DiscoveredEvent, EventSource } from './types.js';

/**
 * Staged duplicate detection:
 *  1. exact provider identity (handled by the store's source index),
 *  2. strong deterministic signals: same start (±15 min) or same local date for
 *     date-only listings, similar normalized titles, compatible locations,
 *  3. ambiguous pairs stay separate.
 * Different occurrences of a recurring series never merge because their start
 * times differ.
 */
const START_TOLERANCE_MS = 15 * 60_000;
const TIMED_TITLE_THRESHOLD = 0.6;
const DATE_ONLY_TITLE_THRESHOLD = 0.75;

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'with', 'to', 'by', 'x', '&', '@', 'event', 'events', 'tickets', '2026', '2027']);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  // Overlap coefficient tolerates one listing adding a suffix such as a venue or series name.
  const overlap = shared / Math.min(left.size, right.size);
  const jaccard = shared / (left.size + right.size - shared);
  return Math.max(jaccard, overlap * 0.9);
}

function localDate(startsAt: string, dateOnly: boolean | undefined, timeZone: string): string {
  if (dateOnly) return startsAt.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(startsAt));
}

function locationsCompatible(a: DiscoveredEvent, b: DiscoveredEvent): boolean {
  if (a.attendanceMode !== 'unknown' && b.attendanceMode !== 'unknown' && (a.attendanceMode === 'online') !== (b.attendanceMode === 'online')) return false;
  const cityA = a.venue?.city?.toLowerCase();
  const cityB = b.venue?.city?.toLowerCase();
  if (cityA && cityB && cityA !== cityB) {
    const [la, lo] = [a.venue?.latitude, a.venue?.longitude];
    const [lb, lob] = [b.venue?.latitude, b.venue?.longitude];
    if (la === undefined || lo === undefined || lb === undefined || lob === undefined) return false;
    return Math.abs(la - lb) < 0.02 && Math.abs(lo - lob) < 0.02;
  }
  return true;
}

/** Whether two listings describe the same occurrence, with the evidence used. */
export function sameOccurrence(a: DiscoveredEvent, b: DiscoveredEvent, timeZone: string): { match: boolean; confidence: number; reason: string } {
  if (a.provider === b.provider && a.providerEventId === b.providerEventId) return { match: true, confidence: 1, reason: 'same provider id' };
  if (a.url && a.url === b.url) return { match: true, confidence: 1, reason: 'same URL' };
  if (!locationsCompatible(a, b)) return { match: false, confidence: 0, reason: 'different locations' };
  const similarity = titleSimilarity(a.title, b.title);
  if (a.dateOnly || b.dateOnly) {
    const sameDay = localDate(a.startsAt, a.dateOnly, timeZone) === localDate(b.startsAt, b.dateOnly, timeZone);
    const match = sameDay && similarity >= DATE_ONLY_TITLE_THRESHOLD;
    return { match, confidence: match ? similarity * 0.9 : 0, reason: match ? 'same date and similar title' : 'insufficient evidence' };
  }
  const startDelta = Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const match = startDelta <= START_TOLERANCE_MS && similarity >= TIMED_TITLE_THRESHOLD;
  return { match, confidence: match ? similarity : 0, reason: match ? 'same start time and similar title' : 'insufficient evidence' };
}

/** Groups listings that describe the same occurrence. Input order decides the primary listing. */
export function clusterListings(listings: DiscoveredEvent[], timeZone: string): DiscoveredEvent[][] {
  const clusters: DiscoveredEvent[][] = [];
  for (const listing of listings) {
    const home = clusters.find((cluster) => cluster.some((member) => sameOccurrence(member, listing, timeZone).match));
    if (home) home.push(listing);
    else clusters.push([listing]);
  }
  return clusters;
}

/** Merges a cluster (and optionally a stored event) into one canonical record. */
export function mergeCluster(id: string, cluster: DiscoveredEvent[], existing?: CanonicalEvent): CanonicalEvent {
  const timed = cluster.find((item) => !item.dateOnly);
  const primary = timed ?? cluster[0]!;
  const longestDescription = cluster.map((item) => item.description).filter(Boolean).sort((a, b) => b!.length - a!.length)[0];
  const venue = cluster.find((item) => item.venue?.latitude !== undefined)?.venue ?? cluster.find((item) => item.venue)?.venue;
  const registration = cluster.find((item) => item.registration && item.registration.availability !== 'unknown')?.registration ?? primary.registration;
  const price = cluster.find((item) => item.price?.isFree !== undefined || item.price?.minCents !== undefined)?.price;
  const status = cluster.some((item) => item.status === 'cancelled') ? 'cancelled' : primary.status;
  const sources = new Map<string, EventSource>();
  for (const source of existing?.sources ?? []) sources.set(`${source.provider}|${source.providerEventId}`, source);
  for (const item of cluster) {
    sources.set(`${item.provider}|${item.providerEventId}`, { provider: item.provider, providerEventId: item.providerEventId, url: item.url, retrievedAt: item.retrievedAt });
  }
  const categories = new Set([...(existing?.categories ?? []), ...cluster.flatMap((item) => item.categories ?? [])]);
  const keepExistingTime = existing && !existing.dateOnly && !timed;
  return {
    id,
    title: primary.title,
    description: longestDescription ?? existing?.description,
    startsAt: keepExistingTime ? existing.startsAt : primary.startsAt,
    endsAt: keepExistingTime ? existing.endsAt : (primary.endsAt ?? existing?.endsAt),
    dateOnly: keepExistingTime ? false : Boolean(primary.dateOnly),
    timezone: primary.timezone ?? cluster.find((item) => item.timezone)?.timezone ?? existing?.timezone,
    status,
    attendanceMode: primary.attendanceMode !== 'unknown' ? primary.attendanceMode : (cluster.find((item) => item.attendanceMode !== 'unknown')?.attendanceMode ?? existing?.attendanceMode ?? 'unknown'),
    venue: venue ?? existing?.venue,
    organizer: primary.organizer ?? cluster.find((item) => item.organizer)?.organizer ?? existing?.organizer,
    price: price ?? existing?.price,
    registration: registration ?? existing?.registration,
    categories: [...categories].slice(0, 12),
    recurrence: cluster.find((item) => item.recurrence?.isRecurring)?.recurrence ?? primary.recurrence ?? existing?.recurrence,
    attendeeCount: cluster.map((item) => item.attendeeCount).find((value) => value !== undefined) ?? existing?.attendeeCount,
    imageUrl: primary.imageUrl ?? cluster.find((item) => item.imageUrl)?.imageUrl ?? existing?.imageUrl,
    sources: [...sources.values()],
    updatedAt: new Date().toISOString(),
  };
}

/** Deterministic canonical id for a new occurrence, derived from its first listing. */
export async function canonicalIdFor(listing: DiscoveredEvent): Promise<string> {
  const data = new TextEncoder().encode(`${listing.provider}|${listing.providerEventId}|${listing.startsAt}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `evt_${[...digest.slice(0, 10)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

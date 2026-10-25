/**
 * Structured posts (ADR 0013, phase 3): a product or service someone offers, and real-world events
 * read from public event listings. Both are ordinary Feed posts with typed details, so they keep
 * their author, source link and "Why this?" like every other post.
 */

export type ListingKind = 'product' | 'service';
export type ListingAvailability = 'available' | 'limited' | 'sold_out';

export interface PostListing {
  kind: ListingKind;
  title: string;
  /** Price in the currency's minor unit (cents). Null means "ask for a price". */
  priceMinor: number | null;
  currency: string;
  location?: string;
  remote: boolean;
  availability: ListingAvailability;
  /** Shared by copies of the same item so ratings count once. */
  groupId?: string;
  /** Five-star ratings from verified people (tier 5). `mine` is the viewer's own, when signed in. */
  rating?: ListingRating;
}

export interface ListingRating { average: number | null; count: number; mine: number | null }

export interface ListingInput {
  kind: ListingKind;
  title: string;
  price?: string;
  currency?: string;
  location?: string;
  remote?: boolean;
  availability?: ListingAvailability;
}

export type EventAvailability = 'open' | 'closed' | 'sold_out' | 'waitlist' | 'approval_required' | 'unknown';

export interface PostEvent {
  title: string;
  startsAt: string;
  endsAt?: string;
  /** The source gave a date but no start time. */
  dateOnly: boolean;
  timezone?: string;
  place?: string;
  online: boolean;
  free?: boolean;
  priceText?: string;
  organizer?: string;
  availability: EventAvailability;
  /** The official page where people register themselves. Open Media never registers anyone. */
  registrationUrl: string;
  /** Every platform that lists this event, so duplicates across platforms show as one card. */
  sources: { provider: string; url: string }[];
}

export const listingCurrencies = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY'] as const;
const zeroDecimal = new Set(['JPY']);
export const maxListingTitle = 120;
export const maxPriceMinor = 100_000_000;

/** Parses "25", "25.50" or "$1,200" into minor units; empty means "ask for a price". */
export function parsePrice(value: string | undefined, currency: string): number | null | 'invalid' {
  const cleaned = (value ?? '').replace(/[\s,$€£₹¥]/g, '');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return 'invalid';
  const minor = zeroDecimal.has(currency) ? Math.round(Number(cleaned)) : Math.round(Number(cleaned) * 100);
  return minor > maxPriceMinor ? 'invalid' : minor;
}

export function formatPrice(minor: number | null, currency: string): string {
  if (minor === null) return 'Ask for price';
  if (minor === 0) return 'Free';
  const amount = zeroDecimal.has(currency) ? minor : minor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Checks a listing before it is sent; the database checks the same rules again. */
export function validateListing(input: ListingInput): { listing: PostListing } | { error: string } {
  const title = input.title.trim();
  if (!title) return { error: 'Give the listing a title.' };
  if (title.length > maxListingTitle) return { error: `Titles can be up to ${maxListingTitle} characters.` };
  const currency = (input.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Choose a currency.' };
  const priceMinor = parsePrice(input.price, currency);
  if (priceMinor === 'invalid') return { error: 'Enter a price like 25 or 25.50, or leave it empty.' };
  const location = input.location?.trim() || undefined;
  if (location && location.length > 120) return { error: 'Keep the location under 120 characters.' };
  return { listing: { kind: input.kind, title, priceMinor, currency, location, remote: Boolean(input.remote), availability: input.availability ?? 'available' } };
}

export function listingLine(listing: PostListing): string {
  const where = [listing.location, listing.remote ? (listing.kind === 'service' ? 'Remote' : 'Ships') : undefined].filter(Boolean).join(' · ');
  return [formatPrice(listing.priceMinor, listing.currency), where, listing.availability === 'sold_out' ? 'Sold out' : listing.availability === 'limited' ? 'Few left' : undefined].filter(Boolean).join(' · ');
}

export function isListing(value: unknown): value is PostListing {
  const item = value as PostListing;
  return Boolean(item) && (item.kind === 'product' || item.kind === 'service') && typeof item.title === 'string'
    && (item.priceMinor === null || Number.isInteger(item.priceMinor)) && typeof item.currency === 'string' && typeof item.remote === 'boolean';
}

/** "Sat, Nov 1 · 6:30 PM" in the event's own time zone; date-only events show the date alone. */
export function eventWhen(event: Pick<PostEvent, 'startsAt' | 'dateOnly' | 'timezone'>, locale?: string): string {
  if (event.dateOnly) {
    const [year, month, day] = event.startsAt.slice(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  const date = new Date(event.startsAt);
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(event.timezone ? { timeZone: event.timezone } : {}) };
  try { return new Intl.DateTimeFormat(locale, options).format(date).replace(/, (\d)/, ' · $1'); }
  catch { return new Intl.DateTimeFormat(locale, { ...options, timeZone: undefined }).format(date); }
}

export function eventPriceText(event: Pick<PostEvent, 'free' | 'priceText'>): string | undefined {
  return event.free ? 'Free' : event.priceText;
}

const providerNames: Record<string, string> = { luma: 'Luma', meetup: 'Meetup', eventbrite: 'Eventbrite', feeds: 'Event feed' };
export function providerName(provider: string): string {
  return providerNames[provider] ?? provider.replace(/^\w/, (letter) => letter.toUpperCase());
}

/** An upcoming public event as the API returns it (GET /v1/events/upcoming). */
export interface PublicEvent extends PostEvent {
  id: string;
  description?: string;
  imageUrl?: string;
  /** The area these events were searched in, for example "San Francisco Bay Area". */
  area: string;
  updatedAt: string;
}

/** Turns an event into a Feed post that keeps its source, link and reason for being shown. */
export function socialPostFromEvent(event: PublicEvent): import('./posts').SocialPost {
  const provider = event.sources[0]?.provider ?? 'events';
  const organizer = event.organizer ?? providerName(provider);
  return {
    id: `event:${event.id}`,
    author: { id: `event-organizer:${organizer}`, displayName: organizer, handle: providerName(provider), initials: organizer.slice(0, 2).toUpperCase() },
    body: '',
    kind: 'link',
    createdAt: event.updatedAt,
    topics: ['events'],
    provenance: { connectorId: 'events', externalId: event.id, canonicalURL: event.sources[0]?.url ?? event.registrationUrl },
    relevance: { followsAuthor: false, selectedInterestMatches: [] },
    eligibility: {
      selection: `Upcoming public event in the ${event.area}, from ${[...new Set(event.sources.map((source) => providerName(source.provider)))].join(', ')}`,
      filters: ['Only events that have not started', 'Cancelled events are left out', 'The same event on several platforms is shown once'],
    },
    event: {
      title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, dateOnly: event.dateOnly, timezone: event.timezone, place: event.place,
      online: event.online, free: event.free, priceText: event.priceText, organizer: event.organizer, availability: event.availability,
      registrationUrl: event.registrationUrl, sources: event.sources,
    },
  };
}

/** Places one event after every `every` posts, so events sit among posts without taking over. */
export function interleaveEvents(posts: import('./posts').SocialPost[], events: import('./posts').SocialPost[], every = 6): import('./posts').SocialPost[] {
  if (!events.length) return posts;
  const result: import('./posts').SocialPost[] = [];
  let next = 0;
  posts.forEach((post, index) => {
    result.push(post);
    if ((index + 1) % every === 0 && next < events.length) result.push(events[next++]);
  });
  if (posts.length < every && next < events.length) result.push(events[next]);
  return result;
}

/**
 * Structured posts (ADR 0013, phase 3): a product or service someone offers, and real-world events
 * read from public event listings. Both are ordinary Feed posts with typed details, so they keep
 * their author, source link and "Why this?" like every other post.
 */

export type ListingKind = 'product' | 'service' | 'event';
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
  /** Events a member posts (ADR 0016): when it starts, in the organizer's time zone. */
  startsAt?: string;
  dateOnly?: boolean;
  timezone?: string;
  /** Only the author gets this, and only while other people can't see the listing (ADR 0016). */
  check?: ListingCheckNote;
  /** Verified people whose agents checked this listing's claims and agreed. */
  checkedBy?: number;
  /** Posted through the API or an agent rather than the app. */
  viaAgent?: boolean;
  /** Shown for large sellers, as the US INFORM Consumers Act requires. */
  seller?: SellerDisclosure;
}

export interface ListingCheckNote { state: 'held' | 'review'; reason: string; fix?: string }
export interface SellerDisclosure { name: string; address?: string; email?: string; phone?: string }

export interface ListingRating { average: number | null; count: number; mine: number | null }

export interface ListingInput {
  kind: ListingKind;
  /** "Nov 12 7pm", "tomorrow 6:30pm", "2026-11-12 19:00". Filling it in makes the listing an event. */
  when?: string;
  timezone?: string;
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
export function validateListing(input: ListingInput, now: Date = new Date()): { listing: PostListing } | { error: string } {
  const title = input.title.trim();
  if (!title) return { error: 'Give the listing a title.' };
  if (title.length > maxListingTitle) return { error: `Titles can be up to ${maxListingTitle} characters.` };
  const currency = (input.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Choose a currency.' };
  const priceMinor = parsePrice(input.price, currency);
  if (priceMinor === 'invalid') return { error: 'Enter a price like 25 or 25.50, or leave it empty.' };
  const location = input.location?.trim() || undefined;
  if (location && location.length > 120) return { error: 'Keep the location under 120 characters.' };
  const listing: PostListing = { kind: input.kind, title, priceMinor, currency, location, remote: Boolean(input.remote), availability: input.availability ?? 'available' };
  if (input.when?.trim() || input.kind === 'event') {
    const when = parseEventTime(input.when ?? '', now);
    if (!when) return { error: 'Say when the event starts, like “Nov 12 7pm” or “tomorrow 6:30pm”.' };
    if (when === 'past') return { error: 'That time has already passed. Choose a time in the future.' };
    return { listing: { ...listing, kind: 'event', startsAt: when.startsAt, dateOnly: when.dateOnly, timezone: input.timezone ?? deviceTimeZone() } };
  }
  return { listing };
}

function deviceTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Reads when an event starts from what a person typed, in the device's own time zone: "Nov 12 7pm",
 * "12 November 2026 19:30", "2026-11-12 19:00", "tomorrow 6:30pm", "sat 10am", or a date alone.
 * Returns null when it can't tell, and 'past' for a time that has gone.
 */
export function parseEventTime(text: string, now: Date = new Date()): { startsAt: string; dateOnly: boolean } | 'past' | null {
  const value = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!value) return null;
  let rest = value;
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  const take = (pattern: RegExp) => { const match = rest.match(pattern); if (match) rest = (rest.slice(0, match.index) + ' ' + rest.slice((match.index ?? 0) + match[0].length)).trim(); return match; };
  const iso = take(/\b(\d{4})-(\d{1,2})-(\d{1,2})(?:t(?=\d))?/);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]) - 1; day = Number(iso[3]); }
  if (month === undefined) {
    const relative = take(/\b(today|tonight|tomorrow)\b/);
    if (relative) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (relative[1] === 'tomorrow' ? 1 : 0));
      year = date.getFullYear(); month = date.getMonth(); day = date.getDate();
    }
  }
  if (month === undefined) {
    const named = take(/\b(?:(\d{1,2})(?:st|nd|rd|th)? )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?: (\d{1,2})(?:st|nd|rd|th)?\b)?(?: (\d{4})\b)?/);
    if (named && (named[1] || named[3])) {
      month = monthNames.indexOf(named[2]); day = Number(named[1] ?? named[3]); year = named[4] ? Number(named[4]) : undefined;
    }
  }
  if (month === undefined) {
    const weekday = take(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
    if (weekday) {
      const ahead = (weekdayNames.indexOf(weekday[1]) - now.getDay() + 7) % 7;
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
      year = date.getFullYear(); month = date.getMonth(); day = date.getDate();
    }
  }
  if (month === undefined || day === undefined || day < 1 || day > 31) return null;
  rest = rest.replace(/\b(at|from|on|starts?|starting)\b/g, ' ').trim();
  let hours: number | undefined;
  let minutes = 0;
  const time = rest.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s.*)?$/) ?? (/\bnoon\b/.test(rest) ? ['noon', '12', '00', 'pm'] : null);
  if (rest && !time) return null;
  if (time) {
    hours = Number(time[1]); minutes = Number(time[2] ?? 0);
    const meridiem = time[3]?.replace(/\./g, '');
    if (minutes > 59 || hours > 23 || (meridiem && (hours < 1 || hours > 12))) return null;
    if (!meridiem && !time[2] && hours <= 12 && rest.length <= 2 && !/\btonight\b/.test(value)) return null; // "Nov 12 7" is ambiguous
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }
  if (/\btonight\b/.test(value) && hours !== undefined && hours < 12) hours += 12;
  // A month and day without a year means the next time that date comes round.
  let resolvedYear = year ?? now.getFullYear();
  const at = (y: number) => hours === undefined ? new Date(y, month!, day!) : new Date(y, month!, day!, hours, minutes);
  let date = at(resolvedYear);
  if (date.getMonth() !== month) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (year === undefined && date < startOfToday) date = at(++resolvedYear);
  if (hours === undefined) {
    if (date < startOfToday) return 'past';
    const pad = (n: number) => String(n).padStart(2, '0');
    return { startsAt: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, dateOnly: true };
  }
  if (date <= now) return 'past';
  return { startsAt: date.toISOString(), dateOnly: false };
}

export function listingLine(listing: PostListing): string {
  if (listing.kind === 'event') {
    const place = listing.remote ? 'Online' : listing.location;
    return [listing.startsAt ? eventWhen({ startsAt: listing.startsAt, dateOnly: Boolean(listing.dateOnly), timezone: listing.timezone }) : undefined, place, listing.priceMinor === null ? undefined : formatPrice(listing.priceMinor, listing.currency), listing.availability === 'sold_out' ? 'Full' : listing.availability === 'limited' ? 'Few places left' : undefined].filter(Boolean).join(' · ');
  }
  const where = [listing.location, listing.remote ? (listing.kind === 'service' ? 'Remote' : 'Ships') : undefined].filter(Boolean).join(' · ');
  return [formatPrice(listing.priceMinor, listing.currency), where, listing.availability === 'sold_out' ? 'Sold out' : listing.availability === 'limited' ? 'Few left' : undefined].filter(Boolean).join(' · ');
}

export function isListing(value: unknown): value is PostListing {
  const item = value as PostListing;
  return Boolean(item) && (item.kind === 'product' || item.kind === 'service' || item.kind === 'event') && typeof item.title === 'string'
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
  // iOS formats the time as "… at 9:30 AM"; Android and browsers use a comma. Show " · " on all.
  try { return new Intl.DateTimeFormat(locale, options).format(date).replace(/(, | at )(\d)/, ' · $2'); }
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

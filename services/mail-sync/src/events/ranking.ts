import { distanceKm, placeForCity } from './areas.js';
import { containsTerm, DATING_TERMS, FORMATS, INTERESTS, interestByKey, RECURRING_TERMS } from './taxonomy.js';
import type { CanonicalEvent, Daypart, ExplicitPreferences, LearnedSignal } from './types.js';

/** Initial engineering defaults from the Layer 1 plan; not empirically validated. */
export const WEIGHTS = {
  interest: 0.25,
  conversation: 0.2,
  recurring: 0.15,
  schedule: 0.15,
  geography: 0.1,
  quality: 0.1,
  novelty: 0.05,
} as const;

export interface RankingContext {
  now: Date;
  windowStart: Date;
  windowEnd: Date;
  timezone: string;
  center: { latitude: number; longitude: number };
  radiusKm: number;
  query?: string;
  /** Interests for this request (temporary) merged with stated interests. */
  interests: string[];
  /** Terms to exclude for this request plus permanent avoid list. */
  exclude: string[];
  dayparts: Daypart[];
  maxPriceUsd?: number;
  freeOnly?: boolean;
  inPersonOnly: boolean;
  preferences: ExplicitPreferences;
  learned: LearnedSignal[];
  /** Optional semantic similarity per event id (0–1), e.g. from embeddings. */
  semantic?: Map<string, number>;
  /** Busy intervals from the calendar, if connected. */
  busy?: Array<{ start: string; end: string }>;
  seenEventIds?: Set<string>;
  knownOrganizers?: Set<string>;
  rejectedOrganizers?: Set<string>;
}

export interface Relevance {
  friendship: number;
  professional_networking: number;
  romantic_social_opportunity: number;
  personal_growth: number;
  activity: number;
}

export interface RankedEvent {
  event: CanonicalEvent;
  score: number;
  excluded?: string;
  reasons: string[];
  cautions: string[];
  matchedInterests: string[];
  formats: string[];
  relevance: Relevance;
  distanceKm?: number;
  breakdown: Record<keyof typeof WEIGHTS, number>;
}

export function rankEvent(event: CanonicalEvent, context: RankingContext): RankedEvent {
  const text = ` ${[event.title, event.description ?? '', event.organizer?.name ?? '', ...(event.categories ?? [])].join(' ').toLowerCase()} `;
  const titleText = ` ${event.title.toLowerCase()} `;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : start + 2 * 3_600_000;

  // Hard constraints.
  let excluded: string | undefined;
  if (event.status === 'cancelled') excluded = 'cancelled';
  else if (!event.dateOnly && end < context.now.getTime()) excluded = 'already ended';
  else if (start >= context.windowEnd.getTime() || (event.dateOnly ? start + 86_400_000 : end) < context.windowStart.getTime()) excluded = 'outside the requested dates';
  else if (event.registration?.availability === 'closed') excluded = 'registration closed';
  else if (context.inPersonOnly && event.attendanceMode === 'online') excluded = 'online only';
  else if (context.freeOnly && event.price?.isFree === false) excluded = 'not free';
  else if (context.maxPriceUsd !== undefined && (event.price?.minCents ?? 0) > context.maxPriceUsd * 100) excluded = `costs more than $${context.maxPriceUsd}`;
  else {
    const hit = context.exclude.find((term) => term.trim() && containsTerm(text, term.toLowerCase()));
    if (hit) excluded = `matches excluded “${hit}”`;
  }

  // Interest and purpose alignment.
  const matched = new Set<string>();
  for (const key of context.interests) {
    const interest = interestByKey(key);
    const terms = interest ? interest.terms : [key.toLowerCase()];
    if (terms.some((term) => containsTerm(text, term))) matched.add(interest?.label ?? key);
  }
  const queryTerms = (context.query ?? '').toLowerCase().split(/[^a-z0-9+#]+/).filter((term) => term.length > 3 && !QUERY_STOP.has(term));
  const queryHits = queryTerms.filter((term) => containsTerm(text, term)).length;
  const lexical = Math.min(1, matched.size * 0.45 + (queryTerms.length ? queryHits / queryTerms.length : 0) * 0.5);
  const semantic = context.semantic?.get(event.id);
  const interestScore = semantic !== undefined ? Math.max(lexical, 0.5 * lexical + 0.5 * normalizeSemantic(semantic)) : lexical;
  if (matched.size) reasons.push(`Matches your interest in ${[...matched].slice(0, 3).join(', ')}`);
  else if (semantic !== undefined && normalizeSemantic(semantic) > 0.6) reasons.push('Closely related to what you asked for');

  // Conversation opportunity, from the event's stated format.
  const formats = FORMATS.filter((format) => format.terms.some((term) => containsTerm(text, term)));
  const titleFormats = FORMATS.filter((format) => format.terms.some((term) => containsTerm(titleText, term)));
  const formatSet = titleFormats.length ? titleFormats : formats;
  let conversation = formatSet.length ? Math.max(...formatSet.map((format) => format.conversation)) : 0.5;
  if (event.attendeeCount !== undefined) {
    if (event.attendeeCount <= 30) conversation = Math.min(1, conversation + 0.1);
    if (event.attendeeCount >= 300) conversation = Math.max(0, conversation - 0.2);
  }
  if (event.attendanceMode === 'online') conversation *= 0.5;
  for (const avoided of context.preferences.formatsAvoided) {
    if (formatSet.some((format) => format.key === avoided)) {
      conversation *= 0.4;
      cautions.push(`It's a ${avoided.replace('_', ' ')}, which you said you avoid`);
    }
  }
  for (const preferred of context.preferences.formatsPreferred) {
    if (formatSet.some((format) => format.key === preferred)) {
      conversation = Math.min(1, conversation + 0.15);
      reasons.push(`It's a ${preferred.replace('_', ' ')}, a format you prefer`);
    }
  }
  if (context.preferences.favorMeaningfulConversation && conversation >= 0.8) reasons.push('Its format leaves room for real conversation');

  // Recurring community potential.
  const recurringText = RECURRING_TERMS.some((term) => containsTerm(text, term));
  const recurring = event.recurrence?.isRecurring ? 1 : recurringText ? 0.7 : event.sources.some((source) => source.provider === 'meetup') ? 0.5 : 0.2;
  if (recurring >= 0.7 && context.preferences.preferRecurringCommunities) reasons.push('A recurring community you could return to');

  // Schedule compatibility.
  let schedule = 0.6;
  if (!event.dateOnly) {
    const part = daypartOf(new Date(start), context.timezone);
    schedule = context.dayparts.length === 0 || context.dayparts.includes(part) ? 1 : 0.35;
    if (schedule === 1 && context.dayparts.length) reasons.push(`Fits your ${part.replace('_', ' ')} preference`);
    const conflict = context.busy?.find((interval) => Date.parse(interval.start) < end && Date.parse(interval.end) > start);
    if (conflict) {
      schedule = 0;
      cautions.push('Overlaps something already on your calendar');
    }
  } else {
    cautions.push('The listing gives only a date; check the start time');
  }

  // Geography.
  let distance: number | undefined;
  const coordinates = event.venue?.latitude !== undefined && event.venue?.longitude !== undefined
    ? { latitude: event.venue.latitude, longitude: event.venue.longitude }
    : placeForCity(event.venue?.city);
  if (coordinates) distance = distanceKm(context.center, coordinates);
  let geography = event.attendanceMode === 'online' ? 0.6 : 0.5;
  if (distance !== undefined) {
    geography = distance <= context.radiusKm ? 1 - (distance / context.radiusKm) * 0.5 : Math.max(0, 0.5 - (distance - context.radiusKm) / 80);
    if (distance > context.radiusKm * 1.6 && !excluded) excluded = `about ${Math.round(distance)} km away`;
  }
  const preferredCity = context.preferences.preferredAreas.some((area) => event.venue?.city && area.toLowerCase().includes(event.venue.city.toLowerCase()));
  if (preferredCity) geography = Math.min(1, geography + 0.15);

  // Quality and reliability of the listing itself.
  let quality = 0.3;
  if ((event.description?.length ?? 0) > 200) quality += 0.2;
  if (event.venue?.address || event.venue?.name) quality += 0.15;
  if (event.organizer?.name) quality += 0.15;
  const providers = new Set(event.sources.map((source) => source.provider));
  if (providers.size > 1) quality += 0.15;
  if (event.sources.length >= 4) {
    // The same listing pushed into many groups is usually a large promotional event.
    quality -= 0.15;
    cautions.push(`Cross-posted to ${event.sources.length} groups, which often means a large promotional event`);
  }
  if (event.registration?.availability === 'open') quality += 0.05;
  quality = Math.max(0, Math.min(1, quality));
  if (event.registration?.availability === 'sold_out') cautions.push('Sold out');
  if (event.registration?.availability === 'waitlist') cautions.push('Waitlist only');
  if (event.registration?.requiresApproval || event.registration?.availability === 'approval_required') cautions.push('Registration needs host approval');

  // Novelty.
  const organizer = event.organizer?.name?.toLowerCase();
  let novelty = context.seenEventIds?.has(event.id) ? 0.2 : 0.7;
  if (organizer && context.knownOrganizers?.has(organizer)) novelty = Math.min(novelty, 0.4);
  if (organizer && context.rejectedOrganizers?.has(organizer)) {
    novelty = 0;
    cautions.push('You passed on this organizer before');
  }

  // Learned signals nudge, never override, the transparent weights.
  let learnedAdjustment = 0;
  for (const signal of context.learned) {
    if (signal.observations < 2) continue;
    const [kind, value] = signal.signal.split(':');
    const applies = (kind === 'format' && formatSet.some((format) => format.key === value))
      || (kind === 'interest' && matched.has(INTERESTS.find((interest) => interest.key === value)?.label ?? ''))
      || (kind === 'organizer' && organizer === value);
    if (!applies) continue;
    const direction = signal.positive / signal.observations - 0.5;
    learnedAdjustment += direction * 0.1 * signal.confidence;
    if (Math.abs(direction) >= 0.3 && signal.confidence >= 0.5) {
      (direction > 0 ? reasons : cautions).push(direction > 0 ? `You've liked similar ${kind === 'format' ? `${value}s` : 'events'} before` : `You've passed on similar ${kind === 'format' ? `${value}s` : 'events'} before`);
    }
  }

  const breakdown = { interest: interestScore, conversation, recurring, schedule, geography, quality, novelty };
  const weighted = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((sum, key) => sum + WEIGHTS[key] * breakdown[key], 0);
  const score = Math.max(0, Math.min(1, weighted + learnedAdjustment));

  return {
    event,
    score: Math.round(score * 1000) / 1000,
    ...(excluded ? { excluded } : {}),
    reasons: unique(reasons).slice(0, 4),
    cautions: unique(cautions).slice(0, 4),
    matchedInterests: [...matched],
    formats: formatSet.map((format) => format.key),
    relevance: relevanceFor(text, formatSet.map((format) => format.key), conversation),
    ...(distance !== undefined ? { distanceKm: Math.round(distance * 10) / 10 } : {}),
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Math.round(value * 100) / 100])) as RankedEvent['breakdown'],
  };
}

/**
 * Picks results with an exploration budget: most slots go to the best-aligned
 * events, a share goes to strong events outside the stated interests.
 */
export function selectWithExploration(ranked: RankedEvent[], limit: number, explorationShare: number): RankedEvent[] {
  const eligible = ranked.filter((item) => !item.excluded).sort((a, b) => b.score - a.score);
  const exploratorySlots = Math.min(Math.round(limit * explorationShare), Math.floor(limit / 2));
  const aligned = eligible.filter((item) => item.matchedInterests.length > 0);
  const other = eligible.filter((item) => item.matchedInterests.length === 0);
  const picked = aligned.slice(0, limit - Math.min(exploratorySlots, other.length));
  for (const item of other) {
    if (picked.length >= limit) break;
    picked.push(item);
  }
  for (const item of eligible) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked.sort((a, b) => b.score - a.score);
}

export function daypartOf(date: Date, timeZone: string): Daypart {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date));
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late_night';
}

/** Inferred, overlapping relevance dimensions. Estimates from public text, not facts about attendees. */
function relevanceFor(text: string, formats: string[], conversation: number): Relevance {
  const has = (terms: string[]) => terms.some((term) => containsTerm(text, term));
  const dating = has(DATING_TERMS);
  const professional = has(['founder', 'startup', 'networking', 'career', 'professionals', 'industry', 'investor', 'engineering', 'ai', 'conference', 'tech']);
  const activity = formats.includes('activity') || has(['hike', 'volleyball', 'soccer', 'dance', 'climb', 'run', 'game']);
  const growth = formats.some((format) => ['workshop', 'talk', 'discussion', 'hackathon'].includes(format)) || has(['learn', 'skills', 'class']);
  const social = has(['social', 'friends', 'community', 'meet new people', 'party', 'dinner']) || activity;
  const round = (value: number) => Math.round(Math.min(1, value) * 100) / 100;
  return {
    friendship: round((social ? 0.6 : 0.25) + conversation * 0.3),
    professional_networking: round(professional ? 0.75 : 0.15),
    romantic_social_opportunity: round(dating ? 0.9 : social ? 0.3 : 0.1),
    personal_growth: round(growth ? 0.75 : 0.3),
    activity: round(activity ? 0.9 : 0.1),
  };
}

function normalizeSemantic(value: number): number {
  // Cosine similarities from small sentence encoders cluster around 0.3–0.8.
  return Math.max(0, Math.min(1, (value - 0.3) / 0.45));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const QUERY_STOP = new Set(['events', 'event', 'find', 'some', 'interesting', 'this', 'that', 'weekend', 'week', 'tonight', 'today', 'tomorrow', 'want', 'meet', 'people', 'where', 'with', 'something', 'anything', 'next', 'near', 'around', 'like', 'would', 'maybe', 'really', 'good', 'great', 'things', 'stuff']);

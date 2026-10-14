import type { DiscoveredEvent } from 'luma-discovery';

export type { DiscoveredEvent };

/** A real-world event occurrence owned by Open Media, independent of any provider. */
export interface CanonicalEvent {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  dateOnly: boolean;
  timezone?: string;
  status: DiscoveredEvent['status'];
  attendanceMode: DiscoveredEvent['attendanceMode'];
  venue?: DiscoveredEvent['venue'];
  organizer?: DiscoveredEvent['organizer'];
  price?: DiscoveredEvent['price'];
  registration?: DiscoveredEvent['registration'];
  categories: string[];
  recurrence?: DiscoveredEvent['recurrence'];
  attendeeCount?: number;
  imageUrl?: string;
  sources: EventSource[];
  updatedAt: string;
}

export interface EventSource {
  provider: string;
  providerEventId: string;
  url: string;
  retrievedAt: string;
}

/** Planning lifecycle. Calendar, registration and attendance stay independent facts. */
export type PlanState =
  | 'interested'
  | 'proposed'
  | 'held'
  | 'registration_pending'
  | 'registered'
  | 'waitlisted'
  | 'declined'
  | 'cancelled'
  | 'attended'
  | 'missed';

export type RegistrationStatus = 'not_registered' | 'handoff_started' | 'pending_approval' | 'registered' | 'waitlisted' | 'cancelled' | 'failed' | 'unknown';

/** Who vouches for a registration status. Only the provider can confirm. */
export type Verification = 'provider_confirmed' | 'user_reported' | 'none';

export interface EventPlan {
  id: string;
  userId: string;
  eventId: string;
  state: PlanState;
  notes?: string;
  holdStart?: string;
  holdEnd?: string;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  calendarSequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface Registration {
  id: string;
  userId: string;
  eventId: string;
  status: RegistrationStatus;
  method: 'external_handoff' | 'provider_api';
  verification: Verification;
  provider?: string;
  providerReference?: string;
  updatedAt: string;
}

export type TravelMode = 'driving' | 'transit' | 'walking' | 'cycling';
export type Daypart = 'morning' | 'afternoon' | 'evening' | 'late_night';

/** Preferences the user stated. Learned signals are stored separately. */
export interface ExplicitPreferences {
  homeArea: string;
  preferredAreas: string[];
  timezone: string;
  maxTravelMinutes: number;
  travelMode: TravelMode;
  preferredDayparts: Daypart[];
  interests: string[];
  goals: string[];
  avoid: string[];
  formatsPreferred: string[];
  formatsAvoided: string[];
  preferRecurringCommunities: boolean;
  favorMeaningfulConversation: boolean;
  maxPriceUsd?: number;
  explorationShare: number;
  suggestionsPerSearch: number;
  autoHoldOnSave: boolean;
}

export interface LearnedSignal {
  signal: string;
  observations: number;
  positive: number;
  confidence: number;
  userConfirmed: boolean;
  updatedAt: string;
}

export interface UserContext {
  userId: string;
}

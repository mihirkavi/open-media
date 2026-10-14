import type { PlanState, RegistrationStatus, Verification } from './types.js';

/**
 * Allowed plan transitions. A calendar hold is not a registration and a
 * registration is not attendance; each state says only what is known.
 */
const TRANSITIONS: Record<PlanState, PlanState[]> = {
  interested: ['proposed', 'held', 'registration_pending', 'registered', 'waitlisted', 'declined', 'cancelled', 'attended', 'missed'],
  proposed: ['interested', 'held', 'registration_pending', 'registered', 'waitlisted', 'declined', 'cancelled'],
  held: ['interested', 'registration_pending', 'registered', 'waitlisted', 'declined', 'cancelled', 'attended', 'missed'],
  registration_pending: ['held', 'registered', 'waitlisted', 'declined', 'cancelled'],
  registered: ['declined', 'cancelled', 'attended', 'missed', 'waitlisted'],
  waitlisted: ['registered', 'held', 'declined', 'cancelled', 'missed'],
  declined: ['interested', 'held', 'registration_pending', 'registered'],
  cancelled: ['interested'],
  attended: [],
  missed: [],
};

export function canTransition(from: PlanState | undefined, to: PlanState): boolean {
  if (!from) return true;
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PlanState | undefined, to: PlanState): void {
  if (!canTransition(from, to)) {
    throw new Error(`A plan cannot move from “${from}” to “${to}”. Allowed next states: ${from ? TRANSITIONS[from].join(', ') || 'none' : 'any'}.`);
  }
}

/** What the plan calendar should show for a plan state. */
export function calendarStatusFor(state: PlanState): 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED' | undefined {
  switch (state) {
    case 'held':
    case 'registration_pending':
    case 'waitlisted':
      return 'TENTATIVE';
    case 'registered':
      return 'CONFIRMED';
    case 'declined':
    case 'cancelled':
      return 'CANCELLED';
    default:
      return undefined;
  }
}

/** The plan state implied by a registration outcome. */
export function planStateForRegistration(status: RegistrationStatus): PlanState | undefined {
  switch (status) {
    case 'handoff_started':
    case 'pending_approval':
      return 'registration_pending';
    case 'registered':
      return 'registered';
    case 'waitlisted':
      return 'waitlisted';
    case 'cancelled':
      return 'declined';
    default:
      return undefined;
  }
}

/** Human-readable label for a registration, honest about who confirmed it. */
export function describeRegistration(status: RegistrationStatus, verification: Verification): string {
  const who = verification === 'provider_confirmed' ? 'confirmed by the provider' : verification === 'user_reported' ? 'as you reported; not verified with the provider' : 'not verified';
  switch (status) {
    case 'registered':
      return `Registered (${who})`;
    case 'waitlisted':
      return `Waitlisted (${who})`;
    case 'pending_approval':
      return `Waiting for host approval (${who})`;
    case 'handoff_started':
      return 'Registration link shared; not registered yet';
    case 'cancelled':
      return `Registration cancelled (${who})`;
    case 'failed':
      return 'Registration attempt failed';
    case 'not_registered':
      return 'Not registered';
    default:
      return 'Registration status unknown';
  }
}

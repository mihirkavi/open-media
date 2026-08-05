import { Identity } from './models';

export type MatchSignal = 'shared-verified-email' | 'shared-phone' | 'matching-name' | 'user-import-link';

export interface IdentityMatchSuggestion {
  candidateIdentity: Identity;
  targetPersonId: string;
  confidence: number;
  signals: MatchSignal[];
  status: 'review-required' | 'accepted' | 'rejected';
}

/**
 * Produces a reviewable suggestion, never an automatic merge. Confidence helps
 * prioritize the review queue; it is not authorization to join identities.
 */
export function suggestIdentityMatch(
  candidateIdentity: Identity,
  targetPersonId: string,
  signals: MatchSignal[],
): IdentityMatchSuggestion {
  const weights: Record<MatchSignal, number> = {
    'shared-verified-email': 0.62,
    'shared-phone': 0.7,
    'matching-name': 0.18,
    'user-import-link': 0.45,
  };
  const confidence = Math.min(0.99, signals.reduce((total, signal) => total + weights[signal], 0));

  return {
    candidateIdentity,
    targetPersonId,
    confidence,
    signals,
    status: 'review-required',
  };
}

export function canMergeIdentity(suggestion: IdentityMatchSuggestion): boolean {
  return suggestion.status === 'accepted';
}

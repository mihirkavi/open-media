import { Ionicons } from '@expo/vector-icons';

/**
 * The blue tick (ADR 0013): this Open Media account was verified by the identity provider. It is
 * set only by the server and is never shown for other networks' badges. Verified email senders
 * (BIMI) use a different mark in Messages.
 */
export const verifiedBlue = '#1D9BF0';

export function VerifiedTick({ size = 15 }: { size?: number }) {
  return <Ionicons accessibilityRole="image" accessibilityLabel="Verified person" name="checkmark-circle" size={size} color={verifiedBlue} />;
}

import Ionicons from './Icon';

/**
 * The blue tick (ADR 0013): this Open Media account was verified by the identity provider. It is
 * set only by the server and is never shown for other networks' badges. Verified email senders
 * (BIMI with a mark certificate) show the same blue tick in Messages, labelled "Verified sender",
 * and web feeds served from a major news outlet's or weather service's own domain show it labelled
 * "Official feed from …" (ADR 0024).
 */
export const verifiedBlue = '#1D9BF0';

export function VerifiedTick({ size = 15, label = 'Verified person' }: { size?: number; label?: string }) {
  return <Ionicons accessibilityRole="image" accessibilityLabel={label} name="checkmark-circle" size={size} color={verifiedBlue} />;
}

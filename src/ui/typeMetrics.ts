/**
 * Geist's tracking in em for a font size: reading sizes stay at the drawn spacing, and display
 * sizes close up gradually (to about -0.02em at 32 px), the way Geist is set in Vercel's own UI.
 */
export function geistTracking(size: number): number {
  if (size <= 14) return 0;
  return Math.max(-0.022, -(size - 14) * 0.0011);
}

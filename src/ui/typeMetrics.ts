/**
 * SF Pro's tracking in em for a font size, as apple.com sets it: text sizes close up a little more
 * as they grow (-0.01em at 12 px, -0.022em at 17 px), and from 20 px, where SF switches to its
 * Display cut, the spacing opens slightly and settles back to the drawn spacing by 40 px.
 */
export function sfTracking(size: number): number {
  if (size < 20) {
    const t = Math.min(1, Math.max(0, (size - 12) / 5));
    return -0.01 - t * 0.012;
  }
  if (size >= 40) return 0;
  return 0.011 * (1 - (size - 20) / 20);
}

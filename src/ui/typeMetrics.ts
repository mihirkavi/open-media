/** Inter's recommended tracking in em for a font size (rsms.me/inter/dynmetrics). */
export function interTracking(size: number): number {
  return -0.0223 + 0.185 * Math.exp(-0.1745 * size);
}

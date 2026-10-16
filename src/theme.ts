/**
 * Open Media's visual system: black, white, and a few warm neutral grays.
 * `accent` is deliberately the text color, so emphasis comes from contrast
 * and weight rather than hue. `success` and `danger` are the only colors.
 */
export const lightColors = {
  accent: '#111111',
  accentSoft: '#F1F1EE',
  chrome: '#F4F4F1',
  surface: '#FFFFFF',
  surfaceAlt: '#FAFAF8',
  border: '#E6E6E1',
  /** Incoming message bubbles. */
  bubble: '#EDEDEA',
  text: '#111111',
  textSecondary: '#5C5C57',
  textTertiary: '#7E7E78',
  success: '#2F7D47',
  danger: '#B42318',
};

export type ThemeColors = typeof lightColors;
export type AppearanceMode = 'system' | 'light' | 'dark';

export const darkColors: ThemeColors = {
  accent: '#F6F6F2',
  accentSoft: '#1A1A18',
  chrome: '#131312',
  surface: '#0A0A0A',
  surfaceAlt: '#0E0E0D',
  border: '#272725',
  bubble: '#222220',
  text: '#F6F6F2',
  textSecondary: '#B4B4AD',
  textTertiary: '#8A8A83',
  success: '#7BC795',
  danger: '#FF8A7A',
};

export const radii = {
  small: 10,
  medium: 16,
  large: 22,
  pill: 999,
};

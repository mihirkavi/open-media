export const lightColors = {
  accent: '#1479FF',
  accentSoft: '#EAF3FF',
  chrome: '#F6F6F4',
  surface: '#FFFFFF',
  surfaceAlt: '#FAFAF8',
  border: '#E7E7E2',
  text: '#111111',
  textSecondary: '#5F5F5B',
  textTertiary: '#858580',
  success: '#24A148',
  email: '#D9485F',
  gmail: '#D84B40',
  icloud: '#1687FF',
};

export type ThemeColors = typeof lightColors;
export type AppearanceMode = 'system' | 'light' | 'dark';

export const darkColors: ThemeColors = {
  accent: '#8AB8FF',
  accentSoft: '#172238',
  chrome: '#111110',
  surface: '#0A0A0A',
  surfaceAlt: '#0E0E0D',
  border: '#2A2A27',
  text: '#F6F6F2',
  textSecondary: '#B1B1AA',
  textTertiary: '#85857E',
  success: '#64C782',
  email: '#FF8191',
  gmail: '#FF8177',
  icloud: '#7DB7FF',
};

/** Legacy light palette retained for the existing messaging components. */
export const colors = lightColors;

export const radii = {
  small: 10,
  medium: 16,
  large: 22,
  pill: 999,
};

import { Platform } from 'react-native';

/**
 * The contacts design (ADR 0036): one set of sizes for the list, the card, editing, import and
 * export. Type follows Apple's text styles (Large Title 34, Body 17, Subhead 15, Footnote 13);
 * colour stays the app's black, white and warm grays, with red only for removing and deleting
 * and green only for adding a field. Every control is at least 44 points tall.
 */
export const contactsType = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: Platform.OS === 'web' ? -0.9 : 0.35 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '500' as const, letterSpacing: -0.2 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.2 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: 0.4 },
};

export const contactsSpace = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, gutter: 16, wideGutter: 24 };

export const contactsRadius = { group: 20, input: 12, pill: 999, avatar: 999 };

/** Touch targets: 44 points on iPhone and the web, 48 on Android. */
export const touch = Platform.OS === 'android' ? 48 : 44;

export const avatarSize = { row: 40, card: 96 };

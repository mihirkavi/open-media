import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';

import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text } from './Text';

/**
 * The one way a card leaves Open Media for the original: "Open on Hive", "Read on bbc.co.uk",
 * "Listen on …". Every card puts it in the same place, bottom right beside "Why this?", in the same
 * quiet outlined pill with the standard ↗ for leaving the app, so the eye learns one spot. It is
 * outlined rather than filled so the post itself stays the loudest thing on the card.
 */
export function OriginalLink({ url, label, accessibilityLabel }: { url: string; label: string; accessibilityLabel: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <Pressable
    accessibilityRole="link"
    accessibilityLabel={accessibilityLabel}
    onPress={() => { Linking.openURL(url).catch(() => undefined); }}
    style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.pill, (hovered || pressed) && styles.pillActive]}
  >
    <Text numberOfLines={1} style={styles.label}>{label}</Text>
    <Ionicons name="arrow-up-outline" size={13} color={colors.textSecondary} style={styles.arrow} />
  </Pressable>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  pill: { maxWidth: 240, minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 10, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: 'transparent' },
  pillActive: { backgroundColor: colors.chrome },
  label: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '600', letterSpacing: -0.1 },
  arrow: { transform: [{ rotate: '45deg' }] },
}); }

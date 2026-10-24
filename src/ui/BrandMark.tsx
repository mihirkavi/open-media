import { Image, StyleSheet, View } from 'react-native';

import { useOpenMediaTheme } from '../themeContext';
import { Text } from './Text';

/** The Open Media mark and name. The mark is transparent, drawn dark on light and light on dark. */
export function BrandMark({ compact }: { compact?: boolean }) {
  const { colors, isDark } = useOpenMediaTheme();
  return <View accessibilityLabel="Open Media" style={[styles.brand, compact && styles.compact]}>
    <Image source={isDark ? require('../../assets/brand/logo-dark.png') : require('../../assets/brand/logo-light.png')} style={styles.icon} resizeMode="contain" />
    <Text style={[styles.wordmark, { color: colors.text }]}>Open Media</Text>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 34 },
  compact: { marginBottom: 0 },
  icon: { width: 24, height: 24 },
  wordmark: { fontSize: 17, fontWeight: '700', letterSpacing: -0.4 },
});

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import Ionicons from './Icon';
import { Text } from './Text';

/**
 * A small monochrome tile that identifies a network in Settings: its logo glyph where the icon
 * font has one, otherwise a lettermark. Black and white like the rest of Open Media, so a list of
 * fifteen networks reads as one calm column instead of a wall of brand colors.
 */
const glyphs: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  mastodon: 'logo-mastodon', x: 'logo-x', twitter: 'logo-x', threads: 'logo-threads', instagram: 'logo-instagram',
  linkedin: 'logo-linkedin', 'linkedin-official': 'logo-linkedin', facebook: 'logo-facebook', messenger: 'logo-facebook',
  whatsapp: 'logo-whatsapp', discord: 'logo-discord', slack: 'logo-slack', tiktok: 'logo-tiktok', snapchat: 'logo-snapchat',
  youtube: 'logo-youtube', reddit: 'logo-reddit', rss: 'logo-rss', 'mail-import': 'mail-outline', gmail: 'logo-google',
  'microsoft-graph': 'logo-microsoft', gvoice: 'call-outline', gmessages: 'chatbubbles-outline', 'open-media': 'ellipse',
  matrix: 'git-network-outline', 'ai-chat': 'sparkles-outline',
};

const letters: Record<string, string> = {
  bluesky: 'b', nostr: 'n', farcaster: 'f', lens: 'l', hive: 'h', deso: 'd', signal: 's', telegram: 't', imessage: 'i',
};

export function NetworkMark({ id, name, size = 36, muted }: { id: string; name: string; size?: number; muted?: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glyph = glyphs[id];
  const color = muted ? colors.textTertiary : colors.text;
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.3) }, muted && styles.mutedTile]}>
    {glyph
      ? <Ionicons name={glyph} size={Math.round(size * 0.5)} color={color} />
      : <Text style={[styles.letter, { fontSize: Math.round(size * 0.48), lineHeight: Math.round(size * 0.56), color }]}>{letters[id] ?? name.trim().charAt(0).toLowerCase()}</Text>}
  </View>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  mutedTile: { backgroundColor: colors.surfaceAlt },
  letter: { fontWeight: '800', letterSpacing: -0.6, textAlign: 'center' },
}); }

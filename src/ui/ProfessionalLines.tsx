import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { isEmptyProfessional, ProfessionalProfile, professionalLines } from '../domain/professionalProfile';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text } from './Text';

/** The work side of a profile as plain lines under the bio (ADR 0018): no controls, nothing to learn. */
export function ProfessionalLines({ profile }: { profile?: ProfessionalProfile }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!profile || isEmptyProfessional(profile)) return null;
  const { headline, lines } = professionalLines(profile);
  return <View accessibilityLabel={['Professional profile', headline, ...lines].filter(Boolean).join('. ')} style={styles.block}>
    {headline ? <Text selectable style={styles.headline}>{headline}</Text> : null}
    {lines.map((line) => <Text key={line} selectable style={line === 'Open to work' || line === 'Hiring' ? styles.status : styles.line}>{line}</Text>)}
  </View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    block: { marginTop: 8, maxWidth: 520, alignItems: 'center', gap: 3 },
    headline: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21, textAlign: 'center' },
    status: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 19, textAlign: 'center' },
    line: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  });
}

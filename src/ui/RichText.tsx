import { useMemo } from 'react';
import { Linking, StyleProp, StyleSheet, TextStyle } from 'react-native';

import { mentionRef, tokenizeRichText } from '../domain/richText';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { usePeople } from './people';
import { Text } from './Text';

/**
 * Post text with links, @mentions and #hashtags highlighted the usual way, kept in the black-and-white
 * system: they take the text color and a semibold weight, and links add a quiet underline. Links open
 * in the browser, mentions open the person on the post's network, and hashtags open Search. When the
 * screen has nowhere to send a mention or hashtag, it stays styled text rather than a dead link.
 * It renders one Text, so callers can wrap it (for example with a translation note).
 */
export function RichText({ text, source, style, numberOfLines, selectable = true }: { text: string; source: string; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const people = usePeople();
  const tokens = useMemo(() => tokenizeRichText(text), [text]);
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={style}>
    {tokens.map((token, index) => {
      if (token.kind === 'text') return token.text;
      if (token.kind === 'link') return <Text key={index} accessibilityRole="link" accessibilityLabel={`Link: ${token.display}`} onPress={() => { Linking.openURL(token.url).catch(() => undefined); }} style={[styles.strong, styles.link]}>{token.display}</Text>;
      if (token.kind === 'mention') {
        const ref = mentionRef(token.handle, source);
        const open = ref && people ? () => people.open({ ref }) : undefined;
        return <Text key={index} {...(open ? { accessibilityRole: 'link' as const, accessibilityLabel: `Open ${token.text}’s profile`, onPress: open } : {})} style={styles.strong}>{token.text}</Text>;
      }
      const search = people?.search;
      return <Text key={index} {...(search ? { accessibilityRole: 'link' as const, accessibilityLabel: `Search ${token.text}`, onPress: () => search(token.text) } : {})} style={styles.strong}>{token.text}</Text>;
    })}
  </Text>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  strong: { color: colors.text, fontWeight: '600' },
  link: { textDecorationLine: 'underline', textDecorationColor: colors.textTertiary },
});

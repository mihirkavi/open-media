import { createContext, Fragment, useContext, useMemo } from 'react';
import { Linking, Platform, StyleProp, StyleSheet, TextStyle } from 'react-native';

import { mentionRef, tokenizeRichText } from '../domain/richText';
import { splitHighlights } from '../domain/searchHighlight';
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
/**
 * The words being searched for. Search provides them, and every piece of text under it marks them:
 * semibold on a soft wash of the text's own color. On the web the wash is mixed from the text color
 * itself, so it shows the same on light, dark and inverted (selected) rows; on phones it is a light
 * wash in dark mode and a dark one in light mode. It stays within the black-and-white system.
 */
export const SearchHighlight = createContext<string[]>([]);

const highlightBase = { fontWeight: '600' as const, borderRadius: 4 };

// React Native Web drops color-mix() from inline styles, so the web wash is one stylesheet rule
// keyed on a data attribute. Mixing from currentColor keeps it right on inverted (selected) rows.
const webMarkRule = `[data-search-mark]{font-weight:600;border-radius:4px;padding:0 2px;margin:0 -2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;background-color:rgba(128,128,128,.3)}
@supports (background-color:color-mix(in srgb,red 10%,transparent)){[data-search-mark]{background-color:color-mix(in srgb,currentColor 20%,transparent)}}`;
let webMarkInstalled = false;
function installWebMark() {
  if (webMarkInstalled || typeof document === 'undefined') return;
  webMarkInstalled = true;
  const style = document.createElement('style');
  style.textContent = webMarkRule;
  document.head.appendChild(style);
}

/** Props for a marked word: the shared stylesheet rule on the web, a theme wash on phones. */
export function useHighlightProps(): { style?: StyleProp<TextStyle>; dataSet?: Record<string, string> } {
  const { isDark } = useOpenMediaTheme();
  if (Platform.OS === 'web') { installWebMark(); return { dataSet: { searchMark: '' } }; }
  return { style: { ...highlightBase, backgroundColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.09)' } };
}

/** Plain text with the searched words marked. */
export function Highlighted({ text }: { text: string }) {
  const terms = useContext(SearchHighlight);
  const mark = useHighlightProps();
  if (!terms.length) return <>{text}</>;
  return <>{splitHighlights(text, terms).map((part, index) => part.match ? <Text key={index} {...(mark as object)}>{part.text}</Text> : <Fragment key={index}>{part.text}</Fragment>)}</>;
}

export function RichText({ text, source, style, numberOfLines, selectable = true }: { text: string; source: string; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const people = usePeople();
  const tokens = useMemo(() => tokenizeRichText(text), [text]);
  const terms = useContext(SearchHighlight);
  const mark = useHighlightProps();
  // A link, mention or hashtag holding a searched word is marked whole.
  const marked = (value: string) => terms.length > 0 && splitHighlights(value, terms).some((part) => part.match);
  const markIf = (value: string) => (marked(value) ? { dataSet: mark.dataSet } : {});
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={style}>
    {tokens.map((token, index) => {
      if (token.kind === 'text') return <Highlighted key={index} text={token.text} />;
      if (token.kind === 'link') return <Text key={index} {...(markIf(token.display) as object)} accessibilityRole="link" accessibilityLabel={`Link: ${token.display}`} onPress={() => { Linking.openURL(token.url).catch(() => undefined); }} style={[styles.strong, styles.link, marked(token.display) && mark.style]}>{token.display}</Text>;
      if (token.kind === 'mention') {
        const ref = mentionRef(token.handle, source);
        const open = ref && people ? () => people.open({ ref }) : undefined;
        return <Text key={index} {...(markIf(token.text) as object)} {...(open ? { accessibilityRole: 'link' as const, accessibilityLabel: `Open ${token.text}’s profile`, onPress: open } : {})} style={[styles.strong, marked(token.text) && mark.style]}>{token.text}</Text>;
      }
      const search = people?.search;
      return <Text key={index} {...(markIf(token.text) as object)} {...(search ? { accessibilityRole: 'link' as const, accessibilityLabel: `Search ${token.text}`, onPress: () => search(token.text) } : {})} style={[styles.strong, marked(token.text) && mark.style]}>{token.text}</Text>;
    })}
  </Text>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  strong: { color: colors.text, fontWeight: '600' },
  link: { textDecorationLine: 'underline', textDecorationColor: colors.textTertiary },
});

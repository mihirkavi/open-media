import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleProp, StyleSheet, TextStyle } from 'react-native';

import { setTranslationPreferences, subscribeTranslationPreferences, translateText, translationPreferences, TranslationPrivacy } from '../data/translationService';
import { toggleOriginal, TranslatedItem, translationDisplay, translationSource } from '../domain/translation';
import { useOpenMediaTheme } from '../themeContext';
import { Text } from './Text';

export function useTranslationPreferences() {
  const preferences = useSyncExternalStore(subscribeTranslationPreferences, translationPreferences, translationPreferences);
  return { preferences, setPreferences: setTranslationPreferences };
}

/** Items the reader switched back to the original. Shared, so the choice survives list recycling. */
let showingOriginal: ReadonlySet<string> = new Set();
const originalListeners = new Set<() => void>();
const subscribeOriginal = (listener: () => void) => { originalListeners.add(listener); return () => { originalListeners.delete(listener); }; };
const originalSnapshot = () => showingOriginal;

export interface TranslationNoteProps { label: string; accessibilityLabel: string; onPress: () => void }

/**
 * The texts of one item (a post's title and body, a message, a comment), translated into the
 * reader's language when the device detects another one. The note is the only control: it says
 * what was translated and switches between the translation and the original.
 */
export function useTranslation(id: string, texts: string[], privacy: TranslationPrivacy = 'public'): { texts: string[]; note?: TranslationNoteProps } {
  const { preferences } = useTranslationPreferences();
  const original = useSyncExternalStore(subscribeOriginal, originalSnapshot, originalSnapshot).has(id);
  const joined = texts.join('\u0000');
  // One language for the whole item: a short title alone is often too short to tell.
  const source = useMemo(() => preferences.auto ? translationSource(texts.join('\n\n'), preferences.target) : undefined, [joined, preferences.auto, preferences.target]); // eslint-disable-line react-hooks/exhaustive-deps
  const [translated, setTranslated] = useState<{ key: string; items: Array<TranslatedItem | undefined> }>();
  const key = `${source}:${preferences.target}:${joined}`;
  useEffect(() => {
    if (!source) return;
    let current = true;
    Promise.all(texts.map((text) => text.trim() ? translateText(text, source, preferences.target, privacy) : Promise.resolve(undefined)))
      .then((items) => { if (current) setTranslated({ key, items }); });
    return () => { current = false; };
  }, [key, privacy]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = source && translated?.key === key ? translated.items : [];
  const displays = texts.map((text, index) => translationDisplay(text, items[index], original));
  const note = displays.find((display) => display.note)?.note;
  return {
    texts: displays.map((display) => display.text),
    note: note ? { ...note, onPress: () => { showingOriginal = toggleOriginal(showingOriginal, id); originalListeners.forEach((notify) => notify()); } } : undefined,
  };
}

/** The quiet "Translated from Spanish · Show original" line under translated text. */
export function TranslationNote({ note, style }: { note?: TranslationNoteProps; style?: StyleProp<TextStyle> }) {
  const { colors } = useOpenMediaTheme();
  if (!note) return null;
  return <Text accessibilityRole="button" accessibilityLabel={note.accessibilityLabel} onPress={note.onPress} suppressHighlighting style={[styles.note, { color: colors.textTertiary }, style]}>{note.label}</Text>;
}

const styles = StyleSheet.create({ note: { fontSize: 12, lineHeight: 16, marginTop: 4, alignSelf: 'flex-start' } });

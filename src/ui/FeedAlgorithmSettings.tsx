import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { describeLensRules, forbiddenSignals } from '../domain/feedLenses';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { LensRow, useLensRows } from './SearchView';
import type { FeedLenses } from './useFeedLenses';

const examples = 'more videos, less hive, only people I follow, mute crypto';

/**
 * Settings → Feed → Your algorithm (ADR 0021, section 9). The builder prompt puts Feed and
 * Algorithms in Settings (section 20) and asks for plain words with a confirmation (section 22), so
 * this is a field for writing the algorithm in words. It shows the rules of the lens in use, and the
 * same rows Search offers for the words typed: choosing one is the confirmation that saves it.
 */
export function FeedAlgorithmSettings({ lenses, signedIn }: { lenses: FeedLenses; signedIn: boolean }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [words, setWords] = useState('');
  const [saved, setSaved] = useState('');
  const rows = useLensRows(words, lenses, signedIn);
  const base = lenses.lens.builtIn ? lenses.tuneBase : lenses.lens;
  const run = (row: LensRow) => {
    row.run().then((done) => {
      if (!done) return;
      setWords('');
      setSaved(`Saved. Your Feed now uses this.${signedIn ? ' Type “undo” to go back.' : ''}`);
    }).catch((reason) => setSaved(reason instanceof Error ? reason.message : 'That didn’t save. Try again.'));
  };
  const typed = words.trim().length >= 3;

  return <View style={styles.box}>
    <Text style={styles.title}>Your algorithm</Text>
    <Text style={styles.copy}>Write what you want to see, in your own words. The Feed changes only after you choose the change below.</Text>
    <View style={styles.current}>
      <Text style={styles.currentName}>{lenses.lens.name}{base.id !== lenses.lens.id ? ` · your changes are kept in ${base.name}` : ''}</Text>
      {describeLensRules(lenses.lens).map((rule) => <Text key={rule} style={styles.rule}>· {rule}</Text>)}
    </View>
    <TextInput accessibilityLabel="Write your feed algorithm" value={words} onChangeText={(text) => { setWords(text); setSaved(''); }} placeholder={examples} placeholderTextColor={colors.textTertiary} multiline autoCorrect={false} autoCapitalize="none" blurOnSubmit returnKeyType="done" onSubmitEditing={() => { if (rows[0]) run(rows[0]); }} style={styles.input} />
    {rows.length ? <View style={styles.rows}>
      {rows.map((row) => <Pressable key={row.key} accessibilityRole="button" onPress={() => run(row)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <Ionicons name="options-outline" size={17} color={colors.text} />
        <View style={styles.rowCopy}><Text style={styles.rowTitle}>{row.title}</Text><Text style={styles.rowSubtitle}>{row.subtitle}</Text></View>
      </Pressable>)}
    </View> : null}
    {typed && !rows.length ? <Text style={styles.hint}>Not understood yet. Try words like “{examples.split(', ').slice(0, 2).join('”, “')}”, “a bit more about design”, “newest first” or “undo”.</Text> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>{saved}</Text> : null}
    <Text style={styles.hint}>Never used by any algorithm: {forbiddenSignals.map((signal) => (/^[A-Z][a-z]/.test(signal) ? signal[0].toLocaleLowerCase() + signal.slice(1) : signal)).join(', ')}.</Text>
  </View>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  box: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  copy: { marginTop: 3, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  current: { marginTop: 12, padding: 12, gap: 3, borderRadius: 12, backgroundColor: colors.chrome },
  currentName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  rule: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  input: { minHeight: 76, marginTop: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: colors.text, fontSize: 15, lineHeight: 21, textAlignVertical: 'top', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, outlineStyle: 'none' } as object,
  rows: { marginTop: 8, gap: 2 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surfaceAlt },
  rowPressed: { opacity: 0.7 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSubtitle: { marginTop: 2, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  hint: { marginTop: 10, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  saved: { marginTop: 10, color: colors.text, fontSize: 13, fontWeight: '600' },
}); }

import Ionicons from './Icon';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { describeLensRules, FeedLens, forbiddenSignals, lensFromRequest, looksLikeLensRequest, looksLikeTuneRequest, tuneLens } from '../domain/feedLenses';
import { changedLines, lensImpact, lensSource, SourceLine, sourceDiff } from '../domain/lensSource';
import { SocialPost } from '../domain/posts';
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
 *
 * Section 10: the algorithm is shown as what it is, its manifest, so nothing about it is hidden.
 * Typing shows the exact lines the words would change and what that does to the top of the person's
 * own Feed, before they choose it; saving says whether the account kept it, and which version.
 */
export function FeedAlgorithmSettings({ lenses, signedIn, posts = [] }: { lenses: FeedLenses; signedIn: boolean; posts?: SocialPost[] }) {
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
  // The lens these words would make: a change to the one in use, or a new one.
  const candidate = useMemo<FeedLens | undefined>(() => {
    const value = words.trim();
    if (value.length < 3 || !(looksLikeTuneRequest(value) || looksLikeLensRequest(value))) return undefined;
    const tuned = tuneLens(lenses.tuneBase, value);
    if (tuned.changes.length) return tuned.lens;
    const draft = lensFromRequest(value);
    return draft.understood.length ? draft.lens : undefined;
  }, [words, lenses.tuneBase]);
  const diff = useMemo(() => candidate ? changedLines(sourceDiff(lensSource(lenses.lens), lensSource(candidate))) : [], [candidate, lenses.lens]);
  const impact = useMemo(() => candidate && posts.length ? lensImpact(posts, lenses.lens, candidate, lenses.context) : [], [candidate, posts, lenses.lens, lenses.context]);
  const status = lenses.saveStatus?.lensId === lenses.lens.id ? lenses.saveStatus : undefined;

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
    {candidate && diff.length ? <View style={styles.preview}>
      <Text style={styles.previewTitle}>What this changes</Text>
      {posts.length ? <Text style={styles.impact}>{impact.length ? `Top 20 of your Feed: ${impact.slice(0, 4).map((shift) => `${shift.network} ${shift.before} → ${shift.after}`).join(' · ')}` : 'Top 20 of your Feed: the same posts, in a different order.'}</Text> : null}
      <Code lines={diff} />
    </View> : null}
    {typed && !rows.length ? <Text style={styles.hint}>Not understood yet. Try words like “{examples.split(', ').slice(0, 2).join('”, “')}”, “a bit more about design”, “newest first” or “undo”.</Text> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>{saved}</Text> : null}
    {status?.state === 'saving' ? <Text style={styles.hint}>Saving to your account…</Text> : null}
    {status?.state === 'saved' ? <Text style={styles.hint}>Saved to your account as version {status.version}. Your agents and other devices use it too.</Text> : null}
    {status?.state === 'failed' ? <Text accessibilityRole="alert" style={styles.failed}>Not saved to your account: {status.message} It works on this device until it saves.</Text> : null}
    {status?.state === 'device' ? <Text style={styles.hint}>Saved on this device. Sign in to keep it in your account.</Text> : null}
    <Text style={styles.codeTitle}>The code that runs your Feed · {lenses.lens.name}{lenses.lens.builtIn ? '' : ` · version ${lenses.lens.version}`}</Text>
    <Text style={styles.hint}>This manifest is the whole algorithm: Open Media's runner reads it and nothing else. Agents can read and change it too.</Text>
    <Code lines={lensSource(lenses.lens).split('\n').map((text) => ({ kind: 'same' as const, text }))} />
    <Text style={styles.hint}>Never used by any algorithm: {forbiddenSignals.map((signal) => (/^[A-Z][a-z]/.test(signal) ? signal[0].toLocaleLowerCase() + signal.slice(1) : signal)).join(', ')}.</Text>
  </View>;
}

/** A manifest or a patch, in a monospace block; added lines are marked +, removed ones − and struck through. */
function Code({ lines }: { lines: SourceLine[] }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <ScrollView horizontal style={styles.code} contentContainerStyle={styles.codeContent}>
    <View>
      {lines.map((line, index) => <Text key={index} selectable style={[styles.codeLine, line.kind === 'add' && styles.codeAdd, line.kind === 'remove' && styles.codeRemove]}>
        {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '− ' : lines.some((item) => item.kind !== 'same') ? '  ' : ''}{line.text}
      </Text>)}
    </View>
  </ScrollView>;
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
  failed: { marginTop: 10, color: colors.danger, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  preview: { marginTop: 10, gap: 6 },
  previewTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  impact: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  codeTitle: { marginTop: 18, color: colors.text, fontSize: 13, fontWeight: '700' },
  code: { marginTop: 8, borderRadius: 12, backgroundColor: colors.chrome },
  codeContent: { padding: 12 },
  codeLine: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  codeAdd: { color: colors.text, fontWeight: '600' },
  codeRemove: { color: colors.textTertiary, textDecorationLine: 'line-through' },
}); }

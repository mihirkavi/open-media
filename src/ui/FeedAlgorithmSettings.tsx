import Ionicons from './Icon';
import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { describeLensRules, FeedLens, forbiddenSignals, lensFromRequest, looksLikeLensRequest, looksLikeTuneRequest, tuneLens } from '../domain/feedLenses';
import { changedLines, lensImpact, lensSource, SourceLine, sourceDiff } from '../domain/lensSource';
import { sourceRepository } from '../domain/about';
import { SocialPost } from '../domain/posts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { LensRow, useLensRows } from './SearchView';
import type { FeedLenses } from './useFeedLenses';

const examples = 'more videos, less hive, only people I follow, mute crypto';

/**
 * Settings › Your algorithm (ADR 0021, section 9). The builder prompt puts Feed and
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

  const [showCode, setShowCode] = useState(false);
  const weights = useMemo(() => rankingWeights(lenses.lens), [lenses.lens]);
  // Filters and boosts as short chips; the weights are drawn as bars instead of a sentence.
  const rules = describeLensRules(lenses.lens).filter((rule) => !/^Ranked by |^Newest first$/.test(rule));

  return <View>
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel}>Your feed now</Text>
        <Text style={styles.lensName}>{lenses.lens.name}{lenses.lens.builtIn ? '' : ` · v${lenses.lens.version}`}</Text>
      </View>
      {lenses.lens.order === 'newest'
        ? <Text style={styles.copy}>Newest first. Nothing is ranked or hidden by a score.</Text>
        : <View accessible accessibilityLabel={`Ranked by ${weights.map((item) => `${item.label} ${item.percent}%`).join(', ')}`} style={styles.bars}>
          {weights.map((item) => <View key={item.label} style={styles.barRow}>
            <Text style={styles.barLabel}>{item.label}</Text>
            <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(item.percent, 3)}%` }]} /></View>
            <Text style={styles.barValue}>{item.percent}%</Text>
          </View>)}
        </View>}
      {rules.length ? <View style={styles.chips}>{rules.map((rule) => <Text key={rule} style={styles.chip}>{rule}</Text>)}</View> : null}
      {base.id !== lenses.lens.id ? <Text style={styles.hint}>Your changes are kept in {base.name}.</Text> : null}
    </View>

    <Text style={styles.sectionLabel}>Change it in your own words</Text>
    <TextInput accessibilityLabel="Write your feed algorithm" value={words} onChangeText={(text) => { setWords(text); setSaved(''); }} placeholder={examples} placeholderTextColor={colors.textTertiary} multiline autoCorrect={false} autoCapitalize="none" blurOnSubmit returnKeyType="done" onSubmitEditing={() => { if (rows[0]) run(rows[0]); }} style={styles.input} />
    {!typed ? <Text style={styles.hint}>Nothing changes until you choose the change that appears here. Type “undo” to go back a version.</Text> : null}
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

    <Text style={styles.sectionLabel}>Open and inspectable</Text>
    <View style={styles.links}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCode }} onPress={() => setShowCode((value) => !value)} style={({ pressed }) => [styles.linkRow, pressed && styles.rowPressed]}>
        <Ionicons name="code-slash-outline" size={18} color={colors.text} />
        <View style={styles.rowCopy}><Text style={styles.rowTitle}>{showCode ? 'Hide the code' : 'Show the code'}</Text><Text style={styles.rowSubtitle}>The manifest for {lenses.lens.name}: the whole algorithm, nothing else is read.</Text></View>
        <Ionicons name={showCode ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textTertiary} />
      </Pressable>
      {showCode ? <View style={styles.codeWrap}><Code lines={lensSource(lenses.lens).split('\n').map((text) => ({ kind: 'same' as const, text }))} /></View> : null}
      <Pressable accessibilityRole="link" accessibilityHint="Opens GitHub" onPress={() => { Linking.openURL(runnerSourceUrl).catch(() => undefined); }} style={({ pressed }) => [styles.linkRow, styles.linkDivider, pressed && styles.rowPressed]}>
        <Ionicons name="logo-github" size={18} color={colors.text} />
        <View style={styles.rowCopy}><Text style={styles.rowTitle}>How the runner works</Text><Text style={styles.rowSubtitle}>runLens in src/domain/feedLenses.ts, open source on GitHub</Text></View>
        <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
      </Pressable>
    </View>
    <Text style={styles.hint}>Never used by any algorithm: {forbiddenSignals.map((signal) => (/^[A-Z][a-z]/.test(signal) ? signal[0].toLocaleLowerCase() + signal.slice(1) : signal)).join(', ')}.</Text>
  </View>;
}

/** Where the code that runs every lens lives, for anyone who wants to check it. */
const runnerSourceUrl = `${sourceRepository}/blob/main/src/domain/feedLenses.ts`;

/** The ranking weights as shares of 100, largest first, in the words people use. */
function rankingWeights(lens: FeedLens) {
  const { objectives } = lens;
  const parts: [number, string][] = [[objectives.recency, 'Newer posts'], [objectives.follows, 'People you follow'], [objectives.interests, lens.interests.length ? `Topics: ${lens.interests.slice(0, 3).join(', ')}` : 'Your topics'], [objectives.engagement, 'Likes and reposts'], [objectives.discovery ?? 0, 'New voices']];
  const total = parts.reduce((sum, [weight]) => sum + weight, 0) || 1;
  return parts.filter(([weight]) => weight > 0).map(([weight, label]) => ({ label, percent: Math.round((weight / total) * 100) })).sort((a, b) => b.percent - a.percent);
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
  card: { marginTop: 14, padding: 16, gap: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  cardLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  lensName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  copy: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  bars: { gap: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 128, color: colors.text, fontSize: 13, fontWeight: '500' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.chrome },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.text },
  barValue: { width: 38, textAlign: 'right', color: colors.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', backgroundColor: colors.chrome, color: colors.text, fontSize: 12, fontWeight: '600' },
  sectionLabel: { marginTop: 26, marginBottom: 8, marginLeft: 4, color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: { minHeight: 76, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: colors.text, fontSize: 15, lineHeight: 21, textAlignVertical: 'top', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt, outlineStyle: 'none' } as object,
  rows: { marginTop: 8, gap: 4 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.chrome },
  rowPressed: { opacity: 0.7 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSubtitle: { marginTop: 2, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  links: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  linkRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  linkDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  codeWrap: { paddingHorizontal: 12, paddingBottom: 12 },
  hint: { marginTop: 10, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  saved: { marginTop: 10, color: colors.text, fontSize: 13, fontWeight: '600' },
  failed: { marginTop: 10, color: colors.danger, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  preview: { marginTop: 10, gap: 6 },
  previewTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  impact: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  code: { borderRadius: 12, backgroundColor: colors.chrome },
  codeContent: { padding: 12 },
  codeLine: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  codeAdd: { color: colors.text, fontWeight: '600' },
  codeRemove: { color: colors.textTertiary, textDecorationLine: 'line-through' },
}); }

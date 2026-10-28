import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { searchSharedLenses, StoredLens } from '../data/lensService';
import { lensFromRequest, lensSummary, looksLikeLensRequest } from '../domain/feedLenses';
import { Conversation } from '../domain/models';
import { networks, sourceName } from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { conversationTitle } from '../domain/selectors';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { FeedViewer, PostCard } from './OpenMediaFeed';
import type { FeedLenses } from './useFeedLenses';
import { useUniversalSearch } from './useUniversalSearch';

export type SearchTarget = 'feed' | 'messages' | 'settings';

const suggestions = ['videos about cooking today', 'ethereum on lens', 'only videos from people I follow', 'dark mode'];

/**
 * Universal search: everything Open Media knows plus public posts across every network, with a
 * basic AI summary. Messages and email are matched on this device only.
 */
export function SearchView({ posts, conversations, viewer, lenses, onNavigate, onClose }: { posts: SocialPost[]; conversations: Conversation[]; viewer?: FeedViewer; lenses?: FeedLenses; onNavigate?: (target: SearchTarget) => void; onClose?: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const search = useUniversalSearch(query, posts, conversations);
  const byId = useMemo(() => new Map(search.posts.map((post) => [post.id, post])), [search.posts]);
  const hasQuery = Boolean(search.parsed.raw);
  const lensRows = useLensRows(search.parsed.raw, lenses, Boolean(viewer));
  const nothing = hasQuery && !search.searching && !search.posts.length && !search.settings.length && !search.messages.length && !lensRows.length;
  // Choosing a lens shows the Feed through it.
  const showFeed = () => { if (onNavigate) onNavigate('feed'); else onClose?.(); };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <View style={styles.titleRow}>
      {onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={onClose} style={styles.close}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable> : null}
      <Text style={styles.title}>Search</Text>
    </View>
    <Text style={styles.subtitle}>People, posts on every network, Clips, messages, email, and settings, in one place.</Text>
    <View style={styles.field}>
      <Ionicons name="search" size={18} color={colors.textSecondary} />
      <TextInput accessibilityLabel="Search everything" autoFocus value={query} onChangeText={setQuery} placeholder="Search everything" placeholderTextColor={colors.textTertiary} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} style={styles.input} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.clear}><Ionicons name="close-circle" size={18} color={colors.textTertiary} /></Pressable> : null}
    </View>

    {!hasQuery ? <View style={styles.block}>
      <Text style={styles.sectionLabel}>Try</Text>
      <View style={styles.chips}>{suggestions.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setQuery(item)} style={styles.chip}><Text style={styles.chipText}>{item}</Text></Pressable>)}</View>
      <Text style={styles.note}>Write naturally: “videos”, “on Lens”, or “today” narrow the search. Messages and email are searched on this device only.</Text>
    </View> : null}

    {hasQuery && search.parsed.understood.length ? <Text style={styles.understood}>Understood: {search.parsed.understood.join(' · ')}{search.parsed.text ? ` · “${search.parsed.text}”` : ''}</Text> : null}

    {search.ai.status === 'loading' || search.ai.status === 'done' || search.ai.status === 'failed' ? <View accessibilityLiveRegion="polite" style={styles.ai}>
      <View style={styles.aiHeader}><Ionicons name="sparkles-outline" size={16} color={colors.text} /><Text style={styles.aiTitle}>AI summary</Text></View>
      {search.ai.status === 'loading' ? <View style={styles.aiRow}><ActivityIndicator color={colors.text} /><Text style={styles.aiText}>Summarizing public posts…</Text></View> : null}
      {search.ai.status === 'failed' ? <Text style={styles.note}>{search.ai.message}</Text> : null}
      {search.ai.status === 'done' ? <>
        <Text selectable style={styles.aiText}>{search.ai.answer}</Text>
        {search.ai.citations.length ? <Text style={styles.note}>Sources: {search.ai.citations.map((id, index) => { const post = byId.get(id); return post ? `${post.author.handle} on ${sourceName(post.provenance.connectorId)}` : `post ${index + 1}`; }).join(' · ')}</Text> : null}
        <Text style={styles.note}>Written by AI from {search.ai.basedOn} public posts below; it can be wrong. Only your search and those public posts were sent.</Text>
      </> : null}
    </View> : null}

    {lensRows.length ? <Section title="Feed" styles={styles}>{lensRows.map((row) => <Row key={row.key} icon="options-outline" title={row.title} subtitle={row.subtitle} onPress={() => { row.run().then((leave) => { if (leave) showFeed(); }).catch(() => undefined); }} styles={styles} colors={colors} />)}</Section> : null}

    {search.settings.length ? <Section title="Settings" styles={styles}>{search.settings.map((setting) => <Row key={setting.id} icon="settings-outline" title={setting.title} subtitle={setting.description} onPress={() => onNavigate?.('settings')} styles={styles} colors={colors} />)}</Section> : null}

    {search.messages.length ? <Section title="Messages and email · on this device" styles={styles}>{search.messages.map((conversation) => <Row key={conversation.id} icon="chatbubble-outline" title={conversationTitle(conversation)} subtitle={conversation.preview} onPress={() => onNavigate?.('messages')} styles={styles} colors={colors} />)}</Section> : null}

    {hasQuery && search.sources.length ? <View style={styles.block}>
      <Text style={styles.sectionLabel}>Posts from everywhere</Text>
      <Text style={styles.note}>{search.sources.filter((source) => source.status !== 'skipped').map((source) => `${networks[source.id].displayName}: ${source.status === 'searching' ? 'searching…' : source.status === 'failed' ? 'unavailable' : `${source.count} (${source.method})`}`).join(' · ')}</Text>
    </View> : null}
    {search.posts.map((post) => <PostCard key={post.id} post={post} mode="raw" viewer={viewer} />)}
    {hasQuery && search.searching && !search.posts.length ? <View style={styles.status}><ActivityIndicator color={colors.text} /></View> : null}
    {nothing ? <Text style={styles.empty}>Nothing found. Try fewer or different words.</Text> : null}
  </ScrollView>;
}

interface LensRow { key: string; title: string; subtitle: string; run: () => Promise<boolean> }

const managePattern = /^(remove|delete|uninstall|forget|drop|share|publish|use|switch to|show me|open)\b/i;

/**
 * Search is where people talk to the Feed (ADR 0017): a request like “only videos from people I
 * follow, no crypto” becomes one result row showing the lens it understood, and choosing the row
 * switches the Feed to it. Saved lenses can be switched to, shared or removed by name, and lenses
 * other people shared are offered for the same words. No other control exists for lenses.
 */
function useLensRows(query: string, lenses: FeedLenses | undefined, signedIn: boolean): LensRow[] {
  const [shared, setShared] = useState<StoredLens[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const value = query.trim();
  const lower = value.toLocaleLowerCase();
  const wantsLens = value.length > 3 && (looksLikeLensRequest(value) || /\b(lenses|feeds|algorithms?)\b/i.test(value));
  useEffect(() => {
    setShared([]);
    if (!lenses || !wantsLens) return;
    let active = true;
    const words = lower.replace(/\b(shared|public|lenses?|feeds?|algorithms?|find|show|me|a|an|the|some|for|of)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const timer = setTimeout(() => { searchSharedLenses(words.split(' ').slice(-2).join(' ')).then((found) => { if (active) setShared(found); }).catch(() => undefined); }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [lower, wantsLens, lenses]);
  return useMemo(() => {
    if (!lenses || value.length < 3) return [];
    const rows: LensRow[] = [];
    const named = lenses.lenses.filter((lens) => lower.includes(lens.name.toLocaleLowerCase()));
    const action = lower.match(managePattern)?.[1];
    for (const lens of named) {
      const custom = !lens.builtIn;
      if (action && /^(remove|delete|uninstall|forget|drop)$/.test(action) && custom) {
        rows.push({ key: `remove-${lens.id}`, title: `Remove “${lens.name}” from Feed`, subtitle: lensSummary(lens), run: async () => { lenses.remove(lens.id); return true; } });
      } else if (action && /^(share|publish)$/.test(action) && custom) {
        const shareStatus = status[lens.id];
        rows.push({
          key: `share-${lens.id}`, title: `Share “${lens.name}” publicly`,
          subtitle: shareStatus ?? (signedIn ? 'Anyone with the link can read, install and change a copy. Your handle is shown unless your account is private.' : 'Sign in to share a lens.'),
          run: async () => {
            if (!signedIn) return false;
            try {
              const url = await lenses.share(lens.id);
              if (Platform.OS === 'web') {
                await navigator.clipboard?.writeText(url).catch(() => undefined);
                setStatus((existing) => ({ ...existing, [lens.id]: `Shared. Link copied: ${url}` }));
              } else {
                setStatus((existing) => ({ ...existing, [lens.id]: `Shared: ${url}` }));
                await Share.share({ message: url, url }).catch(() => undefined);
              }
            } catch (reason) { setStatus((existing) => ({ ...existing, [lens.id]: reason instanceof Error ? reason.message : 'That didn’t work. Try again.' })); }
            return false;
          },
        });
      } else if (lenses.lens.id !== lens.id && (action || lower === lens.name.toLocaleLowerCase() || /\b(feed|lens)\b/.test(lower))) {
        rows.push({ key: `use-${lens.id}`, title: `Show the Feed through ${lens.name}`, subtitle: lensSummary(lens), run: async () => { lenses.choose(lens.id); return true; } });
      }
    }
    if (!action || /^(show me|use)$/.test(action)) {
      if (!rows.length && looksLikeLensRequest(value)) {
        const draft = lensFromRequest(value);
        const understood = draft.understood.length ? `Understood: ${draft.understood.join(' · ')}` : lensSummary(draft.lens);
        const unused = draft.unused.length ? ` · Not used: ${draft.unused.join(', ')}` : '';
        const onlyInterests = draft.lens.interests.length && !Object.keys(draft.lens.filters).length && draft.lens.order === 'ranked';
        if (onlyInterests) {
          rows.push({ key: 'interests', title: `Show more ${draft.lens.interests.join(', ')} in Relevant`, subtitle: 'Relevant lifts posts that mention these words. Nothing else about you is used.', run: async () => { lenses.addInterests(draft.lens.interests); lenses.choose('relevant'); return true; } });
        } else if (draft.understood.length) {
          rows.push({ key: 'draft', title: `Show the Feed as “${draft.lens.name}”`, subtitle: `${understood}${unused}`, run: async () => { lenses.apply(draft.lens); return true; } });
        }
      }
      for (const item of shared.filter((entry) => !lenses.lenses.some((lens) => lens.id === entry.lens.id)).slice(0, 3)) {
        rows.push({ key: `shared-${item.rowId}`, title: `Use “${item.lens.name}”${item.lens.author ? ` by ${item.lens.author}` : ''}`, subtitle: `${lensSummary(item.lens)}${item.installs ? ` · ${item.installs} ${item.installs === 1 ? 'person uses' : 'people use'} it` : ''}`, run: async () => { lenses.apply({ ...item.lens, author: undefined }, item.rowId); return true; } });
      }
    }
    return rows;
  }, [value, lower, lenses, shared, status, signedIn]);
}

function Section({ title, children, styles }: React.PropsWithChildren<{ title: string; styles: ReturnType<typeof createStyles> }>) {
  return <View style={styles.block}><Text style={styles.sectionLabel}>{title}</Text><View style={styles.card}>{children}</View></View>;
}

function Row({ icon, title, subtitle, onPress, styles, colors }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; onPress: () => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={17} color={colors.text} /></View>
    <View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{title}</Text><Text numberOfLines={2} style={styles.rowSubtitle}>{subtitle}</Text></View>
    <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
  </Pressable>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 24, paddingBottom: 80 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  close: { width: 36, height: 36, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { marginTop: 5, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  field: { minHeight: 48, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  input: { flex: 1, minHeight: 46, color: colors.text, fontSize: 16, letterSpacing: 0, paddingVertical: 0, outlineStyle: 'none' } as object,
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  block: { marginTop: 18, gap: 8 },
  sectionLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 13 },
  note: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  understood: { marginTop: 12, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  ai: { marginTop: 16, gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.chrome },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.chrome },
  rowCopy: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSubtitle: { marginTop: 2, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  status: { alignItems: 'center', paddingVertical: 30 },
  empty: { marginTop: 24, color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
}); }

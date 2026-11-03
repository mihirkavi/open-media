import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { citedAnswer } from '../domain/aiCitations';
import { LensVersion, searchSharedLenses, StoredLens } from '../data/lensService';
import { loadProfessionalProfile, saveProfessionalProfile } from '../data/openMediaService';
import { builtInLensFor, lensFromRequest, lensSummary, looksLikeLensRequest, looksLikeTuneRequest, ownCopyId, relevantLens, tuneLens } from '../domain/feedLenses';
import { Conversation } from '../domain/models';
import { networks, sourceName } from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { applyProfessionalIntent, emptyProfessional, professionalIntent } from '../domain/professionalProfile';
import { recentSearchesKey, rememberSearch } from '../domain/recentSearches';
import { formatEmailBody } from '../domain/emailBody';
import { highlightTerms, snippetAround } from '../domain/searchHighlight';
import { conversationTitle } from '../domain/selectors';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { AiMark } from './AiMark';
import { FeedViewer, PostCard } from './OpenMediaFeed';
import { Highlighted, SearchHighlight } from './RichText';
import type { FeedLenses } from './useFeedLenses';
import { useUniversalSearch } from './useUniversalSearch';

export type SearchTarget = 'feed' | 'messages' | 'settings';

const suggestions = ['videos about cooking today', 'ethereum on lens', 'only videos from people I follow', 'dark mode'];

/** One result Search can open: chosen with a tap, or with ↑ ↓ and Return. */
interface ResultItem { key: string; section: string; icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; run: () => void }

/**
 * Universal search: everything Open Media knows plus public posts across every network, with a
 * basic AI summary. Messages and email are matched on this device only. Laid out like Spotlight:
 * one large field, then grouped results with the first one ready to open with Return.
 */
export function SearchView({ posts, conversations, viewer, lenses, onNavigate, onOpenConversation, onClose, onDismiss, initialQuery = '' }: { posts: SocialPost[]; conversations: Conversation[]; viewer?: FeedViewer; lenses?: FeedLenses; onNavigate?: (target: SearchTarget) => void; onOpenConversation?: (id: string) => void; onClose?: () => void; /** Esc on an empty field: back to where the person was. */ onDismiss?: () => void; initialQuery?: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState(initialQuery);
  // A hashtag tapped in a post opens Search with it filled in.
  useEffect(() => { if (initialQuery) setQuery(initialQuery); }, [initialQuery]);
  const search = useUniversalSearch(query, posts, conversations);
  const byId = useMemo(() => new Map(search.posts.map((post) => [post.id, post])), [search.posts]);
  const hasQuery = Boolean(search.parsed.raw);
  const lensRows = useLensRows(search.parsed.raw, lenses, Boolean(viewer));
  const profileRows = useProfileRows(query, Boolean(viewer));
  const nothing = hasQuery && !search.searching && !search.posts.length && !search.settings.length && !search.messages.length && !lensRows.length && !profileRows.length;
  // Choosing a lens shows the Feed through it.
  const showFeed = () => { if (onNavigate) onNavigate('feed'); else onClose?.(); };

  const recent = useRecentSearches(viewer?.id);
  const terms = useMemo(() => highlightTerms(search.parsed.keywords), [search.parsed.keywords]);
  // A message result shows the words that matched, not just the conversation's last line.
  const matchingLine = (conversation: Conversation) => {
    const has = (text: string | undefined) => Boolean(text) && terms.some((term) => text!.toLocaleLowerCase().includes(term));
    const newest = [...conversation.messages].reverse();
    // Email replies quote what came before; the excerpt comes from what each person wrote.
    const own = (text: string) => conversation.email ? formatEmailBody(text).plain : text;
    const body = newest.map((item) => own(item.body)).find(has);
    return body ? snippetAround(body, terms) : newest.find((item) => has(item.emailContext?.subject))?.emailContext?.subject ?? conversation.preview;
  };
  const [focused, setFocused] = useState(false);
  // Opening a result remembers the search, so it is offered again next time.
  const remember = (run: () => void) => () => { recent.add(query); run(); };
  const items: ResultItem[] = (hasQuery ? [
    ...lensRows.map((row) => ({ key: row.key, section: 'Feed', icon: 'options-outline' as const, title: row.title, subtitle: row.subtitle, run: () => { row.run().then((leave) => { if (leave) showFeed(); }).catch(() => undefined); } })),
    ...profileRows.map((row) => ({ key: row.key, section: 'Your profile', icon: 'briefcase-outline' as const, title: row.title, subtitle: row.subtitle, run: () => { row.run().catch(() => undefined); } })),
    ...search.settings.map((setting) => ({ key: setting.id, section: 'Settings', icon: 'settings-outline' as const, title: setting.title, subtitle: setting.description, run: () => onNavigate?.('settings') })),
    ...search.messages.map((conversation) => ({ key: conversation.id, section: 'Messages and email', icon: (conversation.email ? 'mail-outline' : 'chatbubble-outline') as keyof typeof Ionicons.glyphMap, title: conversationTitle(conversation), subtitle: matchingLine(conversation), run: () => onOpenConversation ? onOpenConversation(conversation.id) : onNavigate?.('messages') })),
  ].map((item) => ({ ...item, run: remember(item.run) })) : [
    ...recent.list.map((item) => ({ key: `recent-${item}`, section: 'Recent', icon: 'time-outline' as const, title: item, run: () => setQuery(item) })),
    ...suggestions.filter((item) => !recent.list.includes(item)).map((item) => ({ key: item, section: 'Try', icon: 'search-outline' as const, title: item, run: () => setQuery(item) })),
  ]);

  // With a keyboard the first result is the top hit: ↑ and ↓ move, Return opens it. Esc clears the
  // field, and on an empty field goes back. Touch screens have no Return key, so nothing is preselected.
  const keyboard = useHasKeyboard();
  const [active, setActive] = useState(-1);
  useEffect(() => { setActive(hasQuery ? 0 : -1); }, [query, hasQuery]);
  const selected = keyboard ? Math.min(active, items.length - 1) : -1;
  const onKey = (event: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    const key = event.nativeEvent.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault?.();
      if (items.length) setActive(selected < 0 ? (key === 'ArrowDown' ? 0 : items.length - 1) : (selected + (key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (key === 'Escape') { if (query) setQuery(''); else onDismiss?.(); }
  };
  const sections = items.reduce<{ title: string; rows: { item: ResultItem; index: number }[] }[]>((all, item, index) => {
    const last = all[all.length - 1];
    if (last?.title === item.section) last.rows.push({ item, index }); else all.push({ title: item.section, rows: [{ item, index }] });
    return all;
  }, []);
  const sources = search.sources.filter((source) => source.status !== 'skipped');
  const cited = useMemo(() => (search.ai.status === 'done' ? citedAnswer(search.ai.answer, search.ai.sent) : undefined), [search.ai]);

  // A citation scrolls to its post in the results below and outlines it for a moment.
  const scroller = useRef<ScrollView>(null);
  const header = useRef<View>(null);
  const scrolled = useRef(0);
  const postViews = useRef(new Map<string, View>());
  const [spotlight, setSpotlight] = useState<string>();
  useEffect(() => { if (!spotlight) return; const timer = setTimeout(() => setSpotlight(undefined), 2400); return () => clearTimeout(timer); }, [spotlight]);
  const showCited = (postId: string) => {
    const post = postViews.current.get(postId);
    if (!post || !header.current) return;
    // Measured when tapped, and again after scrolling and once images above have had time to load,
    // so the outlined post settles with room below the search field instead of under it.
    const align = (animated: boolean) => header.current?.measureInWindow((_x, headerTop, _width, headerHeight) => post.measureInWindow((_left, top) => {
      const offset = top - (headerTop + headerHeight) - 20;
      if (animated || Math.abs(offset) > 4) scroller.current?.scrollTo({ y: Math.max(0, scrolled.current + offset), animated });
    }));
    align(true);
    setTimeout(() => align(false), 700);
    setTimeout(() => align(false), 1600);
    setSpotlight(postId);
  };

  return <SearchHighlight.Provider value={hasQuery ? terms : []}><ScrollView ref={scroller} onScroll={(event) => { scrolled.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={32} style={styles.screen} contentContainerStyle={styles.content} stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <View ref={header} style={styles.header}>
      <View style={styles.fieldRow}>
        {onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={onClose} style={styles.close}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable> : null}
        <View style={[styles.field, focused && styles.fieldFocused]}>
          <Ionicons name="search" size={21} color={focused ? colors.text : colors.textSecondary} />
          <TextInput accessibilityLabel="Search" autoFocus value={query} onChangeText={setQuery} onKeyPress={onKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="Search people, posts, messages and settings" placeholderTextColor={colors.textTertiary} returnKeyType="search" autoCorrect={false} onSubmitEditing={() => { const item = items[selected]; if (item) item.run(); else { if (hasQuery) recent.add(query); Keyboard.dismiss(); } }} style={styles.input} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={styles.clear}><Ionicons name="close-circle" size={20} color={colors.textTertiary} /></Pressable> : null}
        </View>
      </View>
    </View>

    {hasQuery && search.parsed.understood.length ? <Text style={styles.hint}>Understood: {search.parsed.understood.join(' · ')}{search.parsed.text ? ` · “${search.parsed.text}”` : ''}</Text> : null}

    {search.ai.status === 'loading' || search.ai.status === 'done' || search.ai.status === 'failed' ? <View accessibilityLiveRegion="polite" style={styles.ai}>
      <View style={styles.aiHeader}><AiMark size={15} color={colors.text} /><Text style={styles.aiTitle}>AI summary</Text>{search.ai.status === 'loading' ? <ActivityIndicator size="small" color={colors.textTertiary} style={styles.aiSpinner} /> : null}</View>
      {search.ai.status === 'loading' ? <Text style={styles.aiWaiting}>Reading the public posts below…</Text> : null}
      {search.ai.status === 'failed' ? <Text style={styles.aiWaiting}>{search.ai.message}</Text> : null}
      {search.ai.status === 'done' && cited ? <>
        <Text selectable style={styles.aiText}>{cited.pieces.map((piece, index) => 'text' in piece
          ? piece.text
          : <Text key={index}>{' '}<Text accessibilityRole="link" accessibilityLabel={`Source ${piece.cite}: ${byId.get(piece.postId)?.author.handle ?? 'post'}`} onPress={() => showCited(piece.postId)} suppressHighlighting style={[styles.cite, spotlight === piece.postId && styles.citeActive]}>{piece.cite}</Text></Text>)}</Text>
        {cited.sources.length ? <View style={styles.citeSources}>
          {cited.sources.map((postId, index) => { const post = byId.get(postId); return post ? <Pressable key={postId} accessibilityRole="link" accessibilityLabel={`Source ${index + 1}: ${post.author.handle} on ${sourceName(post.provenance.connectorId)}. Show the post`} onPress={() => showCited(postId)} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.source, (hovered || spotlight === postId) && styles.sourceActive, pressed && styles.rowPressed]}>
            <Text style={styles.sourceNumber}>{index + 1}</Text>
            {post.author.avatarUrl ? <Image source={{ uri: post.author.avatarUrl }} style={styles.sourceAvatar} accessibilityIgnoresInvertColors /> : <View style={styles.sourceAvatar}><Text style={styles.sourceInitials}>{post.author.initials.slice(0, 1)}</Text></View>}
            <Text numberOfLines={1} style={styles.sourceHandle}>{post.author.handle}</Text>
            <Text style={styles.sourceNetwork}>{sourceName(post.provenance.connectorId)}</Text>
          </Pressable> : null; })}
        </View> : null}
        <Text style={styles.aiDisclosure}>Written by AI from {search.ai.sent.length} public posts below, so it can be wrong. Only your search and those posts were sent.</Text>
      </> : null}
    </View> : null}

    {sections.length ? <View style={styles.panel}>
      {sections.map((section) => <View key={section.title} style={styles.group}>
        <Text style={styles.groupLabel}>{section.title === 'Messages and email' ? 'Messages and email · on this device' : section.title}</Text>
        {section.rows.map(({ item, index }) => <ResultRow key={item.key} item={item} selected={index === selected} onHover={() => keyboard && setActive(index)} styles={styles} colors={colors} />)}
      </View>)}
    </View> : null}
    {!hasQuery ? <Text style={styles.footnote}>Write naturally: “videos”, “on Lens” or “today” narrow a search. Messages and email are searched on this device only.</Text> : null}

    {hasQuery && sources.length ? <View style={styles.postsHeader}>
      <Text style={[styles.groupLabel, styles.flushLabel]}>Posts from everywhere</Text>
      <Text style={styles.note}>{sources.map((source) => `${networks[source.id].displayName} ${source.status === 'searching' ? '…' : source.status === 'failed' ? 'unavailable' : source.count}`).join('  ·  ')}</Text>
      {sources.filter((source) => source.status === 'done' && /only/.test(source.method)).map((source) => <Text key={source.id} style={styles.note}>{networks[source.id].displayName}: {source.method}</Text>)}
    </View> : null}
    {search.posts.map((post) => <View key={post.id} ref={(view) => { if (view) postViews.current.set(post.id, view); else postViews.current.delete(post.id); }}>
      <PostCard post={post} mode="raw" viewer={viewer} />
      {spotlight === post.id ? <View pointerEvents="none" style={styles.spotlight} /> : null}
    </View>)}
    {hasQuery && search.searching && !search.posts.length ? <View style={styles.status}><ActivityIndicator color={colors.text} /></View> : null}
    {nothing ? <View style={styles.status}><Ionicons name="search-outline" size={26} color={colors.textTertiary} /><Text style={styles.empty}>No results for “{search.parsed.raw}”. Try fewer or different words.</Text></View> : null}
  </ScrollView></SearchHighlight.Provider>;
}

export interface LensRow { key: string; title: string; subtitle: string; run: () => Promise<boolean> }

/**
 * The work side of a profile (ADR 0018) is changed by saying it: “my headline is Product designer”,
 * “I’m open to work”, “we’re hiring”, “add skills Figma, research”. One row shows the change, and
 * choosing it saves it. There is no profile form.
 */
function useProfileRows(query: string, signedIn: boolean): LensRow[] {
  const [status, setStatus] = useState<{ query: string; text: string }>();
  const intent = useMemo(() => professionalIntent(query.replace(/[’‘]/g, "'")), [query]);
  if (!intent) return [];
  const shown = status?.query === query ? status.text : undefined;
  return [{
    key: 'professional', title: intent.title,
    subtitle: shown ?? (signedIn ? 'Shown on your public profile. Choose this to save it.' : 'Sign in to change your profile.'),
    run: async () => {
      if (!signedIn) return false;
      try {
        const current = (await loadProfessionalProfile()) ?? emptyProfessional;
        await saveProfessionalProfile(applyProfessionalIntent(current, intent));
        setStatus({ query, text: 'Saved. It shows on your profile.' });
      } catch (reason) { setStatus({ query, text: reason instanceof Error ? reason.message : 'That didn’t save. Try again.' }); }
      return false;
    },
  }];
}

const managePattern = /^(remove|delete|uninstall|forget|drop|share|publish|use|switch to|show me|open)\b/i;
const historyPattern = /^(undo|go back|revert|history|versions?|earlier versions?|previous versions?)\b/i;
const originalRelevantPattern = /\b(original|default|reset|plain|built[- ]?in|open media[’']?s)\s+relevant\b|\brelevant\s+(again|as it was)\b/i;

/**
 * Search is where people talk to the Feed (ADR 0017): a request like “only videos from people I
 * follow, no crypto” becomes one result row showing the lens it understood, and choosing the row
 * switches the Feed to it. Saved lenses can be switched to, shared or removed by name, and lenses
 * other people shared are offered for the same words. Words like “less hive” or “more videos” tune
 * the lens in use, and “undo” goes back a version (ADR 0021). Settings → Feed offers the same rows
 * under “Your algorithm”, for people who look for their algorithm there.
 */
export function useLensRows(query: string, lenses: FeedLenses | undefined, signedIn: boolean): LensRow[] {
  const [shared, setShared] = useState<StoredLens[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<{ id: string; items: LensVersion[]; error?: string }>();
  const value = query.trim();
  const lower = value.toLocaleLowerCase();
  const wantsHistory = historyPattern.test(value);
  const historyId = lenses && !lenses.tuneBase.builtIn ? lenses.tuneBase.id : undefined;
  // Keyed on the history loader (stable) and the lens version, so the Feed re-rendering doesn't reload it.
  const loadHistory = lenses?.history;
  const historyVersion = lenses?.tuneBase.version;
  useEffect(() => {
    if (!loadHistory || !wantsHistory || !historyId) { setVersions(undefined); return; }
    let active = true;
    loadHistory(historyId).then((items) => { if (active) setVersions({ id: historyId, items }); }).catch((reason) => { if (active) setVersions({ id: historyId, items: [], error: reason instanceof Error ? reason.message : 'Couldn’t load the history.' }); });
    return () => { active = false; };
  }, [loadHistory, wantsHistory, historyId, historyVersion]);
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
    const alias = builtInLensFor(value);
    const named = lenses.lenses.filter((lens) => lens.id === alias?.id || lower.includes(lens.name.toLocaleLowerCase()));
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
      } else if (lenses.lens.id !== lens.id && (action || lower === lens.name.toLocaleLowerCase() || lens.id === alias?.id || /\b(feed|lens)\b/.test(lower))) {
        rows.push({ key: `use-${lens.id}`, title: `Show the Feed through ${lens.name}`, subtitle: lensSummary(lens), run: async () => { lenses.choose(lens.id); return true; } });
      }
    }
    // Your tuned copy replaces Relevant in the Feed's picker; these words bring Open Media's own back.
    const ownRelevant = lenses.lenses.find((lens) => lens.id === ownCopyId(relevantLens));
    if (ownRelevant && originalRelevantPattern.test(value)) {
      if (lenses.lens.id !== 'relevant') rows.push({ key: 'original-relevant', title: 'Show the Feed through Open Media’s Relevant', subtitle: `Your changes stay saved as ${ownRelevant.name}; search “${ownRelevant.name.toLocaleLowerCase()}” to use them again.`, run: async () => { lenses.choose('relevant'); return true; } });
      return rows;
    }
    if (wantsHistory && lenses) {
      const base = lenses.tuneBase;
      if (base.builtIn) rows.push({ key: 'history', title: `${base.name} has no changes to undo`, subtitle: `${base.name} is built in and never changes. Tune it in words, like “less hive”, to make your own copy.`, run: async () => false });
      else if (versions?.error) rows.push({ key: 'history', title: `Earlier versions of ${base.name}`, subtitle: versions.error, run: async () => false });
      else for (const item of (versions?.id === base.id ? versions.items : []).filter((entry) => entry.version !== base.version).slice(0, 3)) {
        rows.push({ key: `version-${item.version}`, title: `Go back to version ${item.version} of ${base.name}`, subtitle: `${lensSummary(item.lens)} · ${item.changedBy === 'agent' ? 'Made by an agent' : 'Made by you'} ${timeAgo(item.createdAt)}`, run: async () => { await lenses.revert(base.id, item.version); return true; } });
      }
      return rows;
    }
    // A change to the lens in use (“less hive, more videos”): built-in lenses become the person's own copy.
    const tuning = !rows.length && (looksLikeTuneRequest(value) || looksLikeLensRequest(value)) ? tuneLens(lenses.tuneBase, value) : undefined;
    const tuneRow: LensRow | undefined = tuning?.changes.length ? {
      key: 'tune', title: `${looksLikeTuneRequest(value) ? 'Tune' : 'Add to'} “${tuning.lens.name}”: ${tuning.understood.join(' · ')}`,
      subtitle: `${tuning.changes.join(' · ')}${tuning.unused.length ? ` · Not used: ${tuning.unused.join(', ')}` : ''}`,
      run: async () => { lenses.apply(tuning.lens); return true; },
    } : undefined;
    if (tuneRow && looksLikeTuneRequest(value)) rows.push(tuneRow);
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
        if (tuneRow) rows.push(tuneRow);
      }
      for (const item of shared.filter((entry) => !lenses.lenses.some((lens) => lens.id === entry.lens.id)).slice(0, 3)) {
        rows.push({ key: `shared-${item.rowId}`, title: `Use “${item.lens.name}”${item.lens.author ? ` by ${item.lens.author}` : ''}`, subtitle: `${lensSummary(item.lens)}${item.installs ? ` · ${item.installs} ${item.installs === 1 ? 'person uses' : 'people use'} it` : ''}`, run: async () => { lenses.apply({ ...item.lens, author: undefined }, item.rowId); return true; } });
      }
    }
    return rows;
  }, [value, lower, lenses, shared, status, signedIn, wantsHistory, versions]);
}

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Recent searches for this person on this device; signed out, nothing is kept. */
function useRecentSearches(viewerId: string | undefined) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    setList([]);
    if (!viewerId) return;
    let active = true;
    AsyncStorage.getItem(recentSearchesKey(viewerId)).then((value) => { if (active && value) setList(JSON.parse(value) as string[]); }).catch(() => undefined);
    return () => { active = false; };
  }, [viewerId]);
  const add = (query: string) => {
    if (!viewerId) return;
    // Written at once: opening a result usually leaves Search before another render.
    const next = rememberSearch(list, query);
    AsyncStorage.setItem(recentSearchesKey(viewerId), JSON.stringify(next)).catch(() => undefined);
    setList(next);
  };
  return { list, add };
}

/** True where a hardware keyboard is the usual way in: the web with a fine pointer (not a phone). */
function useHasKeyboard(): boolean {
  return useMemo(() => Platform.OS === 'web' && typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)').matches, []);
}

function ResultRow({ item, selected, onHover, styles, colors }: { item: ResultItem; selected: boolean; onHover: () => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={item.run} onHoverIn={onHover} style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}>
    <View style={[styles.rowIcon, selected && styles.rowIconSelected]}><Ionicons name={item.icon} size={17} color={selected ? colors.surface : colors.text} /></View>
    <View style={styles.rowCopy}>
      <Text numberOfLines={1} style={[styles.rowTitle, selected && styles.rowTextSelected]}><Highlighted text={item.title} /></Text>
      {item.subtitle ? <Text numberOfLines={2} style={[styles.rowSubtitle, selected && styles.rowSubtitleSelected]}><Highlighted text={item.subtitle} /></Text> : null}
    </View>
    {selected ? <Ionicons name="return-down-back" size={16} color={colors.surface} /> : null}
  </Pressable>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 80 },
  header: { paddingTop: Platform.OS === 'web' ? 28 : 12, paddingBottom: 10, backgroundColor: colors.surface },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  close: { width: 36, height: 36, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 18, paddingRight: 10, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)' } as object,
  fieldFocused: { borderColor: colors.textTertiary },
  input: { flex: 1, minHeight: 54, color: colors.text, fontSize: 20, letterSpacing: -0.2, paddingVertical: 0, outlineStyle: 'none' } as object,
  clear: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  footnote: { marginTop: 10, marginHorizontal: 10, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  hint: { marginTop: 4, marginHorizontal: 6, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  note: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  ai: { marginTop: 14, gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiTitle: { color: colors.text, fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
  aiSpinner: { marginLeft: 2, transform: [{ scale: 0.75 }] },
  aiWaiting: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  aiText: { color: colors.text, fontSize: 16, lineHeight: 25, letterSpacing: -0.1 },
  // Inline citation: a small number in a soft rounded tile (the tile is drawn on the web; phones show the shaded number).
  cite: { color: colors.text, backgroundColor: colors.bubble, fontSize: 11, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'], ...(Platform.OS === 'web' ? { display: 'inline-block', minWidth: 18, paddingHorizontal: 5, borderRadius: 6, textAlign: 'center', verticalAlign: 'middle', transform: [{ translateY: -1 }], cursor: 'pointer' } : {}) } as object,
  citeActive: { color: colors.surface, backgroundColor: colors.text },
  citeSources: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  source: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  sourceActive: { borderColor: colors.textTertiary, backgroundColor: colors.chrome },
  sourceNumber: { minWidth: 16, color: colors.textTertiary, fontSize: 11, fontWeight: '600', textAlign: 'center', fontVariant: ['tabular-nums'] },
  sourceAvatar: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
  sourceInitials: { color: colors.textSecondary, fontSize: 9, fontWeight: '700' },
  sourceHandle: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
  sourceNetwork: { color: colors.textTertiary, fontSize: 12 },
  aiDisclosure: { color: colors.textTertiary, fontSize: 11, lineHeight: 15, opacity: 0.85 },
  spotlight: { position: 'absolute', top: 4, bottom: 4, left: -10, right: -10, borderRadius: 18, borderWidth: 1.5, borderColor: colors.text },
  panel: { marginTop: 14, padding: 6, gap: 4, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  group: { gap: 2 },
  groupLabel: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  rowSelected: { backgroundColor: colors.text },
  rowPressed: { opacity: 0.7 },
  rowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.chrome },
  rowIconSelected: { backgroundColor: 'rgba(127,127,127,0.28)' },
  rowCopy: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowTextSelected: { color: colors.surface },
  rowSubtitle: { marginTop: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  rowSubtitleSelected: { color: colors.surface, opacity: 0.75 },
  flushLabel: { paddingHorizontal: 0 },
  postsHeader: { marginTop: 22, marginBottom: 4, gap: 2 },
  status: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  empty: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
}); }

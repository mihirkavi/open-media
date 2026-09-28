import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mockPosts } from '../data/mockPosts';
import { PostReportReason } from '../data/postService';
import { clipPosts, explainFeedPost, FeedMode, selectFeed, SocialPost } from '../domain/posts';
import { formatRelativeTime } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';

export interface FeedViewer { id: string; initials: string }

export interface FeedViewProps {
  mode: FeedMode;
  onModeChange: (mode: FeedMode) => void;
  posts: SocialPost[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  /** Undefined for signed-out visitors: the feed is read-only. */
  viewer?: FeedViewer;
  onCompose?: () => void;
  onDeletePost?: (postId: string) => Promise<void>;
  onReportPost?: (postId: string, reason: PostReportReason) => Promise<void>;
}

export function FeedView({ mode, onModeChange, posts, loading, error, hasMore, onRetry, onLoadMore, viewer, onCompose, onDeletePost, onReportPost }: FeedViewProps) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const ordered = useMemo(() => selectFeed(posts, mode), [posts, mode]);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.stream}>
    <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>Feed</Text><Text style={styles.subtitle}>{viewer ? 'Public posts from Open Media.' : 'Public posts from Open Media. No account needed to read.'}</Text></View><FeedPicker value={mode} onChange={onModeChange} /></View>
    {viewer && onCompose ? <Pressable accessibilityRole="button" accessibilityLabel="Create a public post" onPress={onCompose} style={styles.composer}><Avatar initials={viewer.initials} /><Text style={styles.composerText}>Share something publicly…</Text><Ionicons name="add-circle" size={24} color={colors.text} /></Pressable> : null}
    {ordered.map((post) => <PostCard key={post.id} post={post} mode={mode} viewer={viewer} onDelete={onDeletePost} onReport={onReportPost} />)}
    {loading ? <View style={styles.status}><ActivityIndicator color={colors.text} /></View> : null}
    {!loading && error ? <View style={styles.status}><Text accessibilityLiveRegion="assertive" style={styles.statusText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.statusButton}><Text style={styles.statusButtonText}>Try again</Text></Pressable></View> : null}
    {!loading && !error && !posts.length ? <View style={styles.status}><Ionicons name="newspaper-outline" size={26} color={colors.textSecondary} /><Text style={styles.emptyTitle}>No public posts yet</Text><Text style={styles.statusText}>{viewer ? 'Be the first to share something.' : 'Sign in to share the first one.'}</Text></View> : null}
    {!loading && !error && hasMore ? <Pressable accessibilityRole="button" onPress={onLoadMore} style={[styles.statusButton, styles.loadMore]}><Text style={styles.statusButtonText}>Load older posts</Text></Pressable> : null}
  </ScrollView>;
}

export function FeedPicker({ value, onChange }: { value: FeedMode; onChange: (mode: FeedMode) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <View accessibilityRole="tablist" style={styles.segment}>{(['relevant', 'raw'] as const).map((mode) => <Pressable key={mode} accessibilityRole="tab" accessibilityState={{ selected: value === mode }} onPress={() => onChange(mode)} style={[styles.segmentButton, value === mode && styles.segmentActive]}><Text style={[styles.segmentText, value === mode && styles.segmentTextActive]}>{mode === 'relevant' ? 'Relevant' : 'Raw'}</Text></Pressable>)}</View>;
}

function PostCard({ post, mode, viewer, onDelete, onReport }: { post: SocialPost; mode: FeedMode; viewer?: FeedViewer; onDelete?: (postId: string) => Promise<void>; onReport?: (postId: string, reason: PostReportReason) => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const [expanded, setExpanded] = useState(false); const [menuOpen, setMenuOpen] = useState(false); const explanation = explainFeedPost(post, mode);
  const own = Boolean(viewer && viewer.id === post.author.id);
  const canAct = own ? Boolean(onDelete) : Boolean(viewer && onReport);
  return <View style={styles.post}>
    <View style={styles.postHeader}><Avatar initials={post.author.initials} /><View style={styles.author}><Text style={styles.authorName}>{post.author.displayName}</Text><Text style={styles.meta}>{post.author.handle} · {formatRelativeTime(post.createdAt)} · {post.provenance.connectorId}</Text></View>{canAct ? <Pressable accessibilityRole="button" accessibilityLabel="Post options" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen((value) => !value)} style={styles.menuButton}><Ionicons name={menuOpen ? 'close' : 'ellipsis-horizontal'} size={18} color={colors.textSecondary} /></Pressable> : null}</View>
    {menuOpen ? <PostMenu own={own} onDelete={() => onDelete!(post.id)} onReport={(reason) => onReport!(post.id, reason)} /> : null}
    <Text selectable style={styles.body}>{post.body}</Text>
    {post.media?.[0] ? <View accessibilityLabel={post.media[0].altText} style={[styles.media, post.kind === 'video' && styles.video]}><Ionicons name={post.kind === 'video' ? 'play' : 'image-outline'} size={30} color="#FFFFFF" /><Text style={styles.alt}>{post.media[0].altText}</Text></View> : null}
    <View style={styles.actions}>{post.engagement ? <><Action icon="chatbubble-outline" count={post.engagement.replies} /><Action icon="repeat-outline" count={post.engagement.reposts} /><Action icon="heart-outline" count={post.engagement.likes} /></> : null}<Pressable onPress={() => setExpanded((value) => !value)} style={styles.why}><Text style={styles.whyText}>Why this?</Text></Pressable></View>
    {expanded ? <View style={styles.explanation}><Text style={styles.explanationTitle}>Why you’re seeing this</Text>{explanation.used.map((item) => <Text key={item} style={styles.explanationItem}>✓ {item}</Text>)}<Text style={styles.notUsed}>Not used: {explanation.notUsed.join(', ')}</Text></View> : null}
  </View>;
}

function PostMenu({ own, onDelete, onReport }: { own: boolean; onDelete: () => Promise<void>; onReport: (reason: PostReportReason) => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [confirming, setConfirming] = useState(false);
  const run = async (action: () => Promise<void>, done: string) => { setBusy(true); setNotice(''); try { await action(); setNotice(done); } catch (reason) { setNotice(reason instanceof Error ? reason.message : 'That didn’t work. Try again.'); } finally { setBusy(false); } };
  return <View style={styles.menu}>
    {busy ? <ActivityIndicator color={colors.text} /> : notice ? <Text accessibilityLiveRegion="polite" style={styles.menuNotice}>{notice}</Text> : own
      ? confirming
        ? <><Text style={styles.menuLabel}>Delete this post permanently? It disappears for everyone, including the public API.</Text><View style={styles.menuRow}><Pressable accessibilityRole="button" onPress={() => run(onDelete, 'Post deleted.')} style={[styles.menuChip, styles.menuChipDanger]}><Text style={styles.menuDanger}>Delete</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.menuChip}><Text style={styles.menuText}>Cancel</Text></Pressable></View></>
        : <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.menuItem}><Ionicons name="trash-outline" size={16} color="#B42318" /><Text style={styles.menuDanger}>Delete post</Text></Pressable>
      : <><Text style={styles.menuLabel}>Report this post</Text><View style={styles.menuRow}>{([['spam', 'Spam'], ['harassment', 'Harassment'], ['other', 'Something else']] as const).map(([reason, label]) => <Pressable key={reason} accessibilityRole="button" onPress={() => run(() => onReport(reason), 'Thanks for reporting. Posts reported by several people are hidden for review.')} style={styles.menuChip}><Text style={styles.menuText}>{label}</Text></Pressable>)}</View></>}
  </View>;
}

export function ClipsView() {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const clips = clipPosts(mockPosts);
  return <View style={styles.screen}><Text style={styles.sampleNote}>Sample clips · video publishing isn’t available yet</Text><ScrollView horizontal pagingEnabled style={styles.screen} contentContainerStyle={styles.clips}>{clips.map((post) => <View key={post.id} style={styles.clip}><View style={styles.clipCanvas}><Ionicons name="play" size={42} color="#FFFFFF" /><Text style={styles.clipAlt}>{post.media?.[0]?.altText}</Text><View style={styles.clipOverlay}><Text style={styles.clipAuthor}>{post.author.displayName} <Text style={styles.clipHandle}>{post.author.handle}</Text></Text><Text style={styles.clipBody}>{post.body}</Text><Text style={styles.clipSource}>From {post.provenance.connectorId}</Text></View></View></View>)}</ScrollView></View>;
}

function Avatar({ initials }: { initials: string }) { const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); return <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>; }
function Action({ icon, count }: { icon: keyof typeof Ionicons.glyphMap; count: number }) { const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); return <View style={styles.action}><Ionicons name={icon} size={17} color={colors.textSecondary} /><Text style={styles.actionText}>{count}</Text></View>; }

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, stream: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 26, paddingBottom: 70 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22 }, headerCopy: { flex: 1 }, title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }, subtitle: { marginTop: 5, color: colors.textSecondary, fontSize: 13 }, segment: { flexDirection: 'row', padding: 3, borderRadius: 18, backgroundColor: colors.chrome }, segmentButton: { minHeight: 32, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, segmentActive: { backgroundColor: colors.text }, segmentText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' }, segmentTextActive: { color: colors.surface }, composer: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingHorizontal: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }, composerText: { flex: 1, color: colors.textTertiary, fontSize: 14 }, avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }, avatarText: { color: colors.surface, fontSize: 10, fontWeight: '800' }, post: { paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: colors.border }, postHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 }, author: { flex: 1 }, authorName: { color: colors.text, fontSize: 14, fontWeight: '700' }, meta: { marginTop: 2, color: colors.textTertiary, fontSize: 10 }, body: { marginTop: 13, color: colors.text, fontSize: 16, lineHeight: 23 }, media: { minHeight: 240, marginTop: 15, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 18, backgroundColor: '#545451' }, video: { minHeight: 360, backgroundColor: '#222220' }, alt: { maxWidth: 300, color: '#FFFFFF', textAlign: 'center', fontSize: 12, lineHeight: 18 }, actions: { marginTop: 15, flexDirection: 'row', alignItems: 'center', gap: 22 }, action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, actionText: { color: colors.textSecondary, fontSize: 11 }, why: { marginLeft: 'auto', minHeight: 32, justifyContent: 'center' }, whyText: { color: colors.textSecondary, fontSize: 11, textDecorationLine: 'underline' }, explanation: { marginTop: 10, padding: 14, borderRadius: 14, backgroundColor: colors.chrome }, explanationTitle: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 8 }, explanationItem: { color: colors.textSecondary, fontSize: 11, lineHeight: 17 }, notUsed: { marginTop: 8, color: colors.textTertiary, fontSize: 10, lineHeight: 15 }, clips: { flexGrow: 1, alignItems: 'stretch', padding: 18, gap: 18 }, clip: { width: Platform.OS === 'web' ? 410 : 330, maxWidth: '90vw' as never }, clipCanvas: { flex: 1, minHeight: 560, padding: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#181818', overflow: 'hidden' }, clipAlt: { maxWidth: 260, marginTop: 14, color: '#AAAAA6', textAlign: 'center', fontSize: 12, lineHeight: 18 }, clipOverlay: { position: 'absolute', left: 20, right: 20, bottom: 22 }, clipAuthor: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' }, clipHandle: { color: '#B9B9B4', fontWeight: '400' }, clipBody: { marginTop: 8, color: '#FFFFFF', fontSize: 14, lineHeight: 20 }, clipSource: { marginTop: 9, color: '#A4A49E', fontSize: 10 }, sampleNote: { paddingHorizontal: 18, paddingTop: 14, color: colors.textTertiary, fontSize: 11 }, status: { alignItems: 'center', gap: 8, paddingVertical: 36 }, statusText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }, emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, statusButton: { minHeight: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: colors.border }, statusButtonText: { color: colors.text, fontSize: 12, fontWeight: '700' }, loadMore: { alignSelf: 'center', marginTop: 20 }, menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, menu: { marginTop: 12, padding: 10, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }, menuRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, menuChip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border }, menuLabel: { paddingBottom: 4, color: colors.textTertiary, fontSize: 10, fontWeight: '700' }, menuItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }, menuText: { color: colors.text, fontSize: 13, fontWeight: '600' }, menuChipDanger: { borderColor: '#F3B8B2' }, menuDanger: { color: '#B42318', fontSize: 13, fontWeight: '700' }, menuNotice: { padding: 4, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
}); }

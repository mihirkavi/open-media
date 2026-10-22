import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mockPosts } from '../data/mockPosts';
import { createClientId } from '../data/openMediaService';
import { crossPost } from '../data/crossPostService';
import { PostReportReason, publishPost } from '../data/postService';
import { CrossPostOutcome, destinationSummary, outcomeSummary, prepareCrossPost } from '../domain/crossPosting';
import { NetworkId, networks, safeHttpsUrl, sourceName } from '../domain/networkPosts';
import { clipPosts, explainFeedPost, FeedMode, selectFeed, SocialPost } from '../domain/posts';
import { formatRelativeTime, maxPostLength } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { useCrossPosting } from './useCrossPosting';
import type { FeedSourceStatus } from './useMixedFeed';

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
  /** Per-source load state for the mixed Feed; omit for an Open Media-only feed. */
  sources?: FeedSourceStatus[];
  loadingMore?: boolean;
  /** New posts that arrived while the reader was scrolled down; shown at once when they are at the top. */
  pendingCount?: number;
  onShowPending?: () => void;
  /** Undefined for signed-out visitors: the feed is read-only. */
  viewer?: FeedViewer;
  /** Whether the writing box at the top is open; omit both to hide it (read-only feed). */
  composing?: boolean;
  onComposingChange?: (open: boolean) => void;
  onPublished?: (post: SocialPost) => void;
  onDeletePost?: (postId: string) => Promise<void>;
  onReportPost?: (postId: string, reason: PostReportReason) => Promise<void>;
}

export function FeedView({ mode, onModeChange, posts, loading, error, hasMore, onRetry, onLoadMore, sources, loadingMore = false, pendingCount = 0, onShowPending, viewer, composing = false, onComposingChange, onPublished, onDeletePost, onReportPost }: FeedViewProps) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const ordered = useMemo(() => selectFeed(posts, mode), [posts, mode]);
  const unreachable = (sources ?? []).filter((item) => item.error);
  const sourceNames = sources ? sources.map((item) => sourceName(item.id)) : ['Open Media'];
  const subtitle = `Public posts from ${listFormat(sourceNames)}.${viewer ? '' : ' No account needed to read.'}`;
  const showComposer = viewer && onComposingChange && onPublished;
  // Continuous and live: older posts load as the reader nears the end; new posts slide in only while
  // the reader is at the very top, otherwise a pill offers them so nothing moves under the reader.
  const scroller = useRef<ScrollView>(null);
  const [atTop, setAtTop] = useState(true);
  useEffect(() => { if (atTop && pendingCount && onShowPending) onShowPending(); }, [atTop, pendingCount, onShowPending]);
  const canLoadMore = !loading && !loadingMore && !error && hasMore;
  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    setAtTop(contentOffset.y < 24);
    if (canLoadMore && contentOffset.y + layoutMeasurement.height > contentSize.height - layoutMeasurement.height * 1.5) onLoadMore();
  };
  const jumpToNew = () => { onShowPending?.(); scroller.current?.scrollTo({ y: 0, animated: true }); };
  return <View style={styles.screen}>
  {pendingCount > 0 && !atTop ? <Pressable accessibilityRole="button" accessibilityLabel={`Show ${pendingCount} new ${pendingCount === 1 ? 'post' : 'posts'}`} onPress={jumpToNew} style={styles.newPosts}><Ionicons name="arrow-up" size={14} color={colors.surface} /><Text style={styles.newPostsText}>{pendingCount} new {pendingCount === 1 ? 'post' : 'posts'}</Text></Pressable> : null}
  <ScrollView ref={scroller} onScroll={onScroll} scrollEventThrottle={64} style={styles.screen} contentContainerStyle={styles.stream}>
    <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>Feed</Text><Text style={styles.subtitle}>{subtitle}</Text></View><FeedPicker value={mode} onChange={onModeChange} /></View>
    {showComposer ? <Composer viewer={viewer} open={composing} onOpenChange={onComposingChange} onPublished={onPublished} /> : null}
    {!error && unreachable.length ? <View style={styles.sourceNotice}><Text accessibilityLiveRegion="polite" style={styles.sourceNoticeText}>{unreachable.map((item) => sourceName(item.id)).join(', ')} {unreachable.length === 1 ? 'isn’t' : 'aren’t'} loading right now. Everything else is up to date.</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.sourceNoticeButton}><Text style={styles.statusButtonText}>Retry</Text></Pressable></View> : null}
    {ordered.map((post) => <PostCard key={post.id} post={post} mode={mode} viewer={viewer} onDelete={onDeletePost} onReport={onReportPost} />)}
    {loading || loadingMore ? <View style={styles.status}><ActivityIndicator color={colors.text} /></View> : null}
    {!loading && error ? <View style={styles.status}><Text accessibilityLiveRegion="assertive" style={styles.statusText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.statusButton}><Text style={styles.statusButtonText}>Try again</Text></Pressable></View> : null}
    {!loading && !loadingMore && !error && !ordered.length ? <View style={styles.status}><Ionicons name="newspaper-outline" size={26} color={colors.textSecondary} /><Text style={styles.emptyTitle}>No public posts yet</Text><Text style={styles.statusText}>{viewer ? 'Be the first to share something.' : 'Sign in to share the first one.'}</Text></View> : null}
    {canLoadMore ? <Pressable accessibilityRole="button" onPress={onLoadMore} style={[styles.statusButton, styles.loadMore]}><Text style={styles.statusButtonText}>Load older posts</Text></Pressable> : null}
  </ScrollView>
  </View>;
}

/** Writing happens right in the feed: tap the row to expand it, publish, and it collapses. */
function Composer({ viewer, open, onOpenChange, onPublished }: { viewer: FeedViewer; open: boolean; onOpenChange: (open: boolean) => void; onPublished: (post: SocialPost) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  // One client ID per draft keeps retries idempotent on the server and on every network.
  const clientId = useRef(createClientId());
  const input = useRef<TextInput>(null);
  const crossPosting = useCrossPosting();
  // Destinations follow the defaults (every connected network) until changed for this post.
  const [override, setOverride] = useState<NetworkId[]>();
  const destinations = (override ?? crossPosting.defaults).filter((network) => crossPosting.connected.includes(network));
  const [showDestinations, setShowDestinations] = useState(false);
  const [retry, setRetry] = useState<{ body: string; postId: string; outcomes: CrossPostOutcome[] }>();
  const [notice, setNotice] = useState('');
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  const length = body.trim().length;
  const ready = !busy && length > 0 && length <= maxPostLength;
  const finish = (outcomes: CrossPostOutcome[], text: string, postId: string) => {
    const missed = outcomes.filter((outcome) => outcome.status !== 'published');
    if (missed.length) setRetry({ body: text, postId, outcomes });
    else { setRetry(undefined); setNotice(outcomeSummary(outcomes)); onOpenChange(false); }
  };
  const publish = async () => {
    setBusy(true); setError(''); setRetry(undefined);
    const text = body; const postId = clientId.current; const chosen = destinations;
    try {
      const post = await publishPost(text, postId);
      setBody(''); clientId.current = createClientId(); setOverride(undefined); setShowDestinations(false); onPublished(post);
      finish(chosen.length ? await crossPost(text, chosen, postId) : [], text, postId);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Publishing failed.'); }
    finally { setBusy(false); }
  };
  const retryMissed = async () => {
    if (!retry) return;
    setBusy(true);
    try { finish(await crossPost(retry.body, retry.outcomes.map((outcome) => outcome.network), retry.postId), retry.body, retry.postId); }
    finally { setBusy(false); }
  };
  const toggle = (network: NetworkId) => setOverride(destinations.includes(network) ? destinations.filter((item) => item !== network) : [...destinations, network]);
  if (!open) return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Write a public post" onPress={() => onOpenChange(true)} style={styles.composer}><Avatar initials={viewer.initials} /><Text style={styles.composerText}>Share something publicly…</Text></Pressable>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.composerNotice}>{notice}</Text> : null}
  </View>;
  return <View style={[styles.composer, styles.composerOpen]}>
    <View style={styles.composerTop}><Avatar initials={viewer.initials} /><TextInput ref={input} accessibilityLabel="Post text" multiline maxLength={maxPostLength + 200} value={body} onChangeText={setBody} placeholder="What’s on your mind?" placeholderTextColor={colors.textTertiary} style={styles.composerInput} /></View>
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.composerError}>{error}</Text> : null}
    {retry ? <View style={styles.crossPostResult}>
      <Text accessibilityLiveRegion="polite" style={styles.crossPostResultText}>{outcomeSummary(retry.outcomes)}</Text>
      {retry.outcomes.filter((outcome) => outcome.status !== 'published').map((outcome) => <Text key={outcome.network} style={styles.crossPostReason}>{networks[outcome.network].displayName}: {outcome.message}</Text>)}
      <View style={styles.menuRow}>
        {retry.outcomes.some((outcome) => outcome.status === 'failed') ? <Pressable accessibilityRole="button" disabled={busy} onPress={retryMissed} style={styles.menuChip}><Text style={styles.menuText}>Try again</Text></Pressable> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setRetry(undefined); onOpenChange(false); }} style={styles.menuChip}><Text style={styles.menuText}>Done</Text></Pressable>
      </View>
    </View> : null}
    {showDestinations ? <View accessibilityLabel="Where this post goes" style={styles.destinations}>
      <View style={styles.destination}><Ionicons name="checkmark-circle" size={20} color={colors.text} /><Text style={styles.destinationName}>Open Media</Text><Text style={styles.destinationNote}>Always</Text></View>
      {crossPosting.networks.map((item) => {
        const name = networks[item.network].displayName;
        if (!item.account) return <View key={item.network} style={styles.destination}><Ionicons name="ellipse-outline" size={20} color={colors.textTertiary} /><Text style={[styles.destinationName, styles.destinationOff]}>{name}</Text><Text style={styles.destinationNote}>{item.availability.available ? 'Connect in Settings → Cross-posting' : item.availability.setup === 'device' ? 'Set up in Settings → Cross-posting' : 'Coming soon'}</Text></View>;
        const selected = destinations.includes(item.network);
        const prepared = prepareCrossPost(body || ' x', item.network);
        return <Pressable key={item.network} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggle(item.network)} style={styles.destination}>
          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? colors.text : colors.textTertiary} />
          <Text style={styles.destinationName}>{name}</Text>
          <Text numberOfLines={1} style={[styles.destinationNote, selected && !prepared.ok && styles.composerOver]}>{selected && !prepared.ok ? prepared.reason : item.account.handle}</Text>
        </Pressable>;
      })}
    </View> : null}
    <View style={styles.composerFooter}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDestinations }} accessibilityLabel={`Sharing to ${destinationSummary(destinations)}. Change destinations`} onPress={() => setShowDestinations((value) => !value)} style={styles.sharingTo}>
        <Text numberOfLines={1} style={[styles.composerHint, length > maxPostLength && styles.composerOver]}>Sharing to <Text style={styles.sharingToStrong}>{destinationSummary(destinations)}</Text>{length > maxPostLength - 200 ? ` · ${length}/${maxPostLength}` : ''}</Text>
        <Ionicons name={showDestinations ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setError(''); onOpenChange(false); }} style={styles.composerCancel}><Text style={styles.composerCancelText}>Cancel</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!ready} onPress={publish} style={[styles.composerPost, !ready && styles.composerPostDisabled]}>{busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.composerPostText}>Post</Text>}</Pressable>
    </View>
    <Text style={styles.composerPublic}>Public · anyone can read it, here and on every network it goes to</Text>
  </View>;
}

function listFormat(items: string[]) {
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function FeedPicker({ value, onChange }: { value: FeedMode; onChange: (mode: FeedMode) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <View accessibilityRole="tablist" style={styles.segment}>{(['relevant', 'raw'] as const).map((mode) => <Pressable key={mode} accessibilityRole="tab" accessibilityState={{ selected: value === mode }} onPress={() => onChange(mode)} style={[styles.segmentButton, value === mode && styles.segmentActive]}><Text style={[styles.segmentText, value === mode && styles.segmentTextActive]}>{mode === 'relevant' ? 'Relevant' : 'Raw'}</Text></Pressable>)}</View>;
}

function PostCard({ post, mode, viewer, onDelete, onReport }: { post: SocialPost; mode: FeedMode; viewer?: FeedViewer; onDelete?: (postId: string) => Promise<void>; onReport?: (postId: string, reason: PostReportReason) => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const [expanded, setExpanded] = useState(false); const [menuOpen, setMenuOpen] = useState(false); const explanation = explainFeedPost(post, mode);
  const native = post.provenance.connectorId === 'open-media';
  const own = Boolean(native && viewer && viewer.id === post.author.id);
  const canAct = native && (own ? Boolean(onDelete) : Boolean(viewer && onReport));
  const original = native ? undefined : safeHttpsUrl(post.provenance.canonicalURL);
  const network = networks[post.provenance.connectorId as keyof typeof networks];
  const image = post.media?.[0];
  // External posts can be long; Open Media posts are short enough to show whole.
  const long = !native && !post.title && (post.body.length > 420 || post.body.split('\n').length > 8);
  const [showAll, setShowAll] = useState(false);
  return <View style={styles.post}>
    <View style={styles.postHeader}><Avatar initials={post.author.initials} imageUrl={post.author.avatarUrl} /><View style={styles.author}><Text numberOfLines={1} style={styles.authorName}>{post.author.displayName}</Text><Text numberOfLines={1} style={styles.meta}>{post.author.handle} · {formatRelativeTime(post.createdAt)} · {sourceName(post.provenance.connectorId)}</Text></View>{canAct ? <Pressable accessibilityRole="button" accessibilityLabel="Post options" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen((value) => !value)} style={styles.menuButton}><Ionicons name={menuOpen ? 'close' : 'ellipsis-horizontal'} size={18} color={colors.textSecondary} /></Pressable> : null}</View>
    {menuOpen ? <PostMenu own={own} onDelete={() => onDelete!(post.id)} onReport={(reason) => onReport!(post.id, reason)} /> : null}
    {post.title ? <Text selectable style={styles.postTitle}>{post.title}</Text> : null}
    {post.body ? <Text selectable numberOfLines={long && !showAll ? 8 : undefined} style={[styles.body, post.title ? styles.bodyAfterTitle : null]}>{post.body}</Text> : null}
    {long ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }} onPress={() => setShowAll((value) => !value)} style={styles.showMore}><Text style={styles.whyText}>{showAll ? 'Show less' : 'Show more'}</Text></Pressable> : null}
    {image?.kind === 'image' && image.url ? <PostImage url={image.url} altText={image.altText} /> : image ? <View accessibilityLabel={image.altText} style={[styles.media, post.kind === 'video' && styles.video]}><Ionicons name={post.kind === 'video' ? 'play' : 'image-outline'} size={30} color="#FFFFFF" /><Text style={styles.alt}>{image.altText}</Text></View> : null}
    <View style={styles.actions}>{post.engagement ? <><Action icon="chatbubble-outline" count={post.engagement.replies} /><Action icon="repeat-outline" count={post.engagement.reposts} /><Action icon="heart-outline" count={post.engagement.likes} /></> : null}{original ? <Pressable accessibilityRole="link" accessibilityLabel={`Open this post on ${sourceName(post.provenance.connectorId)}`} onPress={() => { Linking.openURL(original).catch(() => undefined); }} style={styles.original}><Text style={styles.whyText}>Open on {sourceName(post.provenance.connectorId)}</Text><Ionicons name="open-outline" size={12} color={colors.textSecondary} /></Pressable> : null}<Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={[styles.why, original ? styles.whyAfterLink : null]}><Text style={styles.whyText}>Why this?</Text></Pressable></View>
    {expanded ? <View style={styles.explanation}><Text style={styles.explanationTitle}>Why you’re seeing this</Text>{explanation.used.map((item) => <Text key={item} style={styles.explanationItem}>✓ {item}</Text>)}{explanation.filters.length ? <><Text style={styles.explanationSubtitle}>Filters applied to {sourceName(post.provenance.connectorId)}</Text>{explanation.filters.map((item) => <Text key={item} style={styles.explanationItem}>· {item}</Text>)}<Text style={styles.notUsed}>Filtered posts stay on {sourceName(post.provenance.connectorId)}; Open Media only leaves them out of this Feed.{network ? ` ${network.about}` : ''}</Text></> : null}<Text style={styles.notUsed}>Not used: {explanation.notUsed.join(', ')}</Text></View> : null}
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
        : <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.menuItem}><Ionicons name="trash-outline" size={16} color={colors.danger} /><Text style={styles.menuDanger}>Delete post</Text></Pressable>
      : <><Text style={styles.menuLabel}>Report this post</Text><View style={styles.menuRow}>{([['spam', 'Spam'], ['harassment', 'Harassment'], ['other', 'Something else']] as const).map(([reason, label]) => <Pressable key={reason} accessibilityRole="button" onPress={() => run(() => onReport(reason), 'Thanks for reporting. Posts reported by several people are hidden for review.')} style={styles.menuChip}><Text style={styles.menuText}>{label}</Text></Pressable>)}</View></>}
  </View>;
}

export function ClipsView() {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const clips = clipPosts(mockPosts);
  return <View style={styles.screen}><Text style={styles.sampleNote}>Sample clips · video publishing isn’t available yet</Text><ScrollView horizontal pagingEnabled style={styles.screen} contentContainerStyle={styles.clips}>{clips.map((post) => <View key={post.id} style={styles.clip}><View style={styles.clipCanvas}><Ionicons name="play" size={42} color="#FFFFFF" /><Text style={styles.clipAlt}>{post.media?.[0]?.altText}</Text><View style={styles.clipOverlay}><Text style={styles.clipAuthor}>{post.author.displayName} <Text style={styles.clipHandle}>{post.author.handle}</Text></Text><Text style={styles.clipBody}>{post.body}</Text><Text style={styles.clipSource}>From {post.provenance.connectorId}</Text></View></View></View>)}</ScrollView></View>;
}

function Avatar({ initials, imageUrl }: { initials: string; imageUrl?: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const [failed, setFailed] = useState(false);
  const url = failed ? undefined : safeHttpsUrl(imageUrl);
  return <View style={styles.avatar}>{url ? <Image source={{ uri: url }} accessibilityIgnoresInvertColors onError={() => setFailed(true)} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initials}</Text>}</View>;
}

/** Shared images keep their own shape (within limits) and disappear quietly if they fail to load. */
function PostImage({ url, altText }: { url: string; altText: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [aspectRatio, setAspectRatio] = useState(4 / 3); const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; Image.getSize(url, (width, height) => { if (live && width && height) setAspectRatio(Math.min(2, Math.max(0.8, width / height))); }, () => undefined); return () => { live = false; }; }, [url]);
  if (failed) return null;
  return <Image source={{ uri: url }} accessible accessibilityLabel={altText} accessibilityIgnoresInvertColors resizeMode="cover" onError={() => setFailed(true)} style={[styles.postImage, { aspectRatio }]} />;
}
function Action({ icon, count }: { icon: keyof typeof Ionicons.glyphMap; count: number }) { const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); return <View style={styles.action}><Ionicons name={icon} size={17} color={colors.textSecondary} /><Text style={styles.actionText}>{count}</Text></View>; }

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, stream: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 26, paddingBottom: 70 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22 }, headerCopy: { flex: 1 }, title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }, subtitle: { marginTop: 5, color: colors.textSecondary, fontSize: 13 }, segment: { flexDirection: 'row', padding: 3, borderRadius: 18, backgroundColor: colors.chrome }, segmentButton: { minHeight: 32, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, segmentActive: { backgroundColor: colors.text }, segmentText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' }, segmentTextActive: { color: colors.surface }, composer: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: colors.border }, composerText: { flex: 1, color: colors.textTertiary, fontSize: 16 }, composerOpen: { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 14, gap: 10 }, composerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, composerInput: { flex: 1, minHeight: 96, paddingTop: 8, color: colors.text, fontSize: 17, lineHeight: 24, textAlignVertical: 'top', outlineStyle: 'none' } as object, composerFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 }, composerHint: { flex: 1, color: colors.textTertiary, fontSize: 12 }, composerOver: { color: colors.danger }, composerError: { color: colors.danger, fontSize: 13 }, composerCancel: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center' }, composerCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' }, composerPost: { minHeight: 40, minWidth: 76, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.text }, composerPostDisabled: { opacity: 0.35 }, composerPostText: { color: colors.surface, fontSize: 14, fontWeight: '700' }, avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }, avatarText: { color: colors.surface, fontSize: 12, fontWeight: '800' }, avatarImage: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.chrome }, post: { paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: colors.border }, postHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 }, author: { flex: 1 }, authorName: { color: colors.text, fontSize: 14, fontWeight: '700' }, meta: { marginTop: 2, color: colors.textTertiary, fontSize: 12 }, body: { marginTop: 13, color: colors.text, fontSize: 16, lineHeight: 23 }, postTitle: { marginTop: 13, color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.2 }, bodyAfterTitle: { marginTop: 6, color: colors.textSecondary, fontSize: 15, lineHeight: 22 }, postImage: { width: '100%', marginTop: 15, borderRadius: 18, backgroundColor: colors.chrome }, newPosts: { position: 'absolute', zIndex: 10, top: 14, alignSelf: 'center', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.text, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 }, newPostsText: { color: colors.surface, fontSize: 13, fontWeight: '700' }, composerNotice: { paddingHorizontal: 4, paddingBottom: 10, color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, composerPublic: { color: colors.textTertiary, fontSize: 11 }, sharingTo: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4 }, sharingToStrong: { color: colors.text, fontWeight: '700' }, destinations: { gap: 2, padding: 8, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, destination: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }, destinationName: { color: colors.text, fontSize: 14, fontWeight: '600' }, destinationOff: { color: colors.textTertiary }, destinationNote: { flex: 1, textAlign: 'right', color: colors.textTertiary, fontSize: 12 }, crossPostResult: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.chrome }, crossPostResultText: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 }, crossPostReason: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, showMore: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }, original: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' }, sourceNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.chrome }, sourceNoticeText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, sourceNoticeButton: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.border }, explanationSubtitle: { marginTop: 10, marginBottom: 4, color: colors.text, fontSize: 12, fontWeight: '700' }, media: { minHeight: 240, marginTop: 15, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 18, backgroundColor: '#545451' }, video: { minHeight: 360, backgroundColor: '#222220' }, alt: { maxWidth: 300, color: '#FFFFFF', textAlign: 'center', fontSize: 12, lineHeight: 18 }, actions: { marginTop: 15, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 22, rowGap: 4 }, action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, actionText: { color: colors.textSecondary, fontSize: 12 }, why: { marginLeft: 'auto', minHeight: 32, justifyContent: 'center' }, whyAfterLink: { marginLeft: 0 }, whyText: { color: colors.textSecondary, fontSize: 12, textDecorationLine: 'underline' }, explanation: { marginTop: 10, padding: 14, borderRadius: 14, backgroundColor: colors.chrome }, explanationTitle: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 8 }, explanationItem: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, notUsed: { marginTop: 8, color: colors.textTertiary, fontSize: 12, lineHeight: 15 }, clips: { flexGrow: 1, alignItems: 'stretch', padding: 18, gap: 18 }, clip: { width: Platform.OS === 'web' ? 410 : 330, maxWidth: '90vw' as never }, clipCanvas: { flex: 1, minHeight: 560, padding: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#181818', overflow: 'hidden' }, clipAlt: { maxWidth: 260, marginTop: 14, color: '#AAAAA6', textAlign: 'center', fontSize: 12, lineHeight: 18 }, clipOverlay: { position: 'absolute', left: 20, right: 20, bottom: 22 }, clipAuthor: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' }, clipHandle: { color: '#B9B9B4', fontWeight: '400' }, clipBody: { marginTop: 8, color: '#FFFFFF', fontSize: 14, lineHeight: 20 }, clipSource: { marginTop: 9, color: '#A4A49E', fontSize: 12 }, sampleNote: { paddingHorizontal: 18, paddingTop: 14, color: colors.textTertiary, fontSize: 12 }, status: { alignItems: 'center', gap: 8, paddingVertical: 36 }, statusText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }, emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, statusButton: { minHeight: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: colors.border }, statusButtonText: { color: colors.text, fontSize: 12, fontWeight: '700' }, loadMore: { alignSelf: 'center', marginTop: 20 }, menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, menu: { marginTop: 12, padding: 10, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }, menuRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, menuChip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border }, menuLabel: { paddingBottom: 4, color: colors.textTertiary, fontSize: 12, fontWeight: '700' }, menuItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }, menuText: { color: colors.text, fontSize: 13, fontWeight: '600' }, menuChipDanger: { borderColor: colors.danger }, menuDanger: { color: colors.danger, fontSize: 13, fontWeight: '700' }, menuNotice: { padding: 4, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
}); }

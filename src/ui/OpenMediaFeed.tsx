import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { EventCard, ListingCard, ListingFields, PaidPostBlock, PaidPostFields, PaidPostInput } from './ListingCards';
import { PaymentSheet, PaymentTarget } from './PaymentSheet';
import { PersonLink, targetForPost, usePeople } from './people';
import { Text, TextInput } from './Text';

import { createClientId } from '../data/openMediaService';
import { crossPost } from '../data/crossPostService';
import { interleaveEvents, loadUpcomingEvents } from '../data/eventsService';
import { PostReportReason, publishListing, publishPaidPost, publishPost, rateListing } from '../data/postService';
import { loadPaidContent } from '../data/paymentsService';
import { ListingInput, listingLine, parsePrice, validateListing } from '../domain/listings';
import { reportChoices } from '../domain/listingSafety';
import { crossPostVideo, discardPreparedVideo, draftCrossPostVideo, prepareVideo, PreparedVideo, uploadPostVideo, UploadedVideo, VideoError } from '../data/videoUpload';
import { CrossPostOutcome, CrossPostVideo, destinationSummary, outcomeSummary, prepareCrossPost } from '../domain/crossPosting';
import { NetworkId, networks, safeHttpsUrl, sourceName } from '../domain/networkPosts';
import { FeedLens, LensContext, lensKeeps } from '../domain/feedLenses';
import { explainFeedPost, FeedMode, selectFeed, SocialPost } from '../domain/posts';
import { formatBytes, formatDuration, maxVideoBytes, maxVideoSeconds } from '../domain/postVideo';
import { formatRelativeTime, maxPostLength } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { ClipVideo } from './ClipVideo';
import { canRecordVideo, pickVideo } from './pickVideo';
import { useCrossPosting } from './useCrossPosting';
import type { FeedSourceStatus } from './useMixedFeed';
import { VerifiedTick } from './VerifiedTick';

export interface FeedViewer { id: string; initials: string }

export interface FeedViewProps {
  /** The lens ordering the Feed (ADR 0017): Raw, Relevant or one the person saved. */
  lens: FeedLens;
  /** Every lens the picker can offer. */
  lenses: FeedLens[];
  onLensChange: (id: string) => void;
  /** What the lens may read about the viewer (follows, interests); its permissions narrow it. */
  lensContext?: LensContext;
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

export function FeedView({ lens, lenses, onLensChange, lensContext, posts, loading, error, hasMore, onRetry, onLoadMore, sources, loadingMore = false, pendingCount = 0, onShowPending, viewer, composing = false, onComposingChange, onPublished, onDeletePost, onReportPost }: FeedViewProps) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  // Upcoming public events sit among posts in the mixed Feed; they never push posts out.
  const events = useUpcomingEvents(Boolean(sources));
  // Events keep their own soonest-first order but still obey the lens's filters.
  const ordered = useMemo(() => interleaveEvents(selectFeed(posts, lens, lensContext), events.filter((event) => lensKeeps(event, lens, lensContext).kept)), [posts, lens, lensContext, events]);
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
  // A lens that keeps few of the loaded posts pulls in a few more pages on its own, so a strict lens
  // never leaves a near-empty Feed waiting for a scroll that cannot happen.
  const extraPages = useRef({ lens: lens.id, count: 0 });
  useEffect(() => {
    if (extraPages.current.lens !== lens.id) extraPages.current = { lens: lens.id, count: 0 };
    if (!canLoadMore || ordered.length >= 8 || !posts.length || extraPages.current.count >= 3) return;
    // Spaced out, so the open networks' public APIs are never asked for pages back to back.
    const timer = setTimeout(() => { extraPages.current.count += 1; onLoadMore(); }, 1500);
    return () => clearTimeout(timer);
  }, [lens.id, canLoadMore, ordered.length, posts.length, onLoadMore]);
  const jumpToNew = () => { onShowPending?.(); scroller.current?.scrollTo({ y: 0, animated: true }); };
  // iOS moves focused fields above the keyboard through the scroll view's insets; Android (edge to edge) needs the screen to shrink.
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'android' ? 'height' : undefined}>
  {pendingCount > 0 && !atTop ? <Pressable accessibilityRole="button" accessibilityLabel={`Show ${pendingCount} new ${pendingCount === 1 ? 'post' : 'posts'}`} onPress={jumpToNew} style={styles.newPosts}><Ionicons name="arrow-up" size={14} color={colors.surface} /><Text style={styles.newPostsText}>{pendingCount} new {pendingCount === 1 ? 'post' : 'posts'}</Text></Pressable> : null}
  <ScrollView ref={scroller} onScroll={onScroll} scrollEventThrottle={64} style={styles.screen} contentContainerStyle={styles.stream} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>Feed</Text><Text style={styles.subtitle}>{subtitle}</Text></View><FeedPicker value={lens.id} lenses={lenses} onChange={onLensChange} /></View>
    {showComposer ? <Composer viewer={viewer} open={composing} onOpenChange={onComposingChange} onPublished={onPublished} /> : null}
    {!error && unreachable.length ? <View style={styles.sourceNotice}><Text accessibilityLiveRegion="polite" style={styles.sourceNoticeText}>{unreachable.map((item) => sourceName(item.id)).join(', ')} {unreachable.length === 1 ? 'isn’t' : 'aren’t'} loading right now. Everything else is up to date.</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.sourceNoticeButton}><Text style={styles.statusButtonText}>Retry</Text></Pressable></View> : null}
    {ordered.map((post) => <PostCard key={post.id} post={post} mode={lens} lensContext={lensContext} viewer={viewer} onDelete={onDeletePost} onReport={onReportPost} />)}
    {loading || loadingMore ? <View style={styles.status}><ActivityIndicator color={colors.text} /></View> : null}
    {!loading && error ? <View style={styles.status}><Text accessibilityLiveRegion="assertive" style={styles.statusText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.statusButton}><Text style={styles.statusButtonText}>Try again</Text></Pressable></View> : null}
    {!loading && !loadingMore && !error && !ordered.length ? <View style={styles.status}><Ionicons name="newspaper-outline" size={26} color={colors.textSecondary} /><Text style={styles.emptyTitle}>{posts.length ? `Nothing here fits ${lens.name}` : 'No public posts yet'}</Text><Text style={styles.statusText}>{posts.length ? `${lens.name} keeps only posts that match its rules. Choose Relevant or Raw to see everything, or older posts may fit.` : viewer ? 'Be the first to share something.' : 'Sign in to share the first one.'}</Text></View> : null}
    {canLoadMore ? <Pressable accessibilityRole="button" onPress={onLoadMore} style={[styles.statusButton, styles.loadMore]}><Text style={styles.statusButtonText}>Load older posts</Text></Pressable> : null}
  </ScrollView>
  </KeyboardAvoidingView>;
}

function useUpcomingEvents(enabled: boolean): SocialPost[] {
  const [events, setEvents] = useState<SocialPost[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadUpcomingEvents().then((result) => { if (active) setEvents(result.posts); }).catch(() => undefined);
    return () => { active = false; };
  }, [enabled]);
  return events;
}

/** Where a post is in publishing. Video posts upload first, then the Open Media post is created. */
type PublishStage = 'idle' | 'preparing' | 'uploading' | 'publishing' | 'crossPosting';

/** Writing happens right in the feed: tap the row to expand it, publish, and it collapses. */
function Composer({ viewer, open, onOpenChange, onPublished }: { viewer: FeedViewer; open: boolean; onOpenChange: (open: boolean) => void; onPublished: (post: SocialPost) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [body, setBody] = useState(''); const [stage, setStage] = useState<PublishStage>('idle'); const [error, setError] = useState('');
  const busy = stage !== 'idle';
  // One client ID per draft keeps retries idempotent on the server and on every network.
  const clientId = useRef(createClientId());
  const input = useRef<TextInput>(null);
  const crossPosting = useCrossPosting();
  // Destinations follow the defaults (every connected network) until changed for this post.
  const [override, setOverride] = useState<NetworkId[]>();
  const destinations = (override ?? crossPosting.defaults).filter((network) => crossPosting.connected.includes(network));
  const [showDestinations, setShowDestinations] = useState(false);
  const [retry, setRetry] = useState<{ body: string; postId: string; outcomes: CrossPostOutcome[]; video?: CrossPostVideo }>();
  const [notice, setNotice] = useState('');
  // The attached video, already cleaned of location metadata on this device.
  const [video, setVideo] = useState<PreparedVideo>();
  const [progress, setProgress] = useState(0);
  // Set when this post offers a product or service (ADR 0013).
  const [offer, setOffer] = useState<ListingInput>();
  const [paidPart, setPaidPart] = useState<PaidPostInput>();
  const upload = useRef<AbortController>(undefined);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => () => discardPreparedVideo(video), [video]);
  const length = body.trim().length;
  const ready = !busy && (length > 0 || Boolean(video) || Boolean(offer?.title.trim())) && length <= maxPostLength;
  const draftVideo = video ? draftCrossPostVideo(video) : undefined;
  const finish = (outcomes: CrossPostOutcome[], text: string, postId: string, sent?: CrossPostVideo) => {
    // Keep the per-network result open when something was skipped, failed, or arrived differently.
    if (outcomes.some((outcome) => outcome.status !== 'published' || outcome.message)) setRetry({ body: text, postId, outcomes, video: sent });
    else { setRetry(undefined); setNotice(outcomeSummary(outcomes)); onOpenChange(false); }
  };
  const attach = async (source: 'library' | 'camera') => {
    setError('');
    const picked = await pickVideo(source);
    if ('cancelled' in picked) return;
    if ('error' in picked) { setError(picked.error); return; }
    setStage('preparing');
    try { setVideo(await prepareVideo(picked.video)); }
    catch (reason) { setError(reason instanceof VideoError ? reason.message : 'Open Media couldn’t use that video. Try another one.'); }
    finally { setStage('idle'); }
  };
  const publish = async () => {
    setError(''); setRetry(undefined);
    const text = body; const postId = clientId.current; const chosen = destinations; const attached = video;
    const checked = offer ? validateListing(offer) : undefined;
    if (checked && 'error' in checked) { setError(checked.error); return; }
    const paidPrice = paidPart ? parsePrice(paidPart.price, 'USD') : null;
    if (paidPart && (!text.trim() || !paidPart.text.trim())) { setError('A paid post needs a free preview above and a paid part.'); return; }
    if (paidPart && (typeof paidPrice !== 'number' || paidPrice < 50)) { setError('Set a price of at least 0.50 US dollars.'); return; }
    try {
      let uploaded: UploadedVideo | undefined;
      if (attached) {
        setStage('uploading'); setProgress(0);
        upload.current = new AbortController();
        uploaded = await uploadPostVideo(attached, postId, setProgress, upload.current.signal);
      }
      setStage('publishing');
      const post = checked ? await publishListing(text, postId, checked.listing)
        : paidPart ? await publishPaidPost(text, postId, paidPart.text, paidPrice as number, 'USD')
        : await publishPost(text, postId, uploaded?.stored);
      // Other networks get the listing as plain text: what it is, the price, and the caption.
      const shared = checked ? [`${checked.listing.title} · ${listingLine(checked.listing)}`, text.trim()].filter(Boolean).join('\n\n') : text;
      const sent = attached && uploaded ? crossPostVideo(attached, uploaded, post.media?.[0]?.altText ?? 'Video') : undefined;
      setBody(''); setOffer(undefined); setPaidPart(undefined); clientId.current = createClientId(); setOverride(undefined); setShowDestinations(false); onPublished(post);
      setStage('crossPosting');
      finish(chosen.length ? await crossPost(shared, chosen, postId, sent) : [], shared, postId, sent);
      setVideo(undefined);
    }
    catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') setError('Upload cancelled. Your draft is still here.');
      else setError(reason instanceof Error ? reason.message : 'Publishing failed.');
    }
    finally { setStage('idle'); upload.current = undefined; }
  };
  const retryMissed = async () => {
    if (!retry) return;
    setStage('crossPosting');
    const missed = retry.outcomes.filter((outcome) => outcome.status !== 'published').map((outcome) => outcome.network);
    try { finish(await crossPost(retry.body, missed, retry.postId, retry.video), retry.body, retry.postId, retry.video); }
    finally { setStage('idle'); }
  };
  const cancel = () => {
    if (stage === 'uploading') { upload.current?.abort(); return; }
    setError(''); onOpenChange(false);
  };
  const toggle = (network: NetworkId) => setOverride(destinations.includes(network) ? destinations.filter((item) => item !== network) : [...destinations, network]);
  if (!open) return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Write a public post" onPress={() => onOpenChange(true)} style={styles.composer}><Avatar initials={viewer.initials} /><Text style={styles.composerText}>Share something publicly…</Text></Pressable>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.composerNotice}>{notice}</Text> : null}
  </View>;
  const status = stage === 'preparing' ? 'Checking the video and removing location data…'
    : stage === 'uploading' ? `Uploading video… ${Math.round(progress * 100)}%`
    : stage === 'publishing' ? 'Publishing to Open Media…'
    : stage === 'crossPosting' ? (video ? 'Sending to your other networks. Videos can take a minute…' : 'Sending to your other networks…')
    : '';
  return <View style={[styles.composer, styles.composerOpen]}>
    <View style={styles.composerTop}><Avatar initials={viewer.initials} /><TextInput ref={input} accessibilityLabel="Post text" multiline maxLength={maxPostLength + 200} value={body} onChangeText={setBody} placeholder={video ? 'Say something about your video (optional)' : offer ? 'Describe it (optional)' : 'What’s on your mind?'} placeholderTextColor={colors.textTertiary} style={styles.composerInput} /></View>
    {offer ? <ListingFields value={offer} onChange={setOffer} onRemove={() => setOffer(undefined)} disabled={busy} /> : null}
    {paidPart ? <PaidPostFields value={paidPart} onChange={setPaidPart} onRemove={() => setPaidPart(undefined)} disabled={busy} /> : null}
    {video ? <View style={styles.attachment}>
      <FeedVideo uri={video.previewUri} streaming="progressive" posterUrl={undefined} aspectRatio={video.width / video.height} altText="Your video" />
      <View style={styles.attachmentRow}>
        <Text style={styles.attachmentMeta}>{formatDuration(video.durationSeconds)} · {formatBytes(video.bytes.length)}{video.removedMetadata ? ' · Location and device details removed' : ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove video" disabled={busy} onPress={() => setVideo(undefined)} style={styles.menuChip}><Text style={styles.menuText}>Remove</Text></Pressable>
      </View>
    </View> : null}
    {status ? <View accessibilityLiveRegion="polite" style={styles.progress}>
      <Text style={styles.composerHint}>{status}</Text>
      {stage === 'uploading' ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View> : null}
    </View> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.composerError}>{error}</Text> : null}
    {retry ? <View style={styles.crossPostResult}>
      <Text accessibilityLiveRegion="polite" style={styles.crossPostResultText}>{outcomeSummary(retry.outcomes)}</Text>
      {retry.outcomes.filter((outcome) => outcome.message).map((outcome) => <Text key={outcome.network} style={styles.crossPostReason}>{networks[outcome.network].displayName} · {outcomeLabel(outcome)}: {outcome.message}</Text>)}
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
        const prepared = prepareCrossPost(body || (draftVideo ? '' : ' x'), item.network, draftVideo);
        return <Pressable key={item.network} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggle(item.network)} style={styles.destination}>
          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? colors.text : colors.textTertiary} />
          <Text style={styles.destinationName}>{name}</Text>
          <Text numberOfLines={2} style={[styles.destinationNote, selected && !prepared.ok && styles.composerOver]}>{selected && !prepared.ok ? prepared.reason : selected && prepared.ok && prepared.note ? prepared.note : item.account.handle}</Text>
        </Pressable>;
      })}
    </View> : null}
    <View style={styles.composerFooter}>
      {!video && !offer && !paidPart ? <Pressable accessibilityRole="button" accessibilityLabel="Offer a product or service" disabled={busy} onPress={() => setOffer({ kind: 'product', title: '', currency: 'USD' })} style={styles.attachButton}><Ionicons name="pricetag-outline" size={20} color={colors.textSecondary} /></Pressable> : null}
      {!video && !offer && !paidPart ? <Pressable accessibilityRole="button" accessibilityLabel="Make a paid post" disabled={busy} onPress={() => setPaidPart({ price: '', text: '' })} style={styles.attachButton}><Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} /></Pressable> : null}
      {!video && !offer && !paidPart ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Add a video" disabled={busy} onPress={() => attach('library')} style={styles.attachButton}><Ionicons name="film-outline" size={20} color={colors.textSecondary} /></Pressable>
        {canRecordVideo ? <Pressable accessibilityRole="button" accessibilityLabel="Record a video" disabled={busy} onPress={() => attach('camera')} style={styles.attachButton}><Ionicons name="videocam-outline" size={20} color={colors.textSecondary} /></Pressable> : null}
      </> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDestinations }} accessibilityLabel={`Sharing to ${destinationSummary(destinations)}. Change destinations`} onPress={() => setShowDestinations((value) => !value)} style={styles.sharingTo}>
        <Text numberOfLines={1} style={[styles.composerHint, length > maxPostLength && styles.composerOver]}>Sharing to <Text style={styles.sharingToStrong}>{destinationSummary(destinations)}</Text>{length > maxPostLength - 200 ? ` · ${length}/${maxPostLength}` : ''}</Text>
        <Ionicons name={showDestinations ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy && stage !== 'uploading'} onPress={cancel} style={styles.composerCancel}><Text style={styles.composerCancelText}>{stage === 'uploading' ? 'Stop upload' : 'Cancel'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!ready} onPress={publish} style={[styles.composerPost, !ready && styles.composerPostDisabled]}>{busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.composerPostText}>Post</Text>}</Pressable>
    </View>
    <Text style={styles.composerPublic}>Public · anyone can read it{video ? ' and watch the video' : ''}, here and on every network it goes to · Videos up to {formatDuration(maxVideoSeconds)} and {formatBytes(maxVideoBytes)}</Text>
  </View>;
}

function outcomeLabel(outcome: CrossPostOutcome) {
  return outcome.status === 'published' ? 'Posted' : outcome.status === 'skipped' ? 'Skipped' : 'Failed';
}

function listFormat(items: string[]) {
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Relevant, Raw, and Work or the saved lens in use (or the most recent one), so the control never grows
 * past three choices. Other saved lenses are reached by name from Search.
 */
export function FeedPicker({ value, lenses = [], onChange }: { value: string; lenses?: FeedLens[]; onChange: (id: string) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  // Work and saved lenses share the third place: the one in use, or the most recent saved lens.
  const custom = lenses.filter((item) => !item.builtIn || (item.id !== 'relevant' && item.id !== 'raw'));
  const third = custom.find((item) => item.id === value) ?? custom.find((item) => !item.builtIn);
  const choices = [{ id: 'relevant', name: 'Relevant' }, { id: 'raw', name: 'Raw' }, ...(third ? [{ id: third.id, name: third.name }] : [])];
  return <View accessibilityRole="tablist" accessibilityLabel="Feed lens" style={styles.segment}>{choices.map((choice) => <Pressable key={choice.id} accessibilityRole="tab" accessibilityLabel={choice.id === third?.id ? `${choice.name}, your lens` : choice.name} accessibilityState={{ selected: value === choice.id }} onPress={() => onChange(choice.id)} style={[styles.segmentButton, value === choice.id && styles.segmentActive]}><Text numberOfLines={1} style={[styles.segmentText, choice.id === third?.id && styles.segmentCustom, value === choice.id && styles.segmentTextActive]}>{choice.name}</Text></Pressable>)}</View>;
}

export function PostCard({ post, mode, lensContext, viewer, onDelete, onReport }: { post: SocialPost; mode: FeedMode | FeedLens; lensContext?: LensContext; viewer?: FeedViewer; onDelete?: (postId: string) => Promise<void>; onReport?: (postId: string, reason: PostReportReason) => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const [expanded, setExpanded] = useState(false); const [menuOpen, setMenuOpen] = useState(false); const explanation = explainFeedPost(post, mode, lensContext);
  const native = post.provenance.connectorId === 'open-media';
  const own = Boolean(native && viewer && viewer.id === post.author.id);
  const canAct = native && (own ? Boolean(onDelete) : Boolean(viewer && onReport));
  // Event cards carry their own link to the official page.
  const original = native || post.event ? undefined : safeHttpsUrl(post.provenance.canonicalURL);
  const network = networks[post.provenance.connectorId as keyof typeof networks];
  const image = post.media?.[0];
  // External posts can be long; Open Media posts are short enough to show whole.
  const long = !native && !post.title && (post.body.length > 420 || post.body.split('\n').length > 8);
  const [showAll, setShowAll] = useState(false);
  const [payTarget, setPayTarget] = useState<PaymentTarget>();
  const [paid, setPaid] = useState(post.paid);
  const reloadPaid = () => { loadPaidContent(post.id).then((content) => setPaid({ priceMinor: content.priceMinor, currency: content.currency, unlocked: content.unlocked, ...(content.body ? { body: content.body } : {}) })).catch(() => undefined); };
  const people = usePeople();
  return <View style={styles.post}>
    <View style={styles.postHeader}><PersonLink target={targetForPost(post)} label={`Open ${post.author.displayName}’s profile`} style={styles.authorLink}><View style={styles.authorLinkInner}><Avatar initials={post.author.initials} imageUrl={post.author.avatarUrl} /><View style={styles.author}><View style={styles.nameLine}><Text numberOfLines={1} style={[styles.authorName, styles.nameShrink]}>{post.author.displayName}</Text>{post.author.verified ? <VerifiedTick size={14} /> : null}</View><Text numberOfLines={1} style={styles.meta}>{post.event ? `Upcoming event · from ${post.author.handle}` : `${post.author.handle} · ${formatRelativeTime(post.createdAt)} · ${sourceName(post.provenance.connectorId)}`}</Text></View></View></PersonLink>{canAct ? <Pressable accessibilityRole="button" accessibilityLabel="Post options" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen((value) => !value)} style={styles.menuButton}><Ionicons name={menuOpen ? 'close' : 'ellipsis-horizontal'} size={18} color={colors.textSecondary} /></Pressable> : null}</View>
    {menuOpen ? <PostMenu own={own} listing={Boolean(post.listing)} onDelete={() => onDelete!(post.id)} onReport={(reason) => onReport!(post.id, reason)} onTip={native && !own && viewer && post.author.tipsEnabled ? () => { setMenuOpen(false); setPayTarget({ kind: 'tip', postId: post.id }); } : undefined} tipTo={post.author.handle} /> : null}
    {post.title ? <Text selectable style={styles.postTitle}>{post.title}</Text> : null}
    {post.body && post.body !== post.listing?.title ? <Text selectable numberOfLines={long && !showAll ? 8 : undefined} style={[styles.body, post.title ? styles.bodyAfterTitle : null]}>{post.body}</Text> : null}
    {post.listing ? <ListingCard listing={post.listing} onMessage={native && !own && people?.message ? () => people.message!(post.author.handle.replace(/^@/, '')) : undefined} onRate={native && !own && viewer ? (stars) => rateListing(post.id, stars) : undefined} onBuy={native && !own && viewer && post.listing ? () => setPayTarget({ kind: 'listing', postId: post.id, listing: post.listing! }) : undefined} /> : null}
    {post.event ? <EventCard event={post.event} /> : null}
    {paid ? <PaidPostBlock paid={paid} onUnlock={native && !own && viewer && !paid.unlocked ? () => setPayTarget({ kind: 'paid_post', postId: post.id, paid }) : undefined} /> : null}
    {payTarget ? <PaymentSheet target={payTarget} recipient={post.author.handle.replace(/^@/, '')} onClose={() => setPayTarget(undefined)} onPaid={payTarget.kind === 'paid_post' ? reloadPaid : undefined} /> : null}
    {long ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }} onPress={() => setShowAll((value) => !value)} style={styles.showMore}><Text style={styles.whyText}>{showAll ? 'Show less' : 'Show more'}</Text></Pressable> : null}
    {image?.kind === 'image' && image.url ? <PostImage url={image.url} altText={image.altText} /> : image?.kind === 'video' && image.url ? <FeedVideo uri={image.url} streaming={image.streaming} posterUrl={image.posterUrl} aspectRatio={image.aspectRatio} altText={image.altText} /> : image ? <View accessibilityLabel={image.altText} style={[styles.media, post.kind === 'video' && styles.video]}><Ionicons name={post.kind === 'video' ? 'play' : 'image-outline'} size={30} color="#FFFFFF" /><Text style={styles.alt}>{image.altText}</Text></View> : null}
    <View style={styles.actions}>{post.engagement ? <><Action icon="chatbubble-outline" count={post.engagement.replies} /><Action icon="repeat-outline" count={post.engagement.reposts} /><Action icon="heart-outline" count={post.engagement.likes} /></> : null}{original ? <Pressable accessibilityRole="link" accessibilityLabel={`Open this post on ${sourceName(post.provenance.connectorId)}`} onPress={() => { Linking.openURL(original).catch(() => undefined); }} style={styles.original}><Text style={styles.whyText}>Open on {sourceName(post.provenance.connectorId)}</Text><Ionicons name="open-outline" size={12} color={colors.textSecondary} /></Pressable> : null}<Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={[styles.why, original ? styles.whyAfterLink : null]}><Text style={styles.whyText}>Why this?</Text></Pressable></View>
    {expanded ? <View style={styles.explanation}><Text style={styles.explanationTitle}>Why you’re seeing this</Text>{explanation.used.map((item) => <Text key={item} style={styles.explanationItem}>✓ {item}</Text>)}<Text style={styles.explanationSubtitle}>How {explanation.lens} works</Text><Text style={styles.explanationItem}>{explanation.rules.join(' · ')}</Text>{explanation.filters.length ? <><Text style={styles.explanationSubtitle}>Filters applied to {sourceName(post.provenance.connectorId)}</Text>{explanation.filters.map((item) => <Text key={item} style={styles.explanationItem}>· {item}</Text>)}<Text style={styles.notUsed}>Filtered posts stay on {sourceName(post.provenance.connectorId)}; Open Media only leaves them out of this Feed.{network ? ` ${network.about}` : ''}</Text></> : null}{explanation.checks?.map((item) => <Text key={item} style={styles.explanationItem}>✓ {item}</Text>)}<Text style={styles.notUsed}>Not used: {explanation.notUsed.join(', ')}</Text></View> : null}
  </View>;
}

function PostMenu({ own, listing, onDelete, onReport, onTip, tipTo }: { own: boolean; listing: boolean; onDelete: () => Promise<void>; onReport: (reason: PostReportReason) => Promise<void>; onTip?: () => void; tipTo?: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [confirming, setConfirming] = useState(false);
  const run = async (action: () => Promise<void>, done: string) => { setBusy(true); setNotice(''); try { await action(); setNotice(done); } catch (reason) { setNotice(reason instanceof Error ? reason.message : 'That didn’t work. Try again.'); } finally { setBusy(false); } };
  return <View style={styles.menu}>
    {onTip && !busy && !notice ? <Pressable accessibilityRole="button" onPress={onTip} style={styles.menuItem}><Ionicons name="heart-outline" size={16} color={colors.text} /><Text style={styles.menuLabel}>{`Tip ${tipTo ?? 'the creator'}`}</Text></Pressable> : null}
    {busy ? <ActivityIndicator color={colors.text} /> : notice ? <Text accessibilityLiveRegion="polite" style={styles.menuNotice}>{notice}</Text> : own
      ? confirming
        ? <><Text style={styles.menuLabel}>Delete this post permanently? It disappears for everyone, including the public API.</Text><View style={styles.menuRow}><Pressable accessibilityRole="button" onPress={() => run(onDelete, 'Post deleted.')} style={[styles.menuChip, styles.menuChipDanger]}><Text style={styles.menuDanger}>Delete</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.menuChip}><Text style={styles.menuText}>Cancel</Text></Pressable></View></>
        : <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.menuItem}><Ionicons name="trash-outline" size={16} color={colors.danger} /><Text style={styles.menuDanger}>Delete post</Text></Pressable>
      : <><Text style={styles.menuLabel}>Report this post</Text><View style={styles.menuRow}>{reportChoices(listing).map(([reason, label]) => <Pressable key={reason} accessibilityRole="button" onPress={() => run(() => onReport(reason), 'Thanks for reporting. Posts reported by several people are hidden for review.')} style={styles.menuChip}><Text style={styles.menuText}>{label}</Text></Pressable>)}</View></>}
  </View>;
}

function Avatar({ initials, imageUrl }: { initials: string; imageUrl?: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]); const [failed, setFailed] = useState(false);
  const url = failed ? undefined : safeHttpsUrl(imageUrl);
  return <View style={styles.avatar}>{url ? <Image source={{ uri: url }} accessibilityIgnoresInvertColors onError={() => setFailed(true)} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initials}</Text>}</View>;
}

/** Feed videos show their poster until tapped, then play inline with sound; tap again to pause. */
function FeedVideo({ uri, streaming, posterUrl, aspectRatio, altText }: { uri: string; streaming?: 'hls' | 'progressive'; posterUrl?: string; aspectRatio: number; altText: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [started, setStarted] = useState(false); const [playing, setPlaying] = useState(false); const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  if (failed) return null;
  const frame = [styles.feedVideo, { aspectRatio: Math.max(aspectRatio, 4 / 5) }];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : 'Play'} video: ${altText}`} onPress={() => { setStarted(true); setPlaying((value) => !value); }} style={frame}>
    {started ? <ClipVideo uri={uri} streaming={streaming} posterUrl={posterUrl} active={playing} muted={false} contentFit="contain" onError={onError} style={StyleSheet.absoluteFill} /> : posterUrl ? <Image source={{ uri: posterUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} /> : null}
    {!playing ? <View style={styles.feedVideoPlay}><Ionicons name="play" size={30} color="#FFFFFF" /></View> : null}
  </Pressable>;
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
  screen: { flex: 1, backgroundColor: colors.surface }, stream: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 26, paddingBottom: 70 }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22 }, headerCopy: { flex: 1, minWidth: 220 }, title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }, subtitle: { marginTop: 5, color: colors.textSecondary, fontSize: 13 }, segment: { flexDirection: 'row', padding: 3, borderRadius: 18, backgroundColor: colors.chrome }, segmentButton: { minHeight: 32, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, segmentActive: { backgroundColor: colors.text }, segmentText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' }, segmentTextActive: { color: colors.surface }, segmentCustom: { maxWidth: 104 }, composer: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: colors.border }, composerText: { flex: 1, color: colors.textTertiary, fontSize: 16 }, composerOpen: { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 14, gap: 10 }, composerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, composerInput: { flex: 1, minHeight: 96, paddingTop: 8, color: colors.text, fontSize: 17, lineHeight: 24, textAlignVertical: 'top', outlineStyle: 'none' } as object, composerFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 }, composerHint: { flex: 1, color: colors.textTertiary, fontSize: 12 }, composerOver: { color: colors.danger }, composerError: { color: colors.danger, fontSize: 13 }, composerCancel: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center' }, composerCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' }, composerPost: { minHeight: 40, minWidth: 76, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.text }, composerPostDisabled: { opacity: 0.35 }, composerPostText: { color: colors.surface, fontSize: 14, fontWeight: '700' }, avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }, avatarText: { color: colors.surface, fontSize: 12, fontWeight: '800' }, avatarImage: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.chrome }, post: { paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: colors.border }, postHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 }, authorLink: { flex: 1, minWidth: 0 }, authorLinkInner: { flexDirection: 'row', alignItems: 'center', gap: 11 }, author: { flex: 1 }, authorName: { color: colors.text, fontSize: 14, fontWeight: '700' }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 }, nameShrink: { flexShrink: 1 }, meta: { marginTop: 2, color: colors.textTertiary, fontSize: 12 }, body: { marginTop: 13, color: colors.text, fontSize: 16, lineHeight: 23 }, postTitle: { marginTop: 13, color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.2 }, bodyAfterTitle: { marginTop: 6, color: colors.textSecondary, fontSize: 15, lineHeight: 22 }, postImage: { width: '100%', marginTop: 15, borderRadius: 18, backgroundColor: colors.chrome }, newPosts: { position: 'absolute', zIndex: 10, top: 14, alignSelf: 'center', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.text, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 }, newPostsText: { color: colors.surface, fontSize: 13, fontWeight: '700' }, composerNotice: { paddingHorizontal: 4, paddingBottom: 10, color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, composerPublic: { color: colors.textTertiary, fontSize: 11 }, attachButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 }, attachment: { gap: 8 }, attachmentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, attachmentMeta: { flex: 1, color: colors.textSecondary, fontSize: 12 }, progress: { gap: 6 }, progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.chrome }, progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.text }, sharingTo: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4 }, sharingToStrong: { color: colors.text, fontWeight: '700' }, destinations: { gap: 2, padding: 8, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, destination: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }, destinationName: { color: colors.text, fontSize: 14, fontWeight: '600' }, destinationOff: { color: colors.textTertiary }, destinationNote: { flex: 1, textAlign: 'right', color: colors.textTertiary, fontSize: 12 }, crossPostResult: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.chrome }, crossPostResultText: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 }, crossPostReason: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, feedVideo: { width: '100%', marginTop: 15, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }, feedVideoPlay: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.55)' }, showMore: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }, original: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' }, sourceNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.chrome }, sourceNoticeText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, sourceNoticeButton: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.border }, explanationSubtitle: { marginTop: 10, marginBottom: 4, color: colors.text, fontSize: 12, fontWeight: '700' }, media: { minHeight: 240, marginTop: 15, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 18, backgroundColor: '#545451' }, video: { minHeight: 360, backgroundColor: '#222220' }, alt: { maxWidth: 300, color: '#FFFFFF', textAlign: 'center', fontSize: 12, lineHeight: 18 }, actions: { marginTop: 15, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 22, rowGap: 4 }, action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, actionText: { color: colors.textSecondary, fontSize: 12 }, why: { marginLeft: 'auto', minHeight: 32, justifyContent: 'center' }, whyAfterLink: { marginLeft: 0 }, whyText: { color: colors.textSecondary, fontSize: 12, textDecorationLine: 'underline' }, explanation: { marginTop: 10, padding: 14, borderRadius: 14, backgroundColor: colors.chrome }, explanationTitle: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 8 }, explanationItem: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, notUsed: { marginTop: 8, color: colors.textTertiary, fontSize: 12, lineHeight: 15 }, status: { alignItems: 'center', gap: 8, paddingVertical: 36 }, statusText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }, emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, statusButton: { minHeight: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: colors.border }, statusButtonText: { color: colors.text, fontSize: 12, fontWeight: '700' }, loadMore: { alignSelf: 'center', marginTop: 20 }, menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, menu: { marginTop: 12, padding: 10, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }, menuRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, menuChip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border }, menuLabel: { paddingBottom: 4, color: colors.textTertiary, fontSize: 12, fontWeight: '700' }, menuItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }, menuText: { color: colors.text, fontSize: 13, fontWeight: '600' }, menuChipDanger: { borderColor: colors.danger }, menuDanger: { color: colors.danger, fontSize: 13, fontWeight: '700' }, menuNotice: { padding: 4, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
}); }

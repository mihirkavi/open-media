import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, LayoutChangeEvent, Linking, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PersonLink, targetForPost } from './people';
import { Text } from './Text';

import { networks, safeHttpsUrl, sourceName } from '../domain/networkPosts';
import { explainFeedPost, selectFeed, SocialPost } from '../domain/posts';
import { formatRelativeTime } from '../domain/publicPosts';
import { ClipVideo } from './ClipVideo';
import { useMixedFeed } from './useMixedFeed';
import { VerifiedTick } from './VerifiedTick';

/**
 * Clips: the same canonical posts as Feed, shown as an immersive vertical stream of short videos
 * from Open Media, Farcaster, Lens, Hive, and DeSo. One clip per screen; swipe or scroll to the next. It is
 * continuous (more clips load near the end) and live: new clips are announced by a pill and added on
 * top when tapped, so the clip someone is watching never moves or gets interrupted.
 */
export function ClipsView({ sessionKey }: { sessionKey?: string }) {
  const clips = useMixedFeed(sessionKey, 'clips');
  // Stable where it matters: the clip being watched and the next one never move. Clips from later
  // pages and slower networks merge newest-first below them; tapped-in new clips go on top.
  const [order, setOrder] = useState<string[]>([]);
  const mergeOnTop = useRef(false);
  const activeRef = useRef(0);
  // Wait for every network's first page (at most 3 s) so the opening order is newest-first overall.
  const [settled, setSettled] = useState(false);
  const allLoaded = clips.sources.every((source) => !source.loading);
  useEffect(() => { const timer = setTimeout(() => setSettled(true), 3000); return () => clearTimeout(timer); }, []);
  useEffect(() => { if (allLoaded) setSettled(true); }, [allLoaded]);
  useEffect(() => {
    if (!settled) return;
    const available = new Set(clips.posts.map((post) => post.id));
    setOrder((current) => {
      const known = new Set(current);
      const fresh = selectFeed(clips.posts.filter((post) => !known.has(post.id)), 'raw').map((post) => post.id);
      const kept = current.filter((id) => available.has(id));
      if (!fresh.length && kept.length === current.length) return current;
      const onTop = mergeOnTop.current; mergeOnTop.current = false;
      if (onTop) return [...fresh, ...kept];
      const fixed = kept.slice(0, activeRef.current + 2);
      const below = new Set([...kept.slice(activeRef.current + 2), ...fresh]);
      return [...fixed, ...selectFeed(clips.posts.filter((post) => below.has(post.id)), 'raw').map((post) => post.id)];
    });
  }, [clips.posts, settled]);
  const byId = useMemo(() => new Map(clips.posts.map((post) => [post.id, post])), [clips.posts]);
  const ordered = useMemo(() => order.map((id) => byId.get(id)).filter((post): post is SocialPost => Boolean(post)), [order, byId]);
  const scroller = useRef<ScrollView>(null);
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  activeRef.current = active;
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => ordered.filter((post) => !failed.has(post.id)), [ordered, failed]);

  useEffect(() => { if (visible.length && active >= visible.length - 3 && clips.hasMore && !clips.loadingMore && !clips.loading) clips.loadMore(); }, [active, visible.length, clips.hasMore, clips.loadingMore, clips.loading, clips.loadMore]);

  const onLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height);
  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height) return;
    const index = Math.max(0, Math.min(visible.length - 1, Math.round(nativeEvent.contentOffset.y / height)));
    if (index !== active) setActive(index);
  };
  const jumpToNew = () => { mergeOnTop.current = true; clips.showPending(); setActive(0); requestAnimationFrame(() => scroller.current?.scrollTo({ y: 0, animated: false })); };
  const markFailed = useCallback((id: string) => setFailed((current) => new Set(current).add(id)), []);

  return <View style={styles.screen} onLayout={onLayout}>
    {height ? <ScrollView ref={scroller} pagingEnabled showsVerticalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} style={styles.screen}>
      {visible.map((post, index) => <Clip key={post.id} post={post} height={height} active={index === active} mounted={Math.abs(index - active) <= 1} muted={muted} onToggleMute={() => setMuted((value) => !value)} onFailed={markFailed} />)}
      {clips.loadingMore ? <View style={[styles.status, { height: height / 3 }]}><ActivityIndicator color="#FFFFFF" /></View> : null}
    </ScrollView> : null}
    {clips.pendingCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Show ${clips.pendingCount} new ${clips.pendingCount === 1 ? 'clip' : 'clips'}`} onPress={jumpToNew} style={styles.newClips}><Ionicons name="arrow-up" size={14} color="#111111" /><Text style={styles.newClipsText}>{clips.pendingCount} new {clips.pendingCount === 1 ? 'clip' : 'clips'}</Text></Pressable> : null}
    {(clips.loading || !settled) && !visible.length ? <View style={[StyleSheet.absoluteFill, styles.status]}><ActivityIndicator color="#FFFFFF" /><Text style={styles.statusText}>Finding new clips…</Text></View> : null}
    {!clips.loading && settled && !visible.length ? <View style={[StyleSheet.absoluteFill, styles.status]}>
      <Ionicons name="film-outline" size={28} color="#B9B9B4" />
      <Text style={styles.statusText}>{clips.error || 'No clips right now.'}</Text>
      <Pressable accessibilityRole="button" onPress={clips.refresh} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
    </View> : null}
  </View>;
}

function Clip({ post, height, active, mounted, muted, onToggleMute, onFailed }: { post: SocialPost; height: number; active: boolean; mounted: boolean; muted: boolean; onToggleMute: () => void; onFailed: (id: string) => void }) {
  const media = post.media?.find((item) => item.kind === 'video');
  const [why, setWhy] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (!active) { setPaused(false); setWhy(false); } }, [active]);
  const original = safeHttpsUrl(post.provenance.canonicalURL);
  const network = sourceName(post.provenance.connectorId);
  const explanation = explainFeedPost(post, 'raw');
  const fail = useCallback(() => onFailed(post.id), [onFailed, post.id]);
  if (!media?.url) return null;
  return <View style={[styles.clip, { height }]}>
    {mounted
      ? <ClipVideo uri={media.url} streaming={media.streaming} posterUrl={media.posterUrl} active={active && !paused} muted={muted} contentFit="contain" onError={fail} style={StyleSheet.absoluteFill} />
      : media.posterUrl ? <Image source={{ uri: media.posterUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={paused ? 'Play clip' : 'Pause clip'} onPress={() => setPaused((value) => !value)} style={StyleSheet.absoluteFill}>
      {paused ? <View style={styles.pausedIcon}><Ionicons name="play" size={44} color="#FFFFFF" /></View> : null}
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn sound on' : 'Mute'} onPress={onToggleMute} style={styles.mute}><Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color="#FFFFFF" /></Pressable>
    <View pointerEvents="box-none" style={styles.overlay}>
      <PersonLink target={targetForPost(post)} label={`Open ${post.author.displayName}’s profile`} style={styles.authorLink}><Text style={styles.author}>{post.author.displayName}{post.author.verified ? <> <VerifiedTick size={14} /></> : null} <Text style={styles.handle}>{post.author.handle} · {formatRelativeTime(post.createdAt)}</Text></Text></PersonLink>
      {post.title || post.body ? <Text numberOfLines={3} style={styles.body}>{post.title ?? post.body}</Text> : null}
      <View style={styles.meta}>
        <Text style={styles.source}>{network}{media.durationSeconds ? ` · ${Math.round(media.durationSeconds)}s` : ''}</Text>
        {original ? <Pressable accessibilityRole="link" accessibilityLabel={`Open this clip on ${network}`} onPress={() => { Linking.openURL(original).catch(() => undefined); }} style={styles.link}><Text style={styles.linkText}>Open on {network}</Text><Ionicons name="open-outline" size={12} color="#E8E8E3" /></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: why }} onPress={() => setWhy((value) => !value)} style={styles.link}><Text style={styles.linkText}>Why this?</Text></Pressable>
      </View>
      {why ? <View style={styles.why}>
        {explanation.used.map((item) => <Text key={item} style={styles.whyText}>✓ {item}</Text>)}
        {explanation.filters.map((item) => <Text key={item} style={styles.whyText}>· {item}</Text>)}
        <Text style={styles.whyNote}>Filtered clips stay on {network}; Open Media only leaves them out of Clips.{networks[post.provenance.connectorId as keyof typeof networks] ? ` ${networks[post.provenance.connectorId as keyof typeof networks].about}` : ''}</Text>
      </View> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  clip: { width: '100%', backgroundColor: '#000000', overflow: 'hidden' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingLeft: 18, paddingRight: 88, paddingTop: 40, paddingBottom: 22, gap: 6, backgroundColor: 'rgba(0,0,0,0.45)' },
  authorLink: { alignSelf: 'flex-start' },
  author: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  handle: { color: '#C9C9C4', fontWeight: '400', fontSize: 13 },
  body: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 2 },
  source: { color: '#B9B9B4', fontSize: 12 },
  link: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { color: '#E8E8E3', fontSize: 12, textDecorationLine: 'underline' },
  why: { marginTop: 4, padding: 12, gap: 3, borderRadius: 12, backgroundColor: 'rgba(20,20,20,0.85)' },
  whyText: { color: '#E8E8E3', fontSize: 12, lineHeight: 17 },
  whyNote: { marginTop: 4, color: '#A4A49E', fontSize: 11, lineHeight: 15 },
  mute: { position: 'absolute', top: 16, right: 16, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)' },
  pausedIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  newClips: { position: 'absolute', zIndex: 10, top: 16, alignSelf: 'center', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#FFFFFF' },
  newClipsText: { color: '#111111', fontSize: 13, fontWeight: '700' },
  status: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#000000' },
  statusText: { color: '#D8D8D3', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  retry: { minHeight: 40, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: '#555551' },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});

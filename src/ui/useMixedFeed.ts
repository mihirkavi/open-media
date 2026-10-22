import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { FeedKind, networkConnectors } from '../connectors/networkFeeds';
import { NetworkId } from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { usePublicFeed } from './usePublicFeed';

export type FeedSourceId = 'open-media' | NetworkId;

export interface FeedSourceStatus { id: FeedSourceId; loading: boolean; error: string }

interface NetworkState { posts: SocialPost[]; cursor?: string; loading: boolean; error: string }

/** How often every source is checked for new posts while the app is in the foreground. */
export const liveUpdateIntervalMs = 20_000;

const initialNetworkState = (): Record<NetworkId, NetworkState> => Object.fromEntries(networkConnectors.map((connector): [NetworkId, NetworkState] => [connector.id, { posts: [], loading: true, error: '' }])) as Record<NetworkId, NetworkState>;

/**
 * One mixed Feed: live Open Media posts plus public posts from Farcaster, Lens, Hive, and DeSo.
 * Each source loads and fails independently, so one unreachable network never empties the Feed.
 * New posts are checked for continuously and held in `pending` until the Feed shows them, so a
 * reader who has scrolled down is never moved by content arriving above them.
 */
export function useMixedFeed(sessionKey?: string, kind: FeedKind = 'feed') {
  // Clips page through Open Media's video posts only; the server filters, so text posts never fill a page.
  const openMedia = usePublicFeed(sessionKey, true, kind === 'clips' ? 'video' : undefined);
  const fetchPage = useCallback((connector: (typeof networkConnectors)[number], cursor?: string) => kind === 'clips' ? connector.fetchClips(cursor) : connector.fetchFeed!(cursor), [kind]);
  const [state, setState] = useState(initialNetworkState);
  const [pending, setPending] = useState<SocialPost[]>([]);
  const generation = useRef(0);

  const load = useCallback(async (id: NetworkId, cursor: string | undefined, append: boolean, current: number) => {
    const connector = networkConnectors.find((item) => item.id === id)!;
    setState((existing) => ({ ...existing, [id]: { ...existing[id], loading: true, error: '' } }));
    try {
      const page = await fetchPage(connector, cursor);
      if (current !== generation.current) return;
      setState((existing) => {
        const previous = append ? existing[id].posts : [];
        const merged = [...previous, ...page.posts.filter((post) => !previous.some((item) => item.id === post.id))];
        return { ...existing, [id]: { posts: merged, cursor: page.cursor, loading: false, error: '' } };
      });
    } catch {
      if (current !== generation.current) return;
      setState((existing) => ({ ...existing, [id]: { ...existing[id], loading: false, error: `Couldn’t reach ${connector.descriptor().displayName} right now.` } }));
    }
  }, [fetchPage]);

  const refreshNetworks = useCallback(() => {
    const current = ++generation.current;
    setPending([]);
    return Promise.all(networkConnectors.map((connector) => load(connector.id, undefined, false, current)));
  }, [load]);

  useEffect(() => { refreshNetworks(); }, [refreshNetworks]);

  const refresh = useCallback(async () => { await Promise.all([openMedia.refresh(), refreshNetworks()]); }, [openMedia.refresh, refreshNetworks]);

  const loadMore = useCallback(() => {
    if (openMedia.hasMore && !openMedia.loading) openMedia.loadMore();
    networkConnectors.forEach((connector) => {
      const network = state[connector.id];
      if (network.cursor && !network.loading) load(connector.id, network.cursor, true, generation.current);
    });
  }, [openMedia.hasMore, openMedia.loading, openMedia.loadMore, state, load]);

  const shown = useMemo(() => [...openMedia.posts, ...networkConnectors.flatMap((connector) => state[connector.id].posts)], [openMedia.posts, state]);

  // ---------- live updates ----------

  const knownIds = useRef(new Set<string>());
  useEffect(() => { knownIds.current = new Set([...shown, ...pending].map((post) => post.id)); }, [shown, pending]);

  const checkForNewPosts = useCallback(async () => {
    const current = generation.current;
    const results = await Promise.allSettled([
      openMedia.fetchLatest(),
      ...networkConnectors.map((connector) => fetchPage(connector).then((page) => page.posts)),
    ]);
    if (current !== generation.current) return;
    const arrivals = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).filter((post) => !knownIds.current.has(post.id));
    // Only posts newer than what is already shown count as new; older ones arrive through scrolling.
    // Compared per source, since networks index new posts with different delays.
    const newest = new Map<string, number>();
    shown.forEach((post) => newest.set(post.provenance.connectorId, Math.max(newest.get(post.provenance.connectorId) ?? 0, Date.parse(post.createdAt) || 0)));
    const fresh = arrivals.filter((post) => (Date.parse(post.createdAt) || 0) >= (newest.get(post.provenance.connectorId) ?? 0) - 60_000);
    if (fresh.length) setPending((existing) => [...fresh.filter((post) => !existing.some((item) => item.id === post.id)), ...existing]);
  }, [openMedia.fetchLatest, shown, fetchPage]);

  const checkRef = useRef(checkForNewPosts);
  useEffect(() => { checkRef.current = checkForNewPosts; }, [checkForNewPosts]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const visible = () => AppState.currentState === 'active' && (Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState === 'visible');
    const start = () => { if (!timer && visible()) timer = setInterval(() => { checkRef.current().catch(() => undefined); }, liveUpdateIntervalMs); };
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const onChange = () => { if (visible()) { start(); checkRef.current().catch(() => undefined); } else stop(); };
    start();
    const subscription = AppState.addEventListener('change', onChange);
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onChange);
    return () => {
      stop(); subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onChange);
    };
  }, []);

  /** Moves held new posts into the Feed. */
  const showPending = useCallback(() => {
    if (!pending.length) return;
    const bySource = new Map<string, SocialPost[]>();
    pending.forEach((post) => bySource.set(post.provenance.connectorId, [...(bySource.get(post.provenance.connectorId) ?? []), post]));
    const nativePosts = bySource.get('open-media');
    if (nativePosts) openMedia.addPosts(nativePosts);
    setState((existing) => {
      const next = { ...existing };
      networkConnectors.forEach((connector) => {
        const incoming = bySource.get(connector.id);
        if (incoming) next[connector.id] = { ...existing[connector.id], posts: [...incoming.filter((post) => !existing[connector.id].posts.some((item) => item.id === post.id)), ...existing[connector.id].posts] };
      });
      return next;
    });
    setPending([]);
  }, [pending, openMedia.addPosts]);

  const sources: FeedSourceStatus[] = useMemo(() => [
    { id: 'open-media' as const, loading: openMedia.loading, error: openMedia.error },
    ...networkConnectors.map((connector) => ({ id: connector.id, loading: state[connector.id].loading, error: state[connector.id].error })),
  ], [openMedia.loading, openMedia.error, state]);

  const loading = sources.some((source) => source.loading) && !shown.length;
  const failed = sources.filter((source) => source.error);
  const error = failed.length === sources.length ? 'Couldn’t load the Feed. Check your connection and try again.' : '';
  const hasMore = openMedia.hasMore || networkConnectors.some((connector) => Boolean(state[connector.id].cursor));
  const loadingMore = sources.some((source) => source.loading) && shown.length > 0;

  return { posts: shown, sources, loading, loadingMore, error, hasMore, refresh, loadMore, pendingCount: pending.length, showPending, addPost: openMedia.addPost, removePost: openMedia.removePost };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { deleteMyLens, loadMyLenses, loadSharedLens, saveMyLens } from '../data/lensService';
import { loadMyFollows } from '../data/peopleService';
import { builtInLenses, FeedLens, LensContext, lensById, lensIdFromUrl, lensShareUrl, parseLens } from '../domain/feedLenses';

const storageKey = 'open-media.feed-lenses.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Stored { saved: unknown[]; activeId?: string; interests?: string[] }

export interface FeedLenses {
  /** The lens ordering the Feed now. */
  lens: FeedLens;
  /** Raw, Relevant and every saved lens. */
  lenses: FeedLens[];
  /** What the runner may read about the viewer; the lens's permissions narrow it further. */
  context: LensContext;
  /** Topics the viewer chose, used by lenses with the interests permission (Relevant does). */
  interests: string[];
  choose: (id: string) => void;
  /** Keeps a lens (replacing one with the same id) and shows it in the Feed; forkedFrom names a shared lens it copies. */
  apply: (lens: FeedLens, forkedFrom?: string) => void;
  remove: (id: string) => void;
  /** Shares a saved lens publicly and returns its link. Needs an account. */
  share: (id: string) => Promise<string>;
  addInterests: (topics: string[]) => void;
}

/**
 * The Feed's lenses (ADR 0017). Saved lenses and the chosen one stay on this device, and for a
 * signed-in person also in their account, so they follow them to other devices and their agents.
 * Follows are read here, once, only to give lenses that ask for them the "follows" signal.
 */
export function useFeedLenses(viewerId?: string, fallback: 'relevant' | 'raw' = 'relevant'): FeedLenses {
  const [saved, setSaved] = useState<FeedLens[]>([]);
  const [activeId, setActiveId] = useState<string>(fallback);
  const [interests, setInterests] = useState<string[]>([]);
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  const loaded = useRef(false);

  // Device copy first, so the Feed opens in the chosen lens without waiting for the network.
  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((value) => {
      const stored = value ? JSON.parse(value) as Stored : undefined;
      if (stored) {
        setSaved(validLenses(stored.saved));
        if (stored.activeId) setActiveId(stored.activeId);
        setInterests(Array.isArray(stored.interests) ? stored.interests.filter((item): item is string => typeof item === 'string').slice(0, 20) : []);
      }
    }).catch(() => undefined).finally(() => { loaded.current = true; });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(storageKey, JSON.stringify({ saved, activeId, interests } satisfies Stored)).catch(() => undefined);
  }, [saved, activeId, interests]);

  // The account's lenses win over the device's copy of the same id; lenses made on this device
  // before signing in are added to the account.
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    if (!viewerId) { setFollowed(new Set()); return; }
    let active = true;
    loadMyLenses().then((mine) => {
      if (!active) return;
      const known = new Set(mine.map((item) => item.lens.id));
      savedRef.current.filter((lens) => !known.has(lens.id)).forEach((lens) => { saveMyLens(lens).catch(() => undefined); });
      if (mine.length) setSaved((existing) => mergeLenses(existing, mine.map((item) => item.lens)));
    }).catch(() => undefined);
    loadMyFollows().then((follows) => {
      if (active) setFollowed(new Set(follows.following.filter((card) => !card.status || card.status === 'accepted').map((card) => card.id)));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [viewerId]);

  const apply = useCallback((lens: FeedLens, forkedFrom?: string) => {
    if (lens.builtIn) { setActiveId(lens.id); return; }
    setSaved((existing) => mergeLenses(existing, [lens]));
    setActiveId(lens.id);
    if (viewerId) saveMyLens(lens, 'private', forkedFrom).catch(() => undefined);
  }, [viewerId]);

  // A share link (?lens=…) opens that lens; the link is then removed from the address bar.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const id = lensIdFromUrl(window.location.search);
    if (!id) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('lens');
    window.history.replaceState(window.history.state, '', url.toString());
    if (builtInLenses.some((lens) => lens.id === id)) { setActiveId(id); return; }
    if (uuid.test(id)) loadSharedLens(id).then((shared) => { if (shared) apply(shared.lens, viewerId ? id : undefined); }).catch(() => undefined);
  }, [apply, viewerId]);

  const remove = useCallback((id: string) => {
    setSaved((existing) => existing.filter((lens) => lens.id !== id));
    setActiveId((current) => (current === id ? fallback : current));
    if (viewerId) deleteMyLens(id).catch(() => undefined);
  }, [viewerId, fallback]);

  const share = useCallback(async (id: string) => {
    if (!viewerId) throw new Error('Sign in to share a lens.');
    const lens = saved.find((item) => item.id === id);
    if (!lens) throw new Error('That lens isn’t saved.');
    const stored = await saveMyLens(lens, 'public');
    return lensShareUrl(stored.rowId);
  }, [saved, viewerId]);

  const addInterests = useCallback((topics: string[]) => {
    setInterests((existing) => [...new Set([...existing, ...topics.map((topic) => topic.toLocaleLowerCase())])].slice(0, 20));
  }, []);

  const lens = useMemo(() => lensById(activeId, saved), [activeId, saved]);
  const lenses = useMemo(() => [...builtInLenses, ...saved], [saved]);
  const context = useMemo<LensContext>(() => ({ followedAuthorIds: followed, interests }), [followed, interests]);
  return { lens, lenses, context, interests, choose: setActiveId, apply, remove, share, addInterests };
}

function validLenses(values: unknown): FeedLens[] {
  return (Array.isArray(values) ? values : []).flatMap((value) => { try { return [parseLens(value)]; } catch { return []; } }).filter((lens) => !lens.builtIn);
}

/** Newest first: incoming lenses replace saved ones with the same id and move to the front. */
function mergeLenses(existing: FeedLens[], incoming: FeedLens[]): FeedLens[] {
  const ids = new Set(incoming.map((lens) => lens.id));
  return [...incoming, ...existing.filter((lens) => !ids.has(lens.id))].slice(0, 50);
}

import { useEffect, useMemo, useRef, useState } from 'react';

import { networkSearches } from '../connectors/networkSearch';
import { loadUpcomingEvents } from '../data/eventsService';
import { Conversation } from '../domain/models';
import { NetworkId, sourceName } from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { ParsedSearch, parseSearchQuery, postMatchesSearch } from '../domain/searchQuery';
import { conversationTitle } from '../domain/selectors';
import { SettingIndexEntry, searchSettings } from '../domain/settings';

export interface SourceSearchState { id: NetworkId; status: 'searching' | 'done' | 'failed' | 'skipped'; count: number; method: string }
export type AiSummary =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'done'; answer: string; citations: string[]; basedOn: number }
  | { status: 'failed'; message: string };

const debounceMs = 450;
const aiWaitMs = 9_000;

/**
 * One search across everything: settings, messages and email, and Open Media posts are matched on
 * this device; public posts are searched live on every network. A basic AI summary of what the
 * public posts say is requested from the Open Media server, which receives only the search text and
 * public post snippets. Messages and email never leave the device.
 */
export function useUniversalSearch(query: string, loadedPosts: SocialPost[], conversations: Conversation[]) {
  const [active, setActive] = useState(query);
  useEffect(() => { const timer = setTimeout(() => setActive(query), debounceMs); return () => clearTimeout(timer); }, [query]);
  const parsed = useMemo(() => parseSearchQuery(active), [active]);
  const searchable = parsed.raw.length > 0;

  const settings: SettingIndexEntry[] = useMemo(() => (searchable ? searchSettings(parsed.raw.toLocaleLowerCase()).slice(0, 4) : []), [parsed, searchable]);
  const messages = useMemo(() => (searchable && parsed.keywords.length ? conversations.filter((conversation) => {
    const text = [conversationTitle(conversation), conversation.preview, ...conversation.messages.map((message) => message.body)].join(' ').toLocaleLowerCase();
    return parsed.keywords.every((keyword) => text.includes(keyword));
  }).slice(0, 6) : []), [parsed, conversations, searchable]);
  const localPosts = useMemo(() => (searchable && (parsed.keywords.length || parsed.structured) ? loadedPosts.filter((post) => postMatchesSearch(post, parsed)) : []), [parsed, loadedPosts, searchable]);

  const [remote, setRemote] = useState<SocialPost[]>([]);
  const [sources, setSources] = useState<SourceSearchState[]>([]);
  const [ai, setAi] = useState<AiSummary>({ status: 'idle' });
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setRemote([]); setAi({ status: 'idle' });
    // Upcoming public events are searched by the Open Media service; posts on other networks aren't events.
    if (parsed.structured === 'event') {
      setSources([]);
      loadUpcomingEvents({ query: parsed.text, days: 14, limit: 20 })
        .then((result) => { if (current === generation.current) setRemote(result.posts.filter((post) => postMatchesSearch(post, parsed))); })
        .catch(() => undefined);
      return;
    }
    // Products and services are Open Media listings, matched among loaded posts above.
    if (!parsed.text || parsed.structured) { setSources([]); return; }
    const chosen = networkSearches.filter((network) => !parsed.networks || parsed.networks.includes(network.id));
    setSources(networkSearches.map((network) => ({ id: network.id, status: chosen.includes(network) ? 'searching' : 'skipped', count: 0, method: network.method(parsed) })));
    let found: SocialPost[] = [];
    const summarize = () => { if (current === generation.current) requestSummary(parsed, found, current); };
    const fallback = setTimeout(summarize, aiWaitMs);
    Promise.allSettled(chosen.map(async (network) => {
      try {
        // Networks match the text themselves; the understood filters still apply here.
        const posts = (await network.search(parsed)).filter((post) => postMatchesSearch(post, { ...parsed, keywords: [] }));
        if (current !== generation.current) return;
        found = dedupe([...found, ...posts]);
        setRemote(found);
        setSources((existing) => existing.map((item) => item.id === network.id ? { ...item, status: 'done', count: posts.length } : item));
      } catch {
        if (current === generation.current) setSources((existing) => existing.map((item) => item.id === network.id ? { ...item, status: 'failed' } : item));
      }
    })).then(() => { clearTimeout(fallback); summarize(); });
    return () => clearTimeout(fallback);
  }, [parsed]);

  const requested = useRef(-1);
  async function requestSummary(search: ParsedSearch, posts: SocialPost[], current: number) {
    if (requested.current === current) return;
    const api = (process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? '').replace(/\/$/, '');
    const picked = newestFirst(posts).filter((post) => post.body.trim()).slice(0, 15);
    if (!api || picked.length < 3) return;
    requested.current = current;
    setAi({ status: 'loading' });
    try {
      const response = await fetch(`${api}/v1/search/assist`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: search.raw, posts: picked.map((post) => ({ id: post.id, source: sourceName(post.provenance.connectorId), author: post.author.handle, text: [post.title, post.body].filter(Boolean).join(' — ') })) }),
      });
      const body = await response.json().catch(() => ({})) as { answer?: string; citations?: string[]; error?: string };
      if (current !== generation.current) return;
      if (response.status === 503) setAi({ status: 'unavailable' });
      else if (!response.ok || !body.answer) setAi({ status: 'failed', message: body.error ?? 'The AI summary isn’t available right now.' });
      else setAi({ status: 'done', answer: body.answer, citations: body.citations ?? [], basedOn: picked.length });
    } catch {
      if (current === generation.current) setAi({ status: 'failed', message: 'The AI summary isn’t available right now.' });
    }
  }

  // Events are listed soonest first; everything else newest first.
  const posts = useMemo(() => parsed.structured === 'event'
    ? dedupe([...localPosts, ...remote]).sort((a, b) => Date.parse(a.event?.startsAt ?? a.createdAt) - Date.parse(b.event?.startsAt ?? b.createdAt))
    : newestFirst(dedupe([...localPosts, ...remote])), [localPosts, remote, parsed.structured]);
  return { parsed, settings, messages, posts, sources, ai, searching: sources.some((source) => source.status === 'searching') };
}

function dedupe(posts: SocialPost[]) {
  const seen = new Set<string>();
  return posts.filter((post) => (seen.has(post.id) ? false : (seen.add(post.id), true)));
}

function newestFirst(posts: SocialPost[]) {
  return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

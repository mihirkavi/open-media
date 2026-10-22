import { useCallback, useEffect, useRef, useState } from 'react';

import { loadPublicPosts, PostPage } from '../data/postService';
import { SocialPost } from '../domain/posts';

/** Live public posts with keyset paging. `sessionKey` reloads when the viewer changes. */
export function usePublicFeed(sessionKey?: string, enabled = true) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [cursor, setCursor] = useState<PostPage['cursor']>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      const page = await loadPublicPosts();
      if (current !== sequence.current) return;
      setPosts(page.posts); setCursor(page.cursor);
    } catch (reason) {
      if (current === sequence.current) setError(messageFor(reason));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [enabled]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      const page = await loadPublicPosts({ before: cursor });
      if (current !== sequence.current) return;
      setPosts((existing) => [...existing, ...page.posts.filter((post) => !existing.some((item) => item.id === post.id))]);
      setCursor(page.cursor);
    } catch (reason) {
      if (current === sequence.current) setError(messageFor(reason));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [cursor]);

  useEffect(() => { refresh(); }, [refresh, sessionKey]);

  /** Newest page without touching state, for live updates. */
  const fetchLatest = useCallback(async () => enabled ? (await loadPublicPosts()).posts : [], [enabled]);
  const addPosts = useCallback((incoming: SocialPost[]) => setPosts((existing) => [...incoming.filter((post) => !existing.some((item) => item.id === post.id)), ...existing]), []);

  const addPost = useCallback((post: SocialPost) => setPosts((existing) => [post, ...existing.filter((item) => item.id !== post.id)]), []);
  const removePost = useCallback((postId: string) => setPosts((existing) => existing.filter((item) => item.id !== postId)), []);

  return { posts, loading, error, hasMore: Boolean(cursor), refresh, loadMore, addPost, addPosts, removePost, fetchLatest };
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Could not load posts.';
}

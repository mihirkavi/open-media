import { useEffect, useMemo, useState } from 'react';

import { exportOpml, followWebFeed, importOpmlFile, listWebFeeds, onWebFeedsChanged, previewWebFeed, unfollowWebFeed, WebFeedPreview, WebFeedSubscription } from '../data/webFeedService';
import { officialPublisher, searchWebFeedDirectory } from '../domain/webFeedDirectory';
import { hostOf } from '../domain/webFeeds';

/** A Search result that acts on web feeds; `run` resolves true when the Feed should be shown. */
export interface WebFeedRow { key: string; title: string; subtitle: string; run: () => Promise<boolean> }

const followWords = /^(?:please\s+)?(?:follow|subscribe(?:\s+to)?|add|rss(?:\s+feed)?(?:\s+(?:for|of))?|feed(?:\s+(?:for|of))?)\s+/i;
const unfollowWords = /^(?:please\s+)?(?:un-?follow|unsubscribe(?:\s+from)?|stop\s+following|remove\s+(?:the\s+)?feed)\s+(.+)$/i;
const siteLike = /^(?:(?:https?|feed):\/\/)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::443)?(?:[/?#]\S*)?$/iu;

/**
 * Web feeds in Search (ADR 0024), so following needs no new button: a pasted or typed address
 * ("theverge.com", "follow https://example.com/feed"), a news outlet or place from the directory
 * ("bbc", "news india", "weather california"), "unfollow …", and "import opml" / "export opml".
 */
export function useWebFeedRows(query: string, signedIn: boolean): WebFeedRow[] {
  const value = query.trim();
  const lower = value.toLocaleLowerCase();
  const [following, setFollowing] = useState<WebFeedSubscription[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ target: string; result?: WebFeedPreview; error?: string }>();

  const unfollowTarget = value.match(unfollowWords)?.[1]?.trim();
  const target = unfollowTarget ? undefined : value.replace(followWords, '').trim();
  const looksLikeSite = Boolean(target && siteLike.test(target) && !/\s/.test(target));
  const opml = /\bopml\b|\b(import|export|download|back ?up)\s+(my\s+)?(web\s+)?feeds\b/i.test(lower) ? (/\b(export|download|back ?up|save)\b/i.test(lower) ? 'export' : 'import') : undefined;
  const directory = useMemo(() => (!looksLikeSite && !unfollowTarget && !opml && value.length >= 2 ? searchWebFeedDirectory(value.replace(followWords, '')) : []), [value, looksLikeSite, unfollowTarget, opml]);
  const relevant = signedIn && (looksLikeSite || Boolean(unfollowTarget) || Boolean(opml) || directory.length > 0);

  // What the person already follows, so rows can say so (and unfollow can match).
  useEffect(() => {
    if (!relevant) return;
    let active = true;
    const load = () => listWebFeeds().then((feeds) => { if (active) setFollowing(feeds); }).catch(() => undefined);
    load();
    const stop = onWebFeedsChanged(load);
    return () => { active = false; stop(); };
  }, [relevant]);

  // A typed address is looked up once the person pauses typing.
  useEffect(() => {
    if (!signedIn || !looksLikeSite || !target) { setPreview(undefined); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreview({ target });
      previewWebFeed(target, controller.signal).then((result) => setPreview({ target, result })).catch((reason) => { if (!controller.signal.aborted) setPreview({ target, error: reason instanceof Error ? reason.message : 'That feed couldn’t be read.' }); });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [signedIn, looksLikeSite, target]);

  return useMemo(() => {
    if (!signedIn || !relevant) return [];
    const rows: WebFeedRow[] = [];
    const followed = (url: string) => following.find((feed) => feed.url === url);
    const follow = (key: string, url: string) => async () => {
      if (followed(url)) return true;
      setStatus((existing) => ({ ...existing, [key]: 'Following…' }));
      try { await followWebFeed(url); setStatus((existing) => ({ ...existing, [key]: 'Following. Its newest items are in your Feed.' })); return true; }
      catch (reason) { setStatus((existing) => ({ ...existing, [key]: reason instanceof Error ? reason.message : 'That feed couldn’t be followed.' })); return false; }
    };
    if (opml === 'import') rows.push({ key: 'opml-import', title: 'Import web feeds from an OPML file', subtitle: status['opml-import'] ?? 'Follow every feed you exported from NetNewsWire, Feedly, Reeder, Inoreader or another reader.', run: async () => {
      try {
        const result = await importOpmlFile();
        if (!result) return false;
        setStatus((existing) => ({ ...existing, 'opml-import': `Added ${result.added} ${result.added === 1 ? 'feed' : 'feeds'}${result.skipped.length ? `; skipped ${result.skipped.length} (already followed or not https)` : ''}.` }));
        return result.added > 0;
      } catch (reason) { setStatus((existing) => ({ ...existing, 'opml-import': reason instanceof Error ? reason.message : 'That file couldn’t be read.' })); return false; }
    } });
    if (opml === 'export') rows.push({ key: 'opml-export', title: 'Export your web feeds as OPML', subtitle: status['opml-export'] ?? `${following.length} ${following.length === 1 ? 'feed' : 'feeds'}, in the file every feed reader imports.`, run: async () => {
      try { const count = await exportOpml(); setStatus((existing) => ({ ...existing, 'opml-export': `Saved ${count} ${count === 1 ? 'feed' : 'feeds'} to open-media-feeds.opml.` })); }
      catch (reason) { setStatus((existing) => ({ ...existing, 'opml-export': reason instanceof Error ? reason.message : 'That didn’t work. Try again.' })); }
      return false;
    } });
    if (unfollowTarget) {
      const host = hostOf(/^https?:\/\//i.test(unfollowTarget) ? unfollowTarget : `https://${unfollowTarget}`);
      const needle = unfollowTarget.toLocaleLowerCase();
      for (const feed of following.filter((item) => item.url === unfollowTarget || item.title.toLocaleLowerCase().includes(needle) || (host && [hostOf(item.url), hostOf(item.siteUrl ?? undefined)].some((name) => name === host || name?.endsWith(`.${host}`)))).slice(0, 4)) {
        const key = `unfollow-${feed.id}`;
        rows.push({ key, title: `Unfollow ${feed.title}`, subtitle: status[key] ?? `Web feed · ${hostOf(feed.siteUrl ?? feed.url)}. Its items leave your Feed.`, run: async () => {
          try { await unfollowWebFeed(feed.id); setStatus((existing) => ({ ...existing, [key]: 'Unfollowed.' })); return true; }
          catch (reason) { setStatus((existing) => ({ ...existing, [key]: reason instanceof Error ? reason.message : 'That didn’t work. Try again.' })); return false; }
        } });
      }
    }
    if (looksLikeSite && target) {
      const key = `follow-${target}`;
      const found = preview?.target === target ? preview : undefined;
      if (found?.result) {
        const feed = found.result;
        const latest = feed.items[0]?.title ? ` · Latest: ${feed.items[0].title}` : '';
        rows.push({ key, title: followed(feed.feedUrl) ? `You follow ${feed.title}` : `Follow ${feed.title} in your Feed`, subtitle: status[key] ?? `${feed.official ? `Official feed from ${feed.official.domain}` : `${feed.format} feed · ${hostOf(feed.siteUrl ?? feed.feedUrl)}`}${latest}`, run: follow(key, feed.feedUrl) });
      } else {
        rows.push({ key, title: `Follow ${hostOf(target.includes('://') ? target : `https://${target}`) ?? target} in your Feed`, subtitle: found?.error ?? 'Looking for its web feed…', run: async () => false });
      }
    }
    for (const feed of directory) {
      const key = `directory-${feed.url}`;
      const official = officialPublisher(feed.url);
      rows.push({ key, title: followed(feed.url) ? `You follow ${feed.title}` : `Follow ${feed.title}`, subtitle: status[key] ?? (followed(feed.url) ? `Search “unfollow ${feed.publisherName}” to stop.` : `Official feed from ${official?.domain ?? hostOf(feed.url)}`), run: follow(key, feed.url) });
    }
    return rows;
  }, [signedIn, relevant, opml, unfollowTarget, looksLikeSite, target, preview, directory, following, status]);
}

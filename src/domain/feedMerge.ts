import type { SocialPost } from './posts';

/**
 * Merging several networks into one Feed that pages (ADR 0020).
 *
 * Each network pages on its own, and they cover very different stretches of time per page: one page
 * of Hive is about ten minutes, one page of Farcaster can be two days. Sorting everything loaded so
 * far by time therefore looked right on the first screen and wrong after "load more": the next Hive
 * page, a few minutes older, was sorted above Farcaster posts from hours ago that the reader had
 * already passed. Two rules fix that:
 *
 * 1. A newest-first lens (Raw) shows only posts above the horizon: the time down to which every
 *    network that still has older pages has already been read. Below it, a network could still have
 *    posts that belong in between, so those wait until it catches up.
 * 2. "Load more" asks only the networks that set the horizon, so the Feed moves down evenly instead
 *    of fetching two more days from a network that is already far ahead.
 *
 * A ranked lens is not in time order, so instead the posts a reader has already been shown keep
 * their places and newly loaded posts are ranked among themselves and added below (stableOrder).
 */

export interface SourceProgress {
  id: string;
  /** Time (ms) of the oldest post this source has loaded, if it has loaded any. */
  oldest?: number;
  /** Whether the source has older pages. */
  hasMore: boolean;
  /** A source that failed is left out, so one unreachable network never stalls the Feed. */
  failed?: boolean;
}

/** The time down to which every source is complete. 0 when nothing holds the Feed back. */
export function feedHorizon(sources: SourceProgress[]): number {
  return sources.reduce((horizon, source) => (source.hasMore && !source.failed && source.oldest !== undefined ? Math.max(horizon, source.oldest) : horizon), 0);
}

/** How far below the horizon a source may already be and still be asked for its next page. */
export const horizonSlackMs = 30 * 60_000;

/** The sources "load more" should ask: the ones holding the horizon up, within a short slack. */
export function sourcesToLoad(sources: SourceProgress[], horizon = feedHorizon(sources), slackMs = horizonSlackMs): string[] {
  return sources.filter((source) => source.hasMore && !source.failed && source.oldest !== undefined && source.oldest >= horizon - slackMs).map((source) => source.id);
}

/** Posts at or above the horizon. Posts without a readable time are kept. */
export function aboveHorizon<T extends Pick<SocialPost, 'createdAt'>>(posts: T[], horizon: number): T[] {
  if (!horizon) return posts;
  return posts.filter((post) => { const time = Date.parse(post.createdAt); return !Number.isFinite(time) || time >= horizon; });
}

/**
 * Keeps the posts already shown in the order they were shown, then adds the rest in the given order.
 * Posts that are gone (deleted, or no longer kept by the lens) drop out without moving the others.
 */
export function stableOrder<T extends { id: string }>(shownIds: readonly string[], ordered: T[]): T[] {
  if (!shownIds.length) return ordered;
  const byId = new Map(ordered.map((post) => [post.id, post]));
  const kept = shownIds.flatMap((id) => { const post = byId.get(id); return post ? [post] : []; });
  const placed = new Set(kept.map((post) => post.id));
  return [...kept, ...ordered.filter((post) => !placed.has(post.id))];
}

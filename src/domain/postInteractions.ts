import { NetworkId, networks, safeHttpsUrl, sourceName } from './networkPosts';
import { PostEngagement, SocialPost } from './posts';
import { initialsFor } from './publicPosts';

/**
 * Likes, comments, and reshares from the Feed's existing action icons. Open Media posts are acted on
 * in Open Media's database. Posts from another network are acted on there, through the account the
 * person connected for cross-posting (ADR 0007); without one, the icon opens the post on its network.
 */
export type InteractionKind = 'like' | 'comment' | 'reshare';

export const maxCommentLength = 1000;

/** What each network's connector can do for a post read from it. */
export const networkInteractions: Record<NetworkId, readonly InteractionKind[]> = {
  farcaster: ['like', 'comment', 'reshare'],
  lens: ['like', 'comment', 'reshare'],
  hive: ['like', 'comment', 'reshare'],
  deso: ['like', 'comment', 'reshare'],
  bluesky: ['like', 'comment', 'reshare'],
  mastodon: ['like', 'comment', 'reshare'],
  nostr: ['like', 'comment', 'reshare'],
};

/** The network-side identity of a post, as each network's write API names it. */
export type InteractionTarget =
  | { network: 'farcaster'; fid: number; hash: string }
  | { network: 'lens'; postId: string }
  | { network: 'hive'; author: string; permlink: string }
  | { network: 'deso'; postHash: string }
  | { network: 'bluesky'; uri: string; cid: string }
  | { network: 'mastodon'; uri: string }
  | { network: 'nostr'; id: string; pubkey: string };

export function interactionTarget(post: SocialPost): InteractionTarget | undefined {
  const id = post.provenance.externalId;
  if (!id) return undefined;
  switch (post.provenance.connectorId) {
    case 'farcaster': {
      const fid = Number(post.author.id.replace(/^farcaster:/, ''));
      return Number.isSafeInteger(fid) && fid > 0 && /^0x[0-9a-f]{40}$/i.test(id) ? { network: 'farcaster', fid, hash: id.toLowerCase() } : undefined;
    }
    case 'lens': return /^[0-9a-zA-Z-]+$/.test(id) ? { network: 'lens', postId: id } : undefined;
    case 'hive': {
      const [author, permlink, ...rest] = id.split('/');
      return author && permlink && !rest.length && /^[a-z][a-z0-9.-]{2,15}$/.test(author) && /^[a-z0-9-]+$/.test(permlink) ? { network: 'hive', author, permlink } : undefined;
    }
    case 'deso': return /^[0-9a-f]{64}$/i.test(id) ? { network: 'deso', postHash: id.toLowerCase() } : undefined;
    case 'bluesky': {
      const [uri, cid, ...rest] = id.split(' ');
      return uri?.startsWith('at://') && cid && /^[a-z0-9]{20,}$/i.test(cid) && !rest.length ? { network: 'bluesky', uri, cid } : undefined;
    }
    case 'mastodon': return safeHttpsUrl(id) ? { network: 'mastodon', uri: id } : undefined;
    case 'nostr': {
      const [eventId, pubkey, ...rest] = id.split(' ');
      return /^[0-9a-f]{64}$/.test(eventId ?? '') && /^[0-9a-f]{64}$/.test(pubkey ?? '') && !rest.length ? { network: 'nostr', id: eventId, pubkey } : undefined;
    }
    default: return undefined;
  }
}

/**
 * The key a web feed item's or public event's likes and comments are kept under (ADR 0024 §8): an
 * article's link, or an event's official page, https only, with the #fragment and tracking
 * parameters (utm_*, fbclid and the like) removed, so the same article or event shared with
 * different tracking still meets in one place.
 */
export function webItemUrl(post: SocialPost): string | undefined {
  const source = post.provenance.connectorId;
  if (source !== 'rss' && !(source === 'events' && post.event)) return undefined;
  const url = safeHttpsUrl(source === 'events' ? post.event!.registrationUrl : post.provenance.canonicalURL);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|mc_|_hs|ga_)|^(fbclid|gclid|dclid|msclkid|igshid|ref|ref_src|cmpid|ocid|at_medium|at_campaign)$/i.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.toLowerCase();
    const text = parsed.toString();
    return text.length <= 2048 ? text : undefined;
  } catch { return undefined; }
}

/** What tapping an action icon does for this post and person. */
export type InteractionRoute =
  | { via: 'open-media' }
  | { via: 'web'; url: string }
  | { via: 'sign-in' }
  | { via: 'network'; network: NetworkId; target: InteractionTarget; handle: string }
  | { via: 'open'; url: string; name: string }
  | { via: 'none' };

/** `connected` maps each network the person connected for cross-posting on this device to their handle there. */
export function interactionRoute(post: SocialPost, kind: InteractionKind, viewer: { signedIn: boolean; connected: Partial<Record<NetworkId, string>> }): InteractionRoute {
  const source = post.provenance.connectorId;
  // Comments on Open Media posts can be read signed out; writing one needs an account.
  if (source === 'open-media') return viewer.signedIn || kind === 'comment' ? { via: 'open-media' } : { via: 'sign-in' };
  // Web feed items and public events are liked, commented on and reshared in Open Media, keyed by
  // their article link or the event's official page.
  const item = webItemUrl(post);
  if (item) return viewer.signedIn || kind === 'comment' ? { via: 'web', url: item } : { via: 'sign-in' };
  const network = source in networks ? source as NetworkId : undefined;
  const handle = network ? viewer.connected[network] : undefined;
  const target = interactionTarget(post);
  if (network && handle && target && viewer.signedIn && networkInteractions[network].includes(kind)) return { via: 'network', network, target, handle };
  const url = safeHttpsUrl(post.provenance.canonicalURL);
  return url ? { via: 'open', url, name: sourceName(source) } : { via: 'none' };
}

/** Counts after the viewer likes or reshares (or takes it back), before the server confirms. */
export function applyInteraction(engagement: PostEngagement, kind: 'like' | 'reshare', on: boolean): PostEngagement {
  if (kind === 'like') {
    if (Boolean(engagement.liked) === on) return engagement;
    return { ...engagement, liked: on, likes: Math.max(0, engagement.likes + (on ? 1 : -1)) };
  }
  if (Boolean(engagement.reshared) === on) return engagement;
  return { ...engagement, reshared: on, reposts: Math.max(0, engagement.reposts + (on ? 1 : -1)) };
}

/** Counts reported by Open Media's database, with the viewer's own like and reshare. */
export function engagementFromRecord(value: unknown): PostEngagement {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const count = (item: unknown) => typeof item === 'number' && Number.isFinite(item) && item >= 0 ? Math.floor(item) : 0;
  return { replies: count(record.replies), reposts: count(record.reposts), likes: count(record.likes), liked: record.liked === true, reshared: record.reshared === true };
}

export interface PostComment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string; initials: string; avatarUrl?: string; verified?: boolean };
  /** Written on another network and read from there (a Farcaster reply to a link). */
  network?: 'farcaster';
  /** The Farcaster cast that copies this Open Media comment, when it was also sent there. */
  farcasterHash?: string;
}

export function postCommentFromRecord(value: unknown): PostComment | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { id?: unknown; body?: unknown; createdAt?: unknown; farcasterHash?: unknown; author?: { id?: unknown; handle?: unknown; displayName?: unknown; avatarUrl?: unknown; verified?: unknown } };
  const author = record.author;
  if (typeof record.id !== 'string' || typeof record.body !== 'string' || typeof record.createdAt !== 'string' || typeof author?.id !== 'string' || typeof author.handle !== 'string' || typeof author.displayName !== 'string') return undefined;
  return {
    id: record.id,
    body: record.body,
    createdAt: record.createdAt,
    author: {
      id: author.id,
      handle: `@${author.handle}`,
      displayName: author.displayName,
      initials: initialsFor(author.displayName),
      ...(typeof author.avatarUrl === 'string' ? { avatarUrl: author.avatarUrl } : {}),
      ...(author.verified === true ? { verified: true } : {}),
    },
    ...(typeof record.farcasterHash === 'string' && /^0x[0-9a-f]{40}$/.test(record.farcasterHash) ? { farcasterHash: record.farcasterHash } : {}),
  };
}

/** Accessible name for an action icon, e.g. “Like, 3 likes” or “Liked, 4 likes”. */
export function interactionLabel(kind: InteractionKind, engagement: PostEngagement, route: InteractionRoute): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const counts = kind === 'like' ? plural(engagement.likes, 'like') : kind === 'reshare' ? plural(engagement.reposts, 'reshare') : plural(engagement.replies, 'comment');
  const active = kind === 'like' ? engagement.liked : kind === 'reshare' ? engagement.reshared : false;
  const verb = kind === 'like' ? (active ? 'Liked' : 'Like') : kind === 'reshare' ? (active ? 'Reshared' : 'Reshare') : 'Comments';
  if (route.via === 'open') return `${counts}. Opens the post on ${route.name}`;
  if (route.via === 'network') return `${verb} on ${networks[route.network].displayName} as ${route.handle}, ${counts}`;
  return `${verb}, ${counts}`;
}

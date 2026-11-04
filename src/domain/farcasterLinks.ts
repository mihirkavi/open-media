import { FarcasterCastMessage, FarcasterProfile, farcasterTimestamp, safeHttpsUrl } from './networkPosts';
import { PostComment } from './postInteractions';
import { PostEngagement } from './posts';

/**
 * Likes, recasts and replies on a web link (an article or an event's page), read from Farcaster
 * (ADR 0024 addendum 2). Farcaster is the one connected network whose protocol can like, recast and
 * reply to any link, so actions there are visible in every Farcaster app. These rules combine what
 * Farcaster has with Open Media's own record, counting each person once.
 */
export interface FarcasterLinkActivity {
  /** Accounts (fids) that liked the link on Farcaster. */
  likeFids: number[];
  /** Accounts that recast it. */
  recastFids: number[];
  /** Casts whose parent is the link: its replies. */
  replies: FarcasterCastMessage[];
}

export const emptyLinkActivity: FarcasterLinkActivity = { likeFids: [], recastFids: [], replies: [] };

/** Which Open Media likes, reshares and comments were also sent to Farcaster. */
export interface FarcasterCopies { likes: number[]; reshares: number[]; comments: string[] }

export const noCopies: FarcasterCopies = { likes: [], reshares: [], comments: [] };

const isFid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const isHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);

export function farcasterCopiesFromRecord(value: unknown): FarcasterCopies {
  const record = (value && typeof value === 'object' ? (value as { farcasterCopies?: unknown }).farcasterCopies : undefined) as { likes?: unknown; reshares?: unknown; comments?: unknown } | undefined;
  return {
    likes: Array.isArray(record?.likes) ? record.likes.filter(isFid) : [],
    reshares: Array.isArray(record?.reshares) ? record.reshares.filter(isFid) : [],
    comments: Array.isArray(record?.comments) ? record.comments.filter(isHash) : [],
  };
}

/** Reads Snapchain's `reactionsByTarget` page into the fids that reacted. */
export function reactionFids(page: { messages?: { data?: { fid?: unknown; type?: string } }[] } | undefined): number[] {
  return [...new Set((page?.messages ?? []).filter((message) => message.data?.type === 'MESSAGE_TYPE_REACTION_ADD').map((message) => message.data?.fid).filter(isFid))];
}

/** Keeps only real replies to this link from Snapchain's `castsByParent` page. */
export function linkReplies(page: { messages?: FarcasterCastMessage[] } | undefined, url: string): FarcasterCastMessage[] {
  return (page?.messages ?? []).filter((message) => message.data?.type === 'MESSAGE_TYPE_CAST_ADD' && message.data.castAddBody?.parentUrl === url && Boolean(message.data.castAddBody?.text?.trim()) && isHash(message.hash));
}

/**
 * Open Media's counts plus Farcaster's, with each person counted once: an Open Media like that was
 * also sent to Farcaster appears in both and is counted once. The viewer has liked or reshared when
 * either side says so (they may have liked the link in another Farcaster app).
 */
export function combineLinkEngagement(openMedia: PostEngagement, copies: FarcasterCopies, farcaster: FarcasterLinkActivity, viewerFid?: number): PostEngagement {
  const extra = (fids: number[], copied: number[]) => fids.filter((fid) => !copied.includes(fid)).length;
  const copiedComments = new Set(copies.comments);
  return {
    ...openMedia,
    likes: openMedia.likes + extra(farcaster.likeFids, copies.likes),
    reposts: openMedia.reposts + extra(farcaster.recastFids, copies.reshares),
    replies: openMedia.replies + farcaster.replies.filter((reply) => !copiedComments.has(reply.hash)).length,
    liked: Boolean(openMedia.liked) || (viewerFid !== undefined && farcaster.likeFids.includes(viewerFid)),
    reshared: Boolean(openMedia.reshared) || (viewerFid !== undefined && farcaster.recastFids.includes(viewerFid)),
  };
}

/** Farcaster's activity after the viewer's own action, before Snapchain reports it back. */
export function withOwnAction(activity: FarcasterLinkActivity, fid: number, action: { kind: 'like' | 'reshare'; on: boolean }): FarcasterLinkActivity {
  const key = action.kind === 'like' ? 'likeFids' : 'recastFids';
  const others = activity[key].filter((item) => item !== fid);
  return { ...activity, [key]: action.on ? [...others, fid] : others };
}

/** Farcaster replies as comments, oldest first, leaving out the ones that copy an Open Media comment. */
export function farcasterLinkComments(replies: FarcasterCastMessage[], profiles: Map<number, FarcasterProfile>, copiedHashes: Iterable<string>): PostComment[] {
  const copied = new Set(copiedHashes);
  return replies.filter((reply) => !copied.has(reply.hash)).map((reply): PostComment => {
    const profile = profiles.get(reply.data.fid);
    const handle = profile?.username ? `@${profile.username}` : `fid:${reply.data.fid}`;
    const displayName = profile?.displayName?.trim() || profile?.username || handle;
    const avatarUrl = safeHttpsUrl(profile?.pfpUrl);
    return {
      id: `farcaster:${reply.hash}`,
      body: reply.data.castAddBody?.text?.trim() ?? '',
      createdAt: farcasterTimestamp(reply.data.timestamp),
      author: { id: `farcaster:${reply.data.fid}`, handle, displayName, initials: displayName.replace(/^@/, '').slice(0, 2).toUpperCase(), ...(avatarUrl ? { avatarUrl } : {}) },
      network: 'farcaster',
    };
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

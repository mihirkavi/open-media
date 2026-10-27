import type { PostEvent, PostListing } from './listings';

export type PostKind = 'text' | 'image' | 'video' | 'link';
export type FeedMode = 'relevant' | 'raw';

export interface PostAuthor {
  id: string;
  displayName: string;
  handle: string;
  initials: string;
  /** HTTPS image published by the author's network; initials are shown without it. */
  avatarUrl?: string;
  /** Open Media identity verified by the identity provider. Never set from another network's badge. */
  verified?: boolean;
  /** The author accepts tips on Open Media (ADR 0013, phase 6). */
  tipsEnabled?: boolean;
}

/** A paid post's price, and its paid part once the viewer unlocked it (ADR 0013, phase 6). */
export interface PostPaid {
  priceMinor: number;
  currency: string;
  unlocked: boolean;
  body?: string;
}

export interface PostMedia {
  kind: 'image' | 'video';
  url?: string;
  aspectRatio: number;
  durationSeconds?: number;
  altText: string;
  /** Still image shown before a video plays. */
  posterUrl?: string;
  /** How a video is delivered: an HLS playlist (.m3u8) or a single progressive file (MP4/MOV). */
  streaming?: 'hls' | 'progressive';
  /** SHA-256 (hex) of the media bytes, when the source records one (Open Media's own videos do). */
  sha256?: string;
}

/** One canonical post is rendered in both Feed and Clips. */
export interface SocialPost {
  id: string;
  author: PostAuthor;
  /** Long-form posts (for example Hive articles) carry a title; the body is then an excerpt. */
  title?: string;
  body: string;
  kind: PostKind;
  createdAt: string;
  media?: PostMedia[];
  topics: string[];
  provenance: { connectorId: string; externalId?: string; canonicalURL?: string };
  /** Present only where a source actually reports counts; Open Media has no reactions yet. */
  engagement?: { replies: number; reposts: number; likes: number };
  relevance: { followsAuthor: boolean; selectedInterestMatches: string[]; communityMatch?: string };
  /**
   * How an external network's post became eligible for this doorway: which public stream it was read
   * from and which published filters were applied to that stream. Shown verbatim in “Why this?”.
   */
  eligibility?: { selection: string; filters: string[] };
  /** A product or service the author offers (ADR 0013). */
  listing?: PostListing;
  /** A real-world event read from public event listings; registration happens on the official page. */
  event?: PostEvent;
  /** The body is a free preview; the rest is paid for once. */
  paid?: PostPaid;
}

export interface FeedExplanation {
  postId: string;
  mode: FeedMode;
  used: string[];
  /** Published filters applied to the post's source before ranking. */
  filters: string[];
  notUsed: string[];
  /** What verified people checked on a listing, when they did. */
  checks?: string[];
}

const forbiddenSignals = ['Private messages', 'Exact location', 'Sensitive-trait inference'];

export function selectFeed(posts: SocialPost[], mode: FeedMode): SocialPost[] {
  if (mode === 'raw') return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return [...posts].sort((a, b) => relevantScore(b) - relevantScore(a));
}

export function explainFeedPost(post: SocialPost, mode: FeedMode): FeedExplanation {
  const source = post.eligibility ? [post.eligibility.selection] : [];
  const used = mode === 'raw'
    ? [...source, 'Posted recently', 'Raw chronological order']
    : [
        ...(post.relevance.followsAuthor ? ['You follow this author'] : []),
        ...post.relevance.selectedInterestMatches.map((topic) => `Matches your ${topic} interest`),
        ...(post.relevance.communityMatch ? [`From ${post.relevance.communityMatch}`] : []),
        ...source,
        'Posted recently',
        'Selected by Relevant',
      ];
  // What verified people checked on a listing (ADR 0016). Not a ranking signal: shown so people can judge it.
  const checks = post.listing?.checkedBy ? [`Checked by ${post.listing.checkedBy} verified ${post.listing.checkedBy === 1 ? 'person' : 'people'} against public pages they cited`] : [];
  return { postId: post.id, mode, used, filters: post.eligibility?.filters ?? [], notUsed: forbiddenSignals, ...(checks.length ? { checks } : {}) };
}

/** Clips are short videos: at most this long when the source reports a duration. */
export const maxClipSeconds = 180;

export function clipPosts(posts: SocialPost[]) {
  return posts.filter((post) => post.kind === 'video' && post.media?.some((media) => media.kind === 'video' && (media.durationSeconds === undefined || media.durationSeconds <= maxClipSeconds)));
}

function relevantScore(post: SocialPost) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(post.createdAt)) / 3_600_000);
  const recency = Math.max(0, 48 - ageHours) / 48;
  return recency * 0.5 + (post.relevance.followsAuthor ? 0.3 : 0) + Math.min(0.2, post.relevance.selectedInterestMatches.length * 0.1);
}

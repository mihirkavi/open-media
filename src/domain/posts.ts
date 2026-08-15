export type PostKind = 'text' | 'image' | 'video' | 'link';
export type FeedMode = 'relevant' | 'raw';

export interface PostAuthor {
  id: string;
  displayName: string;
  handle: string;
  initials: string;
}

export interface PostMedia {
  kind: 'image' | 'video';
  url?: string;
  aspectRatio: number;
  durationSeconds?: number;
  altText: string;
}

/** One canonical post is rendered in both Feed and Clips. */
export interface SocialPost {
  id: string;
  author: PostAuthor;
  body: string;
  kind: PostKind;
  createdAt: string;
  media?: PostMedia[];
  topics: string[];
  provenance: { connectorId: string; externalId?: string; canonicalURL?: string };
  engagement: { replies: number; reposts: number; likes: number };
  relevance: { followsAuthor: boolean; selectedInterestMatches: string[]; communityMatch?: string };
}

export interface FeedExplanation {
  postId: string;
  mode: FeedMode;
  used: string[];
  notUsed: string[];
}

const forbiddenSignals = ['Private messages', 'Exact location', 'Sensitive-trait inference'];

export function selectFeed(posts: SocialPost[], mode: FeedMode): SocialPost[] {
  if (mode === 'raw') return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return [...posts].sort((a, b) => relevantScore(b) - relevantScore(a));
}

export function explainFeedPost(post: SocialPost, mode: FeedMode): FeedExplanation {
  const used = mode === 'raw'
    ? ['Posted recently', 'Raw chronological order']
    : [
        ...(post.relevance.followsAuthor ? ['You follow this author'] : []),
        ...post.relevance.selectedInterestMatches.map((topic) => `Matches your ${topic} interest`),
        ...(post.relevance.communityMatch ? [`From ${post.relevance.communityMatch}`] : []),
        'Posted recently',
        'Selected by Relevant',
      ];
  return { postId: post.id, mode, used, notUsed: forbiddenSignals };
}

export function clipPosts(posts: SocialPost[]) {
  return posts.filter((post) => post.kind === 'video' && post.media?.some((media) => media.kind === 'video'));
}

function relevantScore(post: SocialPost) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(post.createdAt)) / 3_600_000);
  const recency = Math.max(0, 48 - ageHours) / 48;
  return recency * 0.5 + (post.relevance.followsAuthor ? 0.3 : 0) + Math.min(0.2, post.relevance.selectedInterestMatches.length * 0.1);
}

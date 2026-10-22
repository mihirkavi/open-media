import { SocialPost } from './posts';
import { isStoredPostVideo, postVideoPublicUrl, StoredPostVideo } from './postVideo';

/** Shape returned by the open_media_public_* database functions and the public API. */
export interface PublicPostRecord {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
  /** One short video, when the post has one (ADR 0009). */
  video?: StoredPostVideo | null;
}

export interface PublicProfileRecord {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  joinedAt: string;
  postCount: number;
}

export const maxPostLength = 2000;

/**
 * `supabaseUrl` is the project whose public `post-videos` bucket holds the post's video. Without it,
 * a video post is shown as text only.
 */
export function socialPostFromPublic(record: PublicPostRecord, supabaseUrl?: string): SocialPost {
  const video = supabaseUrl && isStoredPostVideo(record.video) ? record.video : undefined;
  return {
    id: record.id,
    author: {
      id: record.author.id,
      displayName: record.author.displayName,
      handle: `@${record.author.handle}`,
      initials: initialsFor(record.author.displayName),
    },
    body: record.body,
    kind: video ? 'video' : 'text',
    createdAt: record.createdAt,
    ...(video && supabaseUrl ? {
      media: [{
        kind: 'video' as const,
        url: postVideoPublicUrl(supabaseUrl, video.path),
        posterUrl: video.posterPath ? postVideoPublicUrl(supabaseUrl, video.posterPath) : undefined,
        durationSeconds: Number(video.durationSeconds),
        aspectRatio: Number(video.width) / Number(video.height),
        altText: record.body.trim() ? `Video: ${record.body.trim().slice(0, 120)}` : `Video by ${record.author.displayName}`,
        streaming: 'progressive' as const,
        sha256: video.sha256,
      }],
    } : {}),
    topics: [],
    provenance: { connectorId: 'open-media', externalId: record.id },
    relevance: { followsAuthor: false, selectedInterestMatches: [] },
  };
}

export function isPublicPostRecord(value: unknown): value is PublicPostRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PublicPostRecord>;
  return typeof record.id === 'string'
    && typeof record.body === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.author?.handle === 'string'
    && typeof record.author?.displayName === 'string';
}

export function initialsFor(name: string): string {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return initials || '?';
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(value)) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

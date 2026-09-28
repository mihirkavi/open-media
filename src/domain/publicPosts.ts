import { SocialPost } from './posts';

/** Shape returned by the open_media_public_* database functions and the public API. */
export interface PublicPostRecord {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
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

export function socialPostFromPublic(record: PublicPostRecord): SocialPost {
  return {
    id: record.id,
    author: {
      id: record.author.id,
      displayName: record.author.displayName,
      handle: `@${record.author.handle}`,
      initials: initialsFor(record.author.displayName),
    },
    body: record.body,
    kind: 'text',
    createdAt: record.createdAt,
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

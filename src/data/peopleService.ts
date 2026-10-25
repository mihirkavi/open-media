import { getSupabaseClient } from '../auth/supabase';
import { request } from '../connectors/mailApiConnector';
import { fetchAuthorPosts } from '../connectors/networkAuthors';
import { NetworkId } from '../domain/networkPosts';
import { ContactCard, IdentityRef, isContactCard } from '../domain/people';
import { SocialPost } from '../domain/posts';
import { loadPublicPosts } from './postService';

/** What anyone may see about an Open Media account (open_media_public_profile). */
export interface PublicPerson {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  joinedAt?: string;
  postCount?: number;
  linkedAccounts: { network: NetworkId; handle: string }[];
  /** Verified by the identity provider (the blue tick). Computed by the server. */
  verified: boolean;
  visibility: 'public' | 'private';
  /** False for a private account the viewer does not follow: only the card above is returned. */
  canView: boolean;
  followStatus?: FollowStatus;
}

export type FollowStatus = 'pending' | 'accepted' | null;

export async function loadPublicPerson(handle: string): Promise<PublicPerson | undefined> {
  const client = getSupabaseClient();
  if (!client) return undefined;
  const { data, error } = await client.rpc('open_media_public_profile', { p_handle: handle.replace(/^@/, '').toLowerCase() });
  if (error) throw error;
  if (!data) return undefined;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    handle: String(row.handle),
    displayName: String(row.displayName ?? row.handle),
    bio: String(row.bio ?? ''),
    avatarUrl: typeof row.avatarUrl === 'string' && row.avatarUrl.startsWith('https://') ? row.avatarUrl : undefined,
    joinedAt: typeof row.joinedAt === 'string' ? row.joinedAt : undefined,
    postCount: typeof row.postCount === 'number' ? row.postCount : undefined,
    linkedAccounts: Array.isArray(row.linkedAccounts) ? (row.linkedAccounts as PublicPerson['linkedAccounts']) : [],
    verified: row.verified === true,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    canView: row.canView !== false,
    followStatus: row.followStatus === 'pending' || row.followStatus === 'accepted' ? row.followStatus : null,
  };
}

/** A source in a person's unified timeline: their Open Media posts or one of their network accounts. */
export type TimelineSource = { kind: 'open_media'; handle: string } | { kind: 'network'; network: NetworkId; handle: string };

export function sourcesFor(refs: IdentityRef[], person?: PublicPerson): TimelineSource[] {
  const sources: TimelineSource[] = [];
  for (const ref of refs) {
    if (ref.kind === 'open_media') sources.push({ kind: 'open_media', handle: ref.handle.replace(/^@/, '') });
    if (ref.kind === 'network') sources.push({ kind: 'network', network: ref.network, handle: ref.handle.replace(/^@/, '') });
  }
  for (const account of person?.linkedAccounts ?? []) sources.push({ kind: 'network', network: account.network, handle: account.handle });
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.kind === 'open_media' ? `om:${source.handle.toLowerCase()}` : `${source.network}:${source.handle.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One page from every source, merged newest first. A source that fails is reported, not fatal. */
export async function loadTimeline(sources: TimelineSource[]): Promise<{ posts: SocialPost[]; failed: TimelineSource[] }> {
  const results = await Promise.allSettled(sources.map(async (source) => source.kind === 'open_media'
    ? (await loadPublicPosts({ authorHandle: source.handle })).posts
    : (await fetchAuthorPosts(source.network, source.handle)).posts));
  const posts: SocialPost[] = [];
  const failed: TimelineSource[] = [];
  results.forEach((result, index) => result.status === 'fulfilled' ? posts.push(...result.value) : failed.push(sources[index]));
  return { posts: posts.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), failed };
}

// Contact cards: the signed-in person's own address book, encrypted by the server (ADR 0013).

export async function loadContactCards(): Promise<ContactCard[]> {
  const result = await request<{ data: unknown[] }>('/v1/me/contacts', {}, 'Could not load your contacts.');
  return result.data.filter(isContactCard);
}

export async function saveContactCards(cards: ContactCard[]): Promise<void> {
  for (let index = 0; index < cards.length; index += 500) {
    await request('/v1/me/contacts', { method: 'PUT', body: cards.slice(index, index + 500) }, 'Could not save your contacts.');
  }
}

export async function deleteContactCard(id: string): Promise<void> {
  await request(`/v1/me/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Could not delete the contact.');
}

export async function saveLinkedAccounts(accounts: { network: NetworkId; handle: string }[]): Promise<void> {
  await request('/v1/me/linked-accounts', { method: 'PUT', body: accounts }, 'Could not save your accounts.');
}

// Follows and identity (ADR 0013, phase 2). The server decides tiers, ticks and access.

export interface ProfileCard { id: string; handle: string; displayName: string; avatarUrl: string | null; verified: boolean; visibility: 'public' | 'private'; status?: FollowStatus }
export interface MyFollows { following: ProfileCard[]; followers: ProfileCard[]; requests: (ProfileCard & { requestedAt: string })[] }
export interface MyIdentity {
  tier: 2 | 3 | 4 | 5;
  verified: boolean;
  shownName: string;
  nameDisclosure: 'handle_only' | 'declared' | 'verified_legal';
  visibility: 'public' | 'private';
  verification: { provider: string; status: 'pending' | 'verified' | 'failed' | 'expired' | 'revoked'; legalNameShown: boolean } | null;
  pendingRequests: number;
  verificationAvailable?: boolean;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Open Media is not connected.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function followPerson(handle: string): Promise<FollowStatus> {
  return (await rpc<{ status: FollowStatus }>('open_media_follow', { p_handle: handle })).status;
}

export async function unfollowPerson(handle: string): Promise<void> {
  await rpc('open_media_unfollow', { p_handle: handle });
}

export function loadMyFollows(): Promise<MyFollows> {
  return rpc<MyFollows>('open_media_my_follows', {});
}

export async function answerFollowRequest(followerId: string, accept: boolean): Promise<void> {
  await rpc('open_media_answer_follow_request', { p_follower: followerId, p_accept: accept });
}

export async function removeFollower(followerId: string): Promise<void> {
  await rpc('open_media_remove_follower', { p_follower: followerId });
}

/** Through the Worker, which also knows whether verification is available on this server. */
export function loadMyIdentity(): Promise<MyIdentity> {
  return request<MyIdentity>('/v1/me/identity', {}, 'Could not load your identity settings.');
}

export function saveMyIdentity(change: { nameDisclosure?: MyIdentity['nameDisclosure']; visibility?: MyIdentity['visibility'] }): Promise<MyIdentity> {
  return request<MyIdentity>('/v1/me/identity', { method: 'PUT', body: change }, 'Could not save that.');
}

export function startIdentityVerification(): Promise<{ url: string }> {
  return request<{ url: string }>('/v1/me/verification', { method: 'POST', body: {} }, 'Verification could not start.');
}

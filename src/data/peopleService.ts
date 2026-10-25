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
  joinedAt: string;
  postCount: number;
  linkedAccounts: { network: NetworkId; handle: string }[];
}

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
    joinedAt: String(row.joinedAt),
    postCount: Number(row.postCount ?? 0),
    linkedAccounts: Array.isArray(row.linkedAccounts) ? (row.linkedAccounts as PublicPerson['linkedAccounts']) : [],
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

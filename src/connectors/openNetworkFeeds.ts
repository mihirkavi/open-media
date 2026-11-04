import {
  BlueskyPostView, mastodonServer, MastodonStatus, NostrEvent, nostrProfileFromEvent, nostrPublicKey, NostrProfile, socialPostFromBluesky,
  socialPostFromMastodon, socialPostFromNostr,
} from '../domain/openNetworkPosts';
import { SocialPost } from '../domain/posts';
import type { FeedKind, NetworkFeedPage } from './networkFeeds';
import { queryNostr } from './nostrRelays';

/**
 * Keyless, read-only clients for Bluesky, Mastodon and Nostr (ADR 0033). Like the other networks'
 * feeds they read the newest public posts, never a network's engagement ranking.
 */

const timeoutMs = 12_000;
const pageSize = 20;

async function getJSON<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

const posts = (items: (SocialPost | undefined)[]) => items.filter((post): post is SocialPost => Boolean(post));
const forKind = (items: SocialPost[], kind: FeedKind) => kind === 'clips' ? items.filter((post) => post.kind === 'video') : items;

// ---------- Bluesky ----------

/** Bluesky's public AppView. Search sorted by `latest` is its chronological view of every public post. */
export const blueskyAppView = 'https://api.bsky.app/xrpc';

export async function fetchBlueskyFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const query = new URLSearchParams({ q: '*', sort: 'latest', limit: String(kind === 'clips' ? 100 : 30) });
  if (cursor) query.set('cursor', cursor);
  const result = await getJSON<{ posts?: BlueskyPostView[]; cursor?: string }>(`${blueskyAppView}/app.bsky.feed.searchPosts?${query}`);
  return { posts: forKind(posts((result.posts ?? []).map((view) => socialPostFromBluesky(view))), kind), cursor: result.cursor };
}

export async function fetchBlueskyAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  const query = new URLSearchParams({ actor: handle.includes('.') ? handle : `${handle}.bsky.social`, limit: '15', filter: 'posts_no_replies' });
  if (cursor) query.set('cursor', cursor);
  const result = await getJSON<{ feed?: { post: BlueskyPostView; reason?: unknown }[]; cursor?: string }>(`${blueskyAppView}/app.bsky.feed.getAuthorFeed?${query}`).catch(() => ({ feed: [], cursor: undefined }));
  return { posts: posts((result.feed ?? []).filter((item) => !item.reason).map((item) => socialPostFromBluesky(item.post, `Posted by @${handle} on Bluesky`))), cursor: result.cursor };
}

export async function searchBluesky(text: string, video = false): Promise<SocialPost[]> {
  const result = await getJSON<{ posts?: BlueskyPostView[] }>(`${blueskyAppView}/app.bsky.feed.searchPosts?${new URLSearchParams({ q: text, sort: 'latest', limit: '25' })}`);
  const found = posts((result.posts ?? []).map((view) => socialPostFromBluesky(view, `Matches “${text}” in Bluesky’s public search`)));
  return video ? found.filter((post) => post.kind === 'video') : found;
}

// ---------- Mastodon ----------

/**
 * A large general-interest server that lets anyone read its public timeline. Its federated
 * timeline carries public posts from across the fediverse, newest first.
 */
export const mastodonReadingServer = 'mas.to';

export async function fetchMastodonFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const query = new URLSearchParams({ limit: kind === 'clips' ? '40' : '20', ...(kind === 'clips' ? { only_media: 'true' } : {}) });
  if (cursor) query.set('max_id', cursor);
  const statuses = await getJSON<MastodonStatus[]>(`https://${mastodonReadingServer}/api/v1/timelines/public?${query}`);
  const last = statuses[statuses.length - 1];
  return { posts: forKind(posts(statuses.map((status) => socialPostFromMastodon(status, mastodonReadingServer))), kind), cursor: last?.id };
}

/** `user@server` (or `user` on the reading server) → that account's public posts, read from its own server. */
export async function fetchMastodonAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  const [user, host] = handle.replace(/^@/, '').split('@');
  const server = host ? mastodonServer(host) : mastodonReadingServer;
  if (!user || !server || !/^[A-Za-z0-9_.-]{1,64}$/.test(user)) return { posts: [] };
  const account = await getJSON<{ id: string }>(`https://${server}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`).catch(() => undefined);
  if (!account) return { posts: [] };
  const query = new URLSearchParams({ limit: '15', exclude_replies: 'true', exclude_reblogs: 'true' });
  if (cursor) query.set('max_id', cursor);
  const statuses = await getJSON<MastodonStatus[]>(`https://${server}/api/v1/accounts/${encodeURIComponent(account.id)}/statuses?${query}`).catch(() => []);
  const last = statuses[statuses.length - 1];
  return { posts: posts(statuses.map((status) => socialPostFromMastodon(status, server, `Posted by @${user}@${server} on Mastodon`))), cursor: statuses.length === 15 ? last?.id : undefined };
}

export async function searchMastodon(text: string, video = false): Promise<SocialPost[]> {
  // Full-text search needs an account on most servers; hashtags are public everywhere.
  const tag = text.trim().replace(/^#/, '').match(/^[\p{L}\p{N}_]{1,64}/u)?.[0];
  if (!tag) return [];
  const statuses = await getJSON<MastodonStatus[]>(`https://${mastodonReadingServer}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=30${video ? '&only_media=true' : ''}`);
  const found = posts(statuses.map((status) => socialPostFromMastodon(status, mastodonReadingServer, `Tagged #${tag} on Mastodon (Mastodon searches public posts by hashtag)`)));
  return video ? found.filter((post) => post.kind === 'video') : found;
}

// ---------- Nostr ----------

const nostrProfiles = new Map<string, Promise<NostrProfile | undefined>>();

/** Profiles (kind 0) for these authors, fetched together and cached. */
async function nostrProfilesFor(pubkeys: string[]): Promise<Map<string, NostrProfile | undefined>> {
  const missing = [...new Set(pubkeys)].filter((key) => !nostrProfiles.has(key));
  if (missing.length) {
    const batch = queryNostr({ kinds: [0], authors: missing, limit: missing.length * 2 }, undefined, 5000).then(async (events) => {
      const { verifyNostrEvent } = await import('./nostrEvent');
      const newest = new Map<string, NostrEvent>();
      for (const event of events) if (verifyNostrEvent(event) && (newest.get(event.pubkey)?.created_at ?? -1) < event.created_at) newest.set(event.pubkey, event);
      return newest;
    });
    for (const key of missing) nostrProfiles.set(key, batch.then((found) => nostrProfileFromEvent(found.get(key))).catch(() => undefined));
  }
  return new Map(await Promise.all(pubkeys.map(async (key) => [key, await nostrProfiles.get(key)] as const)));
}

async function nostrNotes(events: NostrEvent[], selection?: string): Promise<SocialPost[]> {
  const { verifyNostrEvent } = await import('./nostrEvent');
  const verified = events.filter(verifyNostrEvent);
  const profiles = await nostrProfilesFor(verified.map((event) => event.pubkey));
  return posts(verified.map((event) => socialPostFromNostr(event, profiles.get(event.pubkey), selection)));
}

/** Cursor: the oldest `created_at` read so far (seconds). */
export async function fetchNostrFeed(cursor?: string, kind: FeedKind = 'feed'): Promise<NetworkFeedPage> {
  const until = cursor ? Number(cursor) - 1 : undefined;
  const events = await queryNostr({ kinds: [1], limit: kind === 'clips' ? 120 : 30, ...(until ? { until } : {}) });
  const found = forKind(await nostrNotes(events), kind);
  const oldest = events[events.length - 1]?.created_at;
  return { posts: found, cursor: oldest ? String(oldest) : undefined };
}

/** `npub1…`, a hex key, or a NIP-05 address (`name@domain`). */
export async function fetchNostrAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  let pubkey = nostrPublicKey(handle);
  if (!pubkey && /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(handle.replace(/^@/, ''))) {
    const [name, domain] = handle.replace(/^@/, '').toLowerCase().split('@');
    const result = await getJSON<{ names?: Record<string, string> }>(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`).catch(() => ({ names: undefined }));
    pubkey = nostrPublicKey(result.names?.[name] ?? '');
  }
  if (!pubkey) return { posts: [] };
  const events = await queryNostr({ kinds: [1], authors: [pubkey], limit: 20, ...(cursor ? { until: Number(cursor) - 1 } : {}) });
  const oldest = events[events.length - 1]?.created_at;
  return { posts: await nostrNotes(events, `Posted by ${handle} on Nostr`), cursor: events.length >= 20 && oldest ? String(oldest) : undefined };
}

/** Full-text search through a relay that supports it (NIP-50). */
export async function searchNostr(text: string, video = false): Promise<SocialPost[]> {
  const events = await queryNostr({ kinds: [1], search: text, limit: 40 }, ['wss://relay.nostr.band', 'wss://search.nos.today'], 7000);
  const found = await nostrNotes(events, `Matches “${text}” in Nostr relay search`);
  return video ? found.filter((post) => post.kind === 'video') : found;
}

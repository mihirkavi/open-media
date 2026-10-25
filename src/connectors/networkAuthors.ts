import {
  DesoPostRecord, FarcasterCastMessage, HivePostRecord, LensPostRecord, livepeerPlaybackId, NetworkId, networks, socialPostFromDeso, socialPostFromFarcaster,
  socialPostFromHive, socialPostFromLens, threeSpeakVideoId,
} from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { desoEndpoint, farcasterProfile, hiveEndpoint, lensEndpoint, lensPostsQuery, NetworkFeedPage, requestJSON, resolveLivepeer, resolveThreeSpeak, snapchain } from './networkFeeds';

/**
 * One person's own public posts on an open network, newest first, for their unified profile
 * (ADR 0013). Read-only and keyless, like the feeds. Each post says where it came from.
 */
export const authorNetworks: NetworkId[] = ['farcaster', 'lens', 'hive', 'deso'];

const pageSize = 15;

function fromAuthor(posts: SocialPost[], network: NetworkId, handle: string): SocialPost[] {
  return posts.map((post) => ({ ...post, eligibility: { selection: `Posted by @${handle} on ${networks[network].displayName}`, filters: post.eligibility?.filters ?? [] } }));
}

export function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

async function farcasterAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  const proof = await snapchain<{ fid?: number }>(`/v1/userNameProofByName?name=${encodeURIComponent(handle)}`);
  if (!proof.fid) return { posts: [] };
  const query = new URLSearchParams({ fid: String(proof.fid), pageSize: String(pageSize), reverse: 'true' });
  if (cursor) query.set('pageToken', cursor);
  const page = await snapchain<{ messages?: FarcasterCastMessage[]; nextPageToken?: string }>(`/v1/castsByFid?${query}`);
  const profile = await farcasterProfile(proof.fid);
  const posts = (page.messages ?? []).map((message) => socialPostFromFarcaster(message, profile, { id: 'profile', parentUrl: '' })).filter((post): post is SocialPost => Boolean(post));
  return { posts, cursor: page.nextPageToken || undefined };
}

async function lensAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  const account = await requestJSON<{ data?: { account?: { address: string } | null } }>(lensEndpoint, {
    method: 'POST',
    body: JSON.stringify({ query: 'query OpenMediaLensAccount($request: AccountRequest!) { account(request: $request) { address } }', variables: { request: { username: { localName: handle } } } }),
  });
  const address = account.data?.account?.address;
  if (!address) return { posts: [] };
  const request = { pageSize: 'TEN', cursor: cursor ?? null, filter: { authors: [address], postTypes: ['ROOT'] } };
  const result = await requestJSON<{ data?: { posts: { items: LensPostRecord[]; pageInfo: { next?: string | null } } }; errors?: { message: string }[] }>(lensEndpoint, { method: 'POST', body: JSON.stringify({ query: lensPostsQuery, variables: { request } }) });
  if (!result.data) throw new Error(result.errors?.[0]?.message ?? 'Lens returned no data.');
  return { posts: result.data.posts.items.map(socialPostFromLens).filter((post): post is SocialPost => Boolean(post)), cursor: result.data.posts.pageInfo.next ?? undefined };
}

async function hiveAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  // Hive account names are 3–16 characters; anything else cannot exist.
  if (!/^[a-z0-9.-]{3,16}$/.test(handle.toLowerCase())) return { posts: [] };
  const [startAuthor, startPermlink] = cursor ? cursor.split('/') : [];
  const params = { sort: 'posts', account: handle.toLowerCase(), limit: pageSize, ...(startAuthor && startPermlink ? { start_author: startAuthor, start_permlink: startPermlink } : {}) };
  const result = await requestJSON<{ result?: HivePostRecord[]; error?: { message: string } }>(hiveEndpoint, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'bridge.get_account_posts', params, id: 1 }) });
  if (!result.result) throw new Error(result.error?.message ?? 'Hive returned no posts.');
  const records = result.result.filter((record) => !(record.author === startAuthor && record.permlink === startPermlink));
  const last = records[records.length - 1];
  const videos = await resolveThreeSpeak(records.map(threeSpeakVideoId).filter((id): id is string => Boolean(id)));
  return { posts: records.map((record) => socialPostFromHive(record, videos)).filter((post): post is SocialPost => Boolean(post)), cursor: records.length === pageSize && last ? `${last.author}/${last.permlink}` : undefined };
}

async function desoAuthor(handle: string, cursor?: string): Promise<NetworkFeedPage> {
  const result = await requestJSON<{ Posts?: DesoPostRecord[] }>(`${desoEndpoint}/get-posts-for-public-key`, {
    method: 'POST',
    body: JSON.stringify({ Username: handle, NumToFetch: pageSize, LastPostHashHex: cursor ?? '', MediaRequired: false }),
  });
  // This call leaves the author's profile off each post, so it is fetched once and attached.
  const profile = await requestJSON<{ Profile?: DesoPostRecord['ProfileEntryResponse'] }>(`${desoEndpoint}/get-single-profile`, { method: 'POST', body: JSON.stringify({ Username: handle }) }).catch(() => ({ Profile: undefined }));
  const records = (result.Posts ?? []).map((record) => ({ ...record, ProfileEntryResponse: record.ProfileEntryResponse ?? profile.Profile }));
  const last = records[records.length - 1];
  const videos = await resolveLivepeer(records.flatMap((record) => (record.VideoURLs ?? []).slice(0, 1).map(livepeerPlaybackId)).filter((id): id is string => Boolean(id)));
  return { posts: records.map((record) => socialPostFromDeso(record, videos)).filter((post): post is SocialPost => Boolean(post)), cursor: records.length === pageSize && last ? last.PostHashHex : undefined };
}

const readers: Record<NetworkId, (handle: string, cursor?: string) => Promise<NetworkFeedPage>> = {
  farcaster: farcasterAuthor, lens: lensAuthor, hive: hiveAuthor, deso: desoAuthor,
};

/** Posts by one account on one network. Returns no posts (rather than failing) for unknown accounts. */
export async function fetchAuthorPosts(network: NetworkId, handle: string, cursor?: string): Promise<NetworkFeedPage> {
  const clean = cleanHandle(handle);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clean)) return { posts: [] };
  const page = await readers[network](clean, cursor);
  return { posts: fromAuthor(page.posts, network, clean), cursor: page.cursor };
}

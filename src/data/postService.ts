import { getSupabaseClient } from '../auth/supabase';
import type { ReportReason } from '../domain/listingSafety';
import { deletePostVideoFiles } from './videoUpload';
import { ListingRating, PostListing } from '../domain/listings';
import { SocialPost } from '../domain/posts';
import { StoredPostVideo } from '../domain/postVideo';
import { isPublicPostRecord, maxPostLength, PublicPostRecord, socialPostFromPublic } from '../domain/publicPosts';

export type PostReportReason = ReportReason;

export interface PostPage {
  posts: SocialPost[];
  /** Pass back to load the next (older) page; undefined when there are no more. */
  cursor?: { createdAt: string; id: string };
}

const pageSize = 20;

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Open Media is not connected to its backend.');
  return client;
}

const supabaseUrl = () => process.env.EXPO_PUBLIC_SUPABASE_URL;
const fromRecord = (record: PublicPostRecord) => socialPostFromPublic(record, supabaseUrl());

/**
 * Public posts, newest first. Works signed out; signed in it also hides blocked authors.
 * `media: 'video'` returns only posts with a video (for Clips).
 */
export async function loadPublicPosts(options: { before?: PostPage['cursor']; authorHandle?: string; media?: 'video' } = {}): Promise<PostPage> {
  const { data, error } = await requireClient().rpc('open_media_public_posts', {
    p_limit: pageSize,
    p_before_created_at: options.before?.createdAt ?? null,
    p_before_id: options.before?.id ?? null,
    p_author_handle: options.authorHandle ?? null,
    p_media: options.media ?? null,
  });
  if (error) throw error;
  const records = (Array.isArray(data) ? data : []).filter(isPublicPostRecord) as PublicPostRecord[];
  const last = records[records.length - 1];
  return {
    posts: records.map(fromRecord),
    cursor: records.length === pageSize && last ? { createdAt: last.createdAt, id: last.id } : undefined,
  };
}

/** Creates the canonical Open Media post. A video must already be uploaded (see `videoUpload.ts`). */
export async function publishPost(body: string, clientId: string, video?: StoredPostVideo): Promise<SocialPost> {
  const text = body.trim();
  if (!text && !video) throw new Error('Write something before publishing.');
  if (text.length > maxPostLength) throw new Error(`Posts can be up to ${maxPostLength} characters.`);
  const { data, error } = await requireClient().rpc('open_media_create_post', { p_client_id: clientId, p_body: text, p_video: video ?? null });
  if (error) throw error;
  if (!isPublicPostRecord(data)) throw new Error('Open Media returned an unexpected post.');
  return fromRecord(data);
}

/** Publishes a product or service as a public post; the caption defaults to the title. */
export async function publishListing(body: string, clientId: string, listing: PostListing): Promise<SocialPost> {
  const text = body.trim();
  if (text.length > maxPostLength) throw new Error(`Posts can be up to ${maxPostLength} characters.`);
  const { data, error } = await requireClient().rpc('open_media_create_listing_post', { p_client_id: clientId, p_body: text, p_listing: listing });
  if (error) throw error;
  if (!isPublicPostRecord(data)) throw new Error('Open Media returned an unexpected post.');
  return fromRecord(data);
}

/** Publishes a public preview with a paid part that only buyers can read (ADR 0013, phase 6). */
export async function publishPaidPost(preview: string, clientId: string, paidText: string, priceMinor: number, currency: string): Promise<SocialPost> {
  const text = preview.trim();
  if (text.length > maxPostLength) throw new Error(`Posts can be up to ${maxPostLength} characters.`);
  const { data, error } = await requireClient().rpc('open_media_create_paid_post', { p_client_id: clientId, p_preview: text, p_paid_body: paidText.trim(), p_price_minor: priceMinor, p_currency: currency });
  if (error) throw error;
  if (!isPublicPostRecord(data)) throw new Error('Open Media returned an unexpected post.');
  return fromRecord(data);
}

/** Rates a listing 1–5 stars. The server allows it only for verified people who show their legal name. */
export async function rateListing(postId: string, stars: number | null): Promise<ListingRating> {
  const { data, error } = stars === null
    ? await requireClient().rpc('open_media_remove_rating', { p_post_id: postId })
    : await requireClient().rpc('open_media_rate_listing', { p_post_id: postId, p_stars: stars });
  if (error) throw new Error(error.code === '42501' ? 'Only verified people who show their legal name can rate. Verify in Profile → Privacy and identity.' : error.message);
  return data as ListingRating;
}

/** Changes the price, place or availability of one of your listings. */
export async function updateListing(postId: string, changes: Partial<Pick<PostListing, 'priceMinor' | 'location' | 'remote' | 'availability'>>): Promise<PostListing> {
  const { data, error } = await requireClient().rpc('open_media_update_listing', { p_post_id: postId, p_changes: changes });
  if (error) throw error;
  return data as PostListing;
}

/** Deletes the post, then its video files (authors can read their own post rows for the paths). */
export async function deletePost(postId: string): Promise<void> {
  const client = requireClient();
  const { data: row } = await client.from('posts').select('video_path, video_poster_path').eq('id', postId).maybeSingle();
  const { error } = await client.rpc('open_media_delete_post', { p_post_id: postId });
  if (error) throw error;
  const paths = [row?.video_path, row?.video_poster_path].filter((path): path is string => typeof path === 'string');
  if (paths.length) await deletePostVideoFiles(paths);
}

export async function reportPost(postId: string, reason: PostReportReason, details = ''): Promise<void> {
  const { error } = await requireClient().rpc('open_media_report_post', { p_post_id: postId, p_reason: reason, p_details: details });
  if (error) throw error;
}

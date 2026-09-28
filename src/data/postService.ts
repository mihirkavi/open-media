import { getSupabaseClient } from '../auth/supabase';
import { SocialPost } from '../domain/posts';
import { isPublicPostRecord, maxPostLength, PublicPostRecord, socialPostFromPublic } from '../domain/publicPosts';

export type PostReportReason = 'spam' | 'harassment' | 'other';

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

/** Public posts, newest first. Works signed out; signed in it also hides blocked authors. */
export async function loadPublicPosts(options: { before?: PostPage['cursor']; authorHandle?: string } = {}): Promise<PostPage> {
  const { data, error } = await requireClient().rpc('open_media_public_posts', {
    p_limit: pageSize,
    p_before_created_at: options.before?.createdAt ?? null,
    p_before_id: options.before?.id ?? null,
    p_author_handle: options.authorHandle ?? null,
  });
  if (error) throw error;
  const records = (Array.isArray(data) ? data : []).filter(isPublicPostRecord) as PublicPostRecord[];
  const last = records[records.length - 1];
  return {
    posts: records.map(socialPostFromPublic),
    cursor: records.length === pageSize && last ? { createdAt: last.createdAt, id: last.id } : undefined,
  };
}

export async function publishPost(body: string, clientId: string): Promise<SocialPost> {
  const text = body.trim();
  if (!text) throw new Error('Write something before publishing.');
  if (text.length > maxPostLength) throw new Error(`Posts can be up to ${maxPostLength} characters.`);
  const { data, error } = await requireClient().rpc('open_media_create_post', { p_client_id: clientId, p_body: text });
  if (error) throw error;
  if (!isPublicPostRecord(data)) throw new Error('Open Media returned an unexpected post.');
  return socialPostFromPublic(data);
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await requireClient().rpc('open_media_delete_post', { p_post_id: postId });
  if (error) throw error;
}

export async function reportPost(postId: string, reason: PostReportReason, details = ''): Promise<void> {
  const { error } = await requireClient().rpc('open_media_report_post', { p_post_id: postId, p_reason: reason, p_details: details });
  if (error) throw error;
}

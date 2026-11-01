import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabaseClient } from '../auth/supabase';
import { PublishedCopy, PublishingError } from '../connectors/publishing/types';
import { prepareCrossPost } from '../domain/crossPosting';
import { networks } from '../domain/networkPosts';
import { engagementFromRecord, InteractionTarget, maxCommentLength, PostComment, postCommentFromRecord } from '../domain/postInteractions';
import { PostEngagement } from '../domain/posts';
import { publishingConnector } from './crossPostService';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Open Media is not connected to its backend.');
  return client;
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === 'P0002') return new Error('That post isn’t available any more.');
  if (error.code === '54000') return new Error('Too many comments for now. Try again later.');
  return new Error(error.message);
}

/** Likes an Open Media post (or takes the like back); returns the post's new counts. */
export async function setPostLike(postId: string, liked: boolean): Promise<PostEngagement> {
  const { data, error } = await requireClient().rpc('open_media_set_post_like', { p_post_id: postId, p_liked: liked });
  if (error) throw friendly(error);
  return engagementFromRecord(data);
}

/** Reshares an Open Media post (or takes the reshare back); returns the post's new counts. */
export async function setPostReshare(postId: string, reshared: boolean): Promise<PostEngagement> {
  const { data, error } = await requireClient().rpc('open_media_set_post_reshare', { p_post_id: postId, p_reshared: reshared });
  if (error) throw friendly(error);
  return engagementFromRecord(data);
}

/** Comments on an Open Media post. The client ID makes a retried send idempotent. */
export async function addPostComment(postId: string, clientId: string, body: string): Promise<PostComment> {
  const text = body.trim();
  if (!text) throw new Error('Write something first.');
  if (text.length > maxCommentLength) throw new Error(`Comments can be up to ${maxCommentLength} characters.`);
  const { data, error } = await requireClient().rpc('open_media_add_post_comment', { p_post_id: postId, p_client_id: clientId, p_body: text });
  if (error) throw friendly(error);
  const comment = postCommentFromRecord(data);
  if (!comment) throw new Error('Open Media returned an unexpected comment.');
  return comment;
}

/** Comments on an Open Media post, oldest first. Works signed out for public posts. */
export async function loadPostComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await requireClient().rpc('open_media_post_comments', { p_post_id: postId, p_limit: 100 });
  if (error) throw friendly(error);
  return (Array.isArray(data) ? data : []).map(postCommentFromRecord).filter((comment): comment is PostComment => Boolean(comment));
}

// Likes and reshares already sent to other networks from this device, so the icon stays filled
// after a reload and a second tap never sends the same reaction twice.
const ledgerKey = 'open-media.network-interactions';
const ledgerLimit = 500;
type Ledger = Record<string, number>;

async function readLedger(): Promise<Ledger> {
  try { return JSON.parse((await AsyncStorage.getItem(ledgerKey)) ?? '{}') as Ledger; } catch { return {}; }
}

/** Which of `like` and `reshare` this device already sent for an external post. */
export async function networkInteractionsDone(postId: string): Promise<{ liked: boolean; reshared: boolean }> {
  const ledger = await readLedger();
  return { liked: Boolean(ledger[`${postId}:like`]), reshared: Boolean(ledger[`${postId}:reshare`]) };
}

/**
 * Likes, reshares, or comments on a post from another network as the person's connected account.
 * `idempotencyKey` identifies one comment draft, so a retry never replies twice.
 */
export async function interactOnNetwork(postId: string, target: InteractionTarget, interaction: { kind: 'like' } | { kind: 'reshare' } | { kind: 'comment'; text: string; idempotencyKey: string }): Promise<PublishedCopy | undefined> {
  const connector = publishingConnector(target.network);
  const name = networks[target.network].displayName;
  const availability = await connector.availability();
  if (!availability.available) throw new PublishingError(availability.reason);
  if (!(await connector.account())) throw new PublishingError(`Connect ${name} in Settings → Cross-posting.`);
  if (interaction.kind === 'comment') {
    const prepared = prepareCrossPost(interaction.text, target.network);
    if (!prepared.ok) throw new PublishingError(prepared.reason);
    return connector.interact(target, { kind: 'comment', text: prepared.content.text }, `${interaction.idempotencyKey}:${target.network}`);
  }
  const key = `${postId}:${interaction.kind}`;
  const ledger = await readLedger();
  if (ledger[key]) return undefined;
  try {
    await connector.interact(target, interaction, key);
  } catch (error) {
    throw error instanceof PublishingError ? error : new PublishingError(`${name} didn’t accept that. Try again.`);
  }
  ledger[key] = Date.now();
  const kept = Object.entries(ledger).sort(([, a], [, b]) => b - a).slice(0, ledgerLimit);
  await AsyncStorage.setItem(ledgerKey, JSON.stringify(Object.fromEntries(kept)));
  return undefined;
}

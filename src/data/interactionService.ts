import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabaseClient } from '../auth/supabase';
import { PublishedCopy, PublishingError } from '../connectors/publishing/types';
import { prepareCrossPost } from '../domain/crossPosting';
import { networks } from '../domain/networkPosts';
import { engagementFromRecord, InteractionTarget, maxCommentLength, PostComment, postCommentFromRecord } from '../domain/postInteractions';
import { PostEngagement } from '../domain/posts';
import { actOnFarcasterLink, farcasterAccountFid, fitsFarcasterLink } from '../connectors/publishing/farcaster';
import { farcasterProfile, snapchain } from '../connectors/networkFeeds';
import { combineLinkEngagement, emptyLinkActivity, FarcasterCopies, farcasterCopiesFromRecord, FarcasterLinkActivity, farcasterLinkComments, linkReplies, reactionFids, withOwnAction } from '../domain/farcasterLinks';
import { FarcasterCastMessage } from '../domain/networkPosts';
import { loadCrossPostPreferences, publishingConnector } from './crossPostService';

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

// ---------- Web feed items and public events (ADR 0024 addenda) ----------
//
// Open Media keeps its own record of each like, reshare and comment on an article or event link.
// When the person has Farcaster connected for cross-posting (and hasn't turned it off), the same
// action also goes to Farcaster as a link reaction or a reply to the link, so other Farcaster apps
// see it; and what other Farcaster apps did on the link is shown here, each person counted once.

export interface LinkActionResult {
  engagement: PostEngagement;
  /** Where the action also went, e.g. “Also on Farcaster as @ada.”, or why it didn't. */
  note?: string;
}

interface OpenMediaLinkRecord { engagement: PostEngagement; copies: FarcasterCopies }
const linkRecord = (data: unknown): OpenMediaLinkRecord => ({ engagement: engagementFromRecord(data), copies: farcasterCopiesFromRecord(data) });

/** The Farcaster account actions on links are copied to: connected, and not turned off in Cross-posting. */
async function farcasterMirror(): Promise<{ fid: number; handle: string } | undefined> {
  const connector = publishingConnector('farcaster');
  const [account, fid, preferences] = await Promise.all([connector.account().catch(() => undefined), farcasterAccountFid(), loadCrossPostPreferences()]);
  if (!account || !fid || preferences.excludedByDefault.includes('farcaster')) return undefined;
  return { fid, handle: account.handle };
}

// What Farcaster has on each link, kept for two minutes so cards on screen share one read.
const activityTtlMs = 2 * 60_000;
const activityCache = new Map<string, { at: number; activity: Promise<FarcasterLinkActivity> }>();
async function readFarcasterActivity(url: string): Promise<FarcasterLinkActivity> {
  if (!fitsFarcasterLink(url)) return emptyLinkActivity;
  const query = (extra: string) => `url=${encodeURIComponent(url)}&pageSize=100${extra}`;
  const [likes, recasts, replies] = await Promise.all([
    snapchain<Parameters<typeof reactionFids>[0]>(`/v1/reactionsByTarget?${query('&reaction_type=Like')}`).catch(() => undefined),
    snapchain<Parameters<typeof reactionFids>[0]>(`/v1/reactionsByTarget?${query('&reaction_type=Recast')}`).catch(() => undefined),
    snapchain<{ messages?: FarcasterCastMessage[] }>(`/v1/castsByParent?${query('')}`).catch(() => undefined),
  ]);
  return { likeFids: reactionFids(likes), recastFids: reactionFids(recasts), replies: linkReplies(replies, url) };
}
function farcasterActivity(url: string): Promise<FarcasterLinkActivity> {
  const cached = activityCache.get(url);
  if (cached && Date.now() - cached.at < activityTtlMs) return cached.activity;
  const activity = readFarcasterActivity(url).catch(() => emptyLinkActivity);
  activityCache.set(url, { at: Date.now(), activity });
  return activity;
}
function adjustActivity(url: string, change: (activity: FarcasterLinkActivity) => FarcasterLinkActivity) {
  const cached = activityCache.get(url);
  if (cached) activityCache.set(url, { at: cached.at, activity: cached.activity.then(change) });
}

async function combined(url: string, record: OpenMediaLinkRecord): Promise<PostEngagement> {
  const [activity, fid] = await Promise.all([farcasterActivity(url), farcasterAccountFid().catch(() => undefined)]);
  return combineLinkEngagement(record.engagement, record.copies, activity, fid);
}

async function setLinkReaction(url: string, kind: 'like' | 'reshare', on: boolean): Promise<LinkActionResult> {
  const { data, error } = await requireClient().rpc(kind === 'like' ? 'open_media_set_web_item_like' : 'open_media_set_web_item_reshare', kind === 'like' ? { p_url: url, p_liked: on } : { p_url: url, p_reshared: on });
  if (error) throw friendly(error);
  let record = linkRecord(data);
  let note: string | undefined;
  const mirror = await farcasterMirror().catch(() => undefined);
  if (mirror && fitsFarcasterLink(url)) {
    try {
      await actOnFarcasterLink(url, { kind, on });
      adjustActivity(url, (activity) => withOwnAction(activity, mirror.fid, { kind, on }));
      if (on) {
        const noted = await requireClient().rpc('open_media_note_web_item_farcaster_copy', { p_url: url, p_kind: kind, p_fid: mirror.fid });
        if (!noted.error) record = linkRecord(noted.data);
      }
      note = on ? `Also on Farcaster as ${mirror.handle}.` : 'Taken back on Farcaster too.';
    } catch (reason) {
      note = `Saved in Open Media. ${reason instanceof PublishingError ? reason.message : 'Farcaster didn’t take it this time.'}`;
    }
  }
  return { engagement: await combined(url, record), note };
}

/** Likes a web feed item or event (or takes the like back), on Farcaster too when connected. */
export function setWebItemLike(url: string, liked: boolean): Promise<LinkActionResult> {
  return setLinkReaction(url, 'like', liked);
}

/** Reshares a web feed item or event (or takes it back); a recast on Farcaster too when connected. */
export function setWebItemReshare(url: string, reshared: boolean): Promise<LinkActionResult> {
  return setLinkReaction(url, 'reshare', reshared);
}

/** Comments on a web feed item or event, and replies to the link on Farcaster when connected. The client ID makes a retried send idempotent. */
export async function addWebItemComment(url: string, clientId: string, body: string): Promise<{ comment: PostComment; note?: string }> {
  const text = body.trim();
  if (!text) throw new Error('Write something first.');
  if (text.length > maxCommentLength) throw new Error(`Comments can be up to ${maxCommentLength} characters.`);
  const { data, error } = await requireClient().rpc('open_media_add_web_item_comment', { p_url: url, p_client_id: clientId, p_body: text });
  if (error) throw friendly(error);
  const comment = postCommentFromRecord(data);
  if (!comment) throw new Error('Open Media returned an unexpected comment.');
  const mirror = await farcasterMirror().catch(() => undefined);
  if (!mirror || comment.farcasterHash || !fitsFarcasterLink(url)) return { comment };
  const prepared = prepareCrossPost(text, 'farcaster');
  if (!prepared.ok) return { comment, note: `Saved in Open Media. ${prepared.reason}` };
  try {
    const { hash } = await actOnFarcasterLink(url, { kind: 'comment', text: prepared.content.text });
    if (hash) await requireClient().rpc('open_media_note_web_item_farcaster_copy', { p_url: url, p_kind: 'comment', p_fid: mirror.fid, p_comment_id: comment.id, p_hash: hash });
    activityCache.delete(url);
    return { comment: hash ? { ...comment, farcasterHash: hash } : comment, note: `Also on Farcaster as ${mirror.handle}.${prepared.note ? ` ${prepared.note}` : ''}` };
  } catch (reason) {
    return { comment, note: `Saved in Open Media. ${reason instanceof PublishingError ? reason.message : 'Farcaster didn’t take it this time.'}` };
  }
}

/** Comments on a web feed item or event, oldest first: Open Media's, then replies from other Farcaster apps among them. Works signed out. */
export async function loadWebItemComments(url: string): Promise<PostComment[]> {
  const [{ data, error }, activity] = await Promise.all([
    requireClient().rpc('open_media_web_item_comments', { p_url: url, p_limit: 100 }),
    farcasterActivity(url),
  ]);
  if (error) throw friendly(error);
  const own = (Array.isArray(data) ? data : []).map(postCommentFromRecord).filter((comment): comment is PostComment => Boolean(comment));
  const copied = own.map((comment) => comment.farcasterHash).filter((hash): hash is string => Boolean(hash));
  const fids = [...new Set(activity.replies.filter((reply) => !copied.includes(reply.hash)).map((reply) => reply.data.fid))].slice(0, 50);
  const profiles = new Map((await Promise.all(fids.map((fid) => farcasterProfile(fid)))).map((profile) => [profile.fid, profile]));
  return [...own, ...farcasterLinkComments(activity.replies, profiles, copied)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Web item counts are asked for together: cards that appear within a moment share one request.
let waitingUrls = new Map<string, ((record: OpenMediaLinkRecord) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
async function flushEngagement() {
  const batch = waitingUrls; waitingUrls = new Map(); flushTimer = undefined;
  const urls = [...batch.keys()];
  for (let start = 0; start < urls.length; start += 100) {
    const chunk = urls.slice(start, start + 100);
    const { data } = await requireClient().rpc('open_media_web_item_engagement', { p_urls: chunk }).then((result) => result, () => ({ data: null }));
    const found = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    for (const url of chunk) for (const resolve of batch.get(url) ?? []) resolve(linkRecord(found[url]));
  }
}

/** A web feed item's or event's counts (Open Media's and Farcaster's) and the viewer's own like and reshare. */
export async function loadWebItemEngagement(url: string): Promise<PostEngagement> {
  const record = await new Promise<OpenMediaLinkRecord>((resolve) => {
    waitingUrls.set(url, [...(waitingUrls.get(url) ?? []), resolve]);
    flushTimer ??= setTimeout(() => { flushEngagement().catch(() => undefined); }, 40);
  });
  return combined(url, record);
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

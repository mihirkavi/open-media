import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { createClientId } from '../data/openMediaService';
import { addPostComment, addWebItemComment, interactOnNetwork, loadPostComments, loadWebItemComments, loadWebItemEngagement, networkInteractionsDone, setPostLike, setPostReshare, setWebItemLike, setWebItemReshare } from '../data/interactionService';
import { NetworkId, networks } from '../domain/networkPosts';
import { applyInteraction, InteractionKind, interactionLabel, interactionRoute, InteractionRoute, maxCommentLength, PostComment, webItemUrl } from '../domain/postInteractions';
import { PostEngagement, SocialPost } from '../domain/posts';
import { formatRelativeTime } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { RichText } from './RichText';
import { Text, TextInput } from './Text';
import { useCrossPosting } from './useCrossPosting';
import { TranslationNote, useTranslation } from './useTranslation';
import { Loader } from './Loader';

const zero: PostEngagement = { replies: 0, reposts: 0, likes: 0, liked: false, reshared: false };

/**
 * The comment, reshare, and like icons under a post. Open Media posts, web feed items and events are
 * acted on in Open Media; links (web feed items and events) also on Farcaster through the person's
 * connected cross-posting account, with Farcaster's own likes, recasts and replies counted in. Posts
 * from another network go through the connected account there, or, without one, the icon opens the
 * post on its network. `children` (the post's links) follow the icons.
 */
export function PostActions({ post, signedIn, children }: { post: SocialPost; signedIn: boolean; children?: ReactNode }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const native = post.provenance.connectorId === 'open-media';
  const item = useMemo(() => webItemUrl(post), [post]);
  const [engagement, setEngagement] = useState<PostEngagement | undefined>(post.engagement ?? (native || item ? zero : undefined));
  useEffect(() => { setEngagement(post.engagement ?? (native || item ? zero : undefined)); }, [post.engagement, native, item]);
  // A web feed item's counts come from Open Media, asked for with the other cards on screen.
  useEffect(() => {
    if (!item) return;
    let live = true;
    loadWebItemEngagement(item).then((loaded) => { if (live) setEngagement(loaded); }).catch(() => undefined);
    return () => { live = false; };
  }, [item, signedIn]);
  const crossPosting = useCrossPosting();
  const connected = useMemo(() => Object.fromEntries(crossPosting.networks.filter((item) => item.account).map((item) => [item.network, item.account!.handle])) as Partial<Record<NetworkId, string>>, [crossPosting.networks]);
  const routes = useMemo(() => ({
    like: interactionRoute(post, 'like', { signedIn, connected }),
    comment: interactionRoute(post, 'comment', { signedIn, connected }),
    reshare: interactionRoute(post, 'reshare', { signedIn, connected }),
  }), [post, signedIn, connected]);
  const [busy, setBusy] = useState<InteractionKind>();
  const [notice, setNotice] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);

  // External likes and reshares sent from this device stay filled after a reload.
  useEffect(() => {
    if (native || item) return;
    let live = true;
    networkInteractionsDone(post.id).then((done) => { if (live && (done.liked || done.reshared)) setEngagement((current) => current && { ...current, liked: done.liked || current.liked, reshared: done.reshared || current.reshared }); }).catch(() => undefined);
    return () => { live = false; };
  }, [native, post.id]);

  if (!engagement) return <View style={styles.actions}>{children}</View>;

  const toggle = async (kind: 'like' | 'reshare') => {
    const route = routes[kind];
    if (route.via === 'open') { Linking.openURL(route.url).catch(() => undefined); return; }
    if (route.via === 'sign-in') { setNotice('Sign in to like, comment, or reshare.'); return; }
    if (route.via !== 'open-media' && route.via !== 'web' && route.via !== 'network') return;
    const active = Boolean(kind === 'like' ? engagement.liked : engagement.reshared);
    if (route.via === 'network' && active) { setNotice(`${kind === 'like' ? 'Liked' : 'Reshared'} on ${networks[route.network].displayName}. To undo it, use ${networks[route.network].displayName}.`); return; }
    const before = engagement;
    setEngagement(applyInteraction(engagement, kind, !active)); setNotice(''); setBusy(kind);
    try {
      if (route.via === 'open-media') setEngagement(await (kind === 'like' ? setPostLike(post.id, !active) : setPostReshare(post.id, !active)));
      else if (route.via === 'web') {
        // Kept in Open Media, and also sent to Farcaster when the person connected it for cross-posting.
        const result = await (kind === 'like' ? setWebItemLike(route.url, !active) : setWebItemReshare(route.url, !active));
        setEngagement(result.engagement);
        if (result.note) setNotice(result.note);
      }
      else {
        await interactOnNetwork(post.id, route.target, { kind });
        setNotice(`${kind === 'like' ? 'Liked' : 'Reshared'} on ${networks[route.network].displayName} as ${route.handle}.`);
      }
    } catch (error) {
      setEngagement(before);
      setNotice(error instanceof Error ? error.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(undefined);
    }
  };
  const openComments = () => {
    const route = routes.comment;
    if (route.via === 'open') { Linking.openURL(route.url).catch(() => undefined); return; }
    if (route.via === 'open-media' || route.via === 'web' || route.via === 'network') setCommentsOpen((open) => !open);
  };

  return <>
    <View style={styles.actions}>
      <Action icon="chatbubble-outline" activeIcon="chatbubble" active={commentsOpen} count={engagement.replies} route={routes.comment} label={interactionLabel('comment', engagement, routes.comment)} expanded={commentsOpen} onPress={openComments} />
      <Action icon="repeat-outline" activeIcon="repeat" active={Boolean(engagement.reshared)} count={engagement.reposts} route={routes.reshare} label={interactionLabel('reshare', engagement, routes.reshare)} busy={busy === 'reshare'} onPress={() => toggle('reshare')} />
      <Action icon="heart-outline" activeIcon="heart" active={Boolean(engagement.liked)} count={engagement.likes} route={routes.like} label={interactionLabel('like', engagement, routes.like)} busy={busy === 'like'} onPress={() => toggle('like')} />
      {children}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {commentsOpen ? <Comments post={post} route={routes.comment} signedIn={signedIn} onCommented={() => setEngagement((current) => current && { ...current, replies: current.replies + 1 })} /> : null}
  </>;
}

function Action({ icon, activeIcon, active, count, route, label, busy = false, expanded, onPress }: { icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap; active: boolean; count: number; route: InteractionRoute; label: string; busy?: boolean; expanded?: boolean; onPress: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const content = <><Ionicons name={active ? activeIcon : icon} size={17} color={active ? colors.text : colors.textSecondary} /><Text style={[styles.actionText, active && styles.actionTextActive]}>{count}</Text></>;
  // A post with no way to act (for example an event) keeps plain counts, never a button that does nothing.
  if (route.via === 'none') return <View accessible accessibilityLabel={label} style={styles.action}>{content}</View>;
  return <Pressable accessibilityRole={route.via === 'open' ? 'link' : 'button'} accessibilityLabel={label} accessibilityState={{ busy, ...(expanded === undefined ? { selected: active } : { expanded }) }} disabled={busy} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>{content}</Pressable>;
}

/**
 * An event's Register action, drawn like the like and reshare icons: a ticket (the metaphor event apps
 * use for getting in) with a one-word label where the others show a count. It opens the official page,
 * where people register themselves; Open Media can't see whether they did, so it has no filled state.
 */
export function RegisterAction({ url, label, short }: { url: string; label: string; short: string }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const [hovered, setHovered] = useState(false);
  return <View style={styles.tipAnchor}>
    {/* React Native Web drops `title`, so web gets its tooltip here; phones read the label instead. */}
    {hovered && Platform.OS === 'web' ? <View pointerEvents="none" style={styles.tip}><Text numberOfLines={1} style={styles.tipText}>{label}</Text></View> : null}
    <Pressable accessibilityRole="link" accessibilityLabel={label} accessibilityHint="Opens the official page" onPress={() => { Linking.openURL(url).catch(() => undefined); }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} hitSlop={6} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons name="ticket-outline" size={17} color={hovered ? colors.text : colors.textSecondary} />
      <Text style={[styles.actionText, hovered && styles.actionTextActive]}>{short}</Text>
    </Pressable>
  </View>;
}

/** A comment, in the reader's language when it was written in another. */
function CommentBody({ comment, source, style }: { comment: PostComment; source: string; style: object }) {
  const translation = useTranslation(comment.id, [comment.body]);
  return <><RichText text={translation.texts[0]} source={source} style={style} /><TranslationNote note={translation.note} /></>;
}

function Comments({ post, route, signedIn, onCommented }: { post: SocialPost; route: InteractionRoute; signedIn: boolean; onCommented: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  // Comments kept in Open Media: on its own posts, and on web feed items by article link.
  const native = route.via === 'open-media' || route.via === 'web';
  const itemUrl = route.via === 'web' ? route.url : undefined;
  const [comments, setComments] = useState<PostComment[]>();
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  // One client ID per draft keeps a retried send from commenting twice.
  const clientId = useRef(createClientId());
  useEffect(() => {
    if (!native) return;
    let live = true;
    (itemUrl ? loadWebItemComments(itemUrl) : loadPostComments(post.id)).then((items) => { if (live) setComments(items); }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : 'Comments didn’t load.'); });
    return () => { live = false; };
  }, [native, itemUrl, post.id]);
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError(''); setSent('');
    try {
      if (route.via === 'open-media' || route.via === 'web') {
        if (route.via === 'web') {
          const result = await addWebItemComment(route.url, clientId.current, text);
          setComments((current) => [...(current ?? []), result.comment]);
          if (result.note) setSent(result.note);
        } else {
          const comment = await addPostComment(post.id, clientId.current, text);
          setComments((current) => [...(current ?? []), comment]);
        }
      } else if (route.via === 'network') {
        await interactOnNetwork(post.id, route.target, { kind: 'comment', text, idempotencyKey: clientId.current });
        setSent(`Your reply is on ${networks[route.network].displayName}, posted as ${route.handle}.`);
      }
      setDraft(''); clientId.current = createClientId(); onCommented();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your comment didn’t send. Try again.');
    } finally {
      setSending(false);
    }
  };
  const placeholder = route.via === 'network' ? `Reply on ${networks[route.network].displayName} as ${route.handle}…` : 'Add a comment…';
  return <View style={styles.comments}>
    {native && comments === undefined && !error ? <Loader color={colors.textSecondary} /> : null}
    {native && comments?.length === 0 ? <Text style={styles.commentMeta}>No comments yet.</Text> : null}
    {comments?.map((comment) => <View key={comment.id} style={styles.comment}>
      <Text numberOfLines={1} style={styles.commentMeta}><Text style={styles.commentAuthor}>{comment.author.displayName}</Text> {comment.author.handle} · {formatRelativeTime(comment.createdAt)}{comment.network === 'farcaster' ? ' · on Farcaster' : comment.farcasterHash ? ' · also on Farcaster' : ''}</Text>
      <CommentBody comment={comment} source={comment.network ?? post.provenance.connectorId} style={styles.commentBody} />
    </View>)}
    {!native && route.via === 'network' ? <Text style={styles.commentMeta}>Other replies are on {networks[route.network].displayName}.</Text> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {sent ? <Text accessibilityLiveRegion="polite" style={styles.commentMeta}>{sent}</Text> : null}
    {signedIn ? <View style={styles.commentField}>
      <TextInput accessibilityLabel={placeholder.replace('…', '')} value={draft} onChangeText={setDraft} placeholder={placeholder} placeholderTextColor={colors.textTertiary} maxLength={maxCommentLength} editable={!sending} returnKeyType="send" submitBehavior="submit" onSubmitEditing={send} style={styles.commentInput} />
      {sending ? <Loader color={colors.textSecondary} /> : null}
    </View> : <Text style={styles.commentMeta}>Sign in to comment.</Text>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  actions: { marginTop: 12, marginLeft: -2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 24, rowGap: 4 },
  action: { minHeight: 32, minWidth: 32, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pressed: { opacity: 0.5 },
  tipAnchor: { position: 'relative' },
  tip: { position: 'absolute', bottom: '100%', left: -8, marginBottom: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.text, zIndex: 10, width: 'max-content' } as object,
  tipText: { color: colors.surface, fontSize: 11, fontWeight: '600' },
  actionText: { color: colors.textSecondary, fontSize: 12 },
  actionTextActive: { color: colors.text, fontWeight: '700' },
  notice: { marginTop: 6, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  comments: { marginTop: 10, padding: 12, gap: 10, borderRadius: 14, backgroundColor: colors.chrome },
  comment: { gap: 2 },
  commentAuthor: { color: colors.text, fontWeight: '700' },
  commentMeta: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  commentBody: { color: colors.text, fontSize: 15, lineHeight: 21 },
  commentField: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentInput: { flex: 1, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 14, outlineStyle: 'none' } as object,
});

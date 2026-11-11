import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { followWebFeed, listWebFeeds, loadWebFeedProfile, unfollowWebFeed, WebFeedSubscription } from '../data/webFeedService';
import { safeHttpsUrl } from '../domain/networkPosts';
import { SocialPost } from '../domain/posts';
import { formatNames, hostOf, maxItemAgeDays, WebFeedPostInfo } from '../domain/webFeeds';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Loader } from './Loader';
import { Text } from './Text';
import { VerifiedTick } from './VerifiedTick';
import { WebFeedCard } from './WebFeedCard';

/**
 * A web feed's profile (ADR 0024), laid out like a person's: the site's icon and name, then every
 * item the feed currently has, newest first. The items come from the same read the Feed makes,
 * narrowed to this feed, so nothing about it is stored. Only the explicit links leave Open Media:
 * “Visit …” for the site and each item's “Read on …” for the article.
 */
export function WebFeedProfile({ feed, viewerId, onBack }: { feed: WebFeedPostInfo; viewerId?: string; onBack?: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const [posts, setPosts] = useState<SocialPost[]>();
  const [error, setError] = useState('');
  const [subscription, setSubscription] = useState<WebFeedSubscription | null>();
  const [busy, setBusy] = useState(false);
  const [followError, setFollowError] = useState('');

  useEffect(() => {
    let active = true;
    setPosts(undefined); setError('');
    loadWebFeedProfile(feed.feedUrl).then((items) => { if (active) setPosts(items); }).catch((reason) => { if (active) { setPosts([]); setError(reason instanceof Error ? reason.message : 'Couldn’t load this feed.'); } });
    listWebFeeds().then((feeds) => { if (active) setSubscription(feeds.find((item) => item.url === feed.feedUrl) ?? null); }).catch(() => { if (active) setSubscription(null); });
    return () => { active = false; };
  }, [feed.feedUrl]);

  const siteUrl = safeHttpsUrl(feed.siteUrl);
  const host = hostOf(siteUrl ?? feed.feedUrl);
  const toggleFollow = async () => {
    setBusy(true); setFollowError('');
    try {
      if (subscription) { await unfollowWebFeed(subscription.id); setSubscription(null); }
      else setSubscription(await followWebFeed(feed.feedUrl));
    } catch (reason) {
      setFollowError(reason instanceof Error ? reason.message : 'That didn’t work. Try again.');
    } finally { setBusy(false); }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {onBack ? <View style={styles.bar}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable></View> : <View style={styles.barSpace} />}

    <View style={styles.header}>
      <SiteAvatar url={feed.iconUrl} name={feed.siteName} styles={styles} />
      <View style={styles.nameLine}><Text accessibilityRole="header" style={styles.name}>{feed.siteName}</Text>{feed.official ? <VerifiedTick size={20} label={`Official feed from ${feed.official.domain}`} /> : null}</View>
      <Text style={styles.meta}>{[host, `${formatNames[feed.format]} feed`].filter(Boolean).join(' · ')}</Text>
      {feed.official ? <Text style={styles.small}>Official feed, served from {feed.official.domain}</Text> : null}
      {posts?.length ? <Text style={styles.small}>{`${posts.length} ${posts.length === 1 ? 'item' : 'items'} from the last ${maxItemAgeDays} days`}</Text> : null}
      <View style={styles.actions}>
        {viewerId && subscription !== undefined ? <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(subscription), busy }} disabled={busy} onPress={toggleFollow} style={[styles.button, !subscription && styles.primary]}>
          <Text style={subscription ? styles.buttonText : styles.primaryText}>{subscription ? 'Following' : 'Follow'}</Text>
        </Pressable> : null}
        {siteUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`Visit ${host} in your browser`} onPress={() => { Linking.openURL(siteUrl).catch(() => undefined); }} style={styles.button}><Text style={styles.buttonText}>Visit {host}</Text><Ionicons name="open-outline" size={14} color={colors.text} /></Pressable> : null}
      </View>
      {followError ? <Text accessibilityRole="alert" style={styles.error}>{followError}</Text> : null}
    </View>

    <View style={styles.timeline}>
      {posts === undefined ? <Loader style={styles.loading} color={colors.text} />
        : posts.length === 0 ? <Text style={styles.empty}>{error || `No items from the last ${maxItemAgeDays} days.`}</Text>
        : posts.map((post) => <WebFeedCard key={post.id} post={post} mode="raw" signedIn={Boolean(viewerId)} inProfile />)}
    </View>
  </ScrollView>;
}

/** The site's icon at profile size; its initial when there is none or it fails to load. */
function SiteAvatar({ url, name, styles }: { url?: string; name: string; styles: ReturnType<typeof createStyles> }) {
  const [failed, setFailed] = useState(false);
  const safe = failed ? undefined : safeHttpsUrl(url);
  return <View style={styles.avatar}>{safe ? <Image source={{ uri: safe }} accessibilityIgnoresInvertColors onError={() => setFailed(true)} resizeMode="contain" style={styles.avatarImage} /> : <Text style={styles.initials}>{name.replace(/^the\s+/i, '').slice(0, 1).toUpperCase() || '?'}</Text>}</View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingBottom: 48 },
    bar: { paddingHorizontal: 8, paddingTop: 8 },
    barSpace: { height: 16 },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    header: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 6 },
    avatar: { width: 88, height: 88, borderRadius: 22, marginBottom: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    avatarImage: { width: 56, height: 56 },
    initials: { color: colors.text, fontSize: 32, fontWeight: '600' },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { color: colors.text, fontSize: 26, fontWeight: '700', textAlign: 'center' },
    meta: { color: colors.textTertiary, fontSize: 14 },
    small: { marginTop: 4, color: colors.textTertiary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 12 },
    button: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
    buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    primary: { backgroundColor: colors.text, borderColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
    timeline: { paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    loading: { padding: 32 },
    empty: { padding: 32, color: colors.textTertiary, fontSize: 14, textAlign: 'center' },
  });
}

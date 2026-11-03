import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { FeedLens, LensContext } from '../domain/feedLenses';
import { safeHttpsUrl } from '../domain/networkPosts';
import { explainFeedPost, FeedMode, SocialPost } from '../domain/posts';
import { formatRelativeTime } from '../domain/publicPosts';
import { formatNames, hostOf, WebFeedAlert } from '../domain/webFeeds';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text } from './Text';
import { TranslationNote, useTranslation } from './useTranslation';
import { VerifiedTick } from './VerifiedTick';
import { OriginalLink } from './OriginalLink';

/**
 * An item from a web feed the viewer follows (ADR 0024), laid out like a news card: the site's icon
 * and name, the lead image, the headline, a short excerpt, and the way to the publisher. Only the
 * excerpt is shown; the article is read on the publisher's site. Feeds served from a major news
 * outlet's or weather service's own domain carry the blue tick, labelled as an official feed.
 */
export function WebFeedCard({ post, mode, lensContext }: { post: SocialPost; mode: FeedMode | FeedLens; lensContext?: LensContext }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const feed = post.webFeed!;
  const [expanded, setExpanded] = useState(false);
  const explanation = explainFeedPost(post, mode, lensContext);
  const articleUrl = safeHttpsUrl(post.provenance.canonicalURL);
  const siteUrl = safeHttpsUrl(feed.siteUrl);
  const articleHost = hostOf(articleUrl ?? siteUrl ?? feed.feedUrl);
  const image = post.media?.[0]?.kind === 'image' && !feed.alert ? post.media[0] : undefined;
  const translation = useTranslation(post.id, [post.title ?? '', post.body]); const [title, body] = translation.texts;
  // Feeds often publish only a small thumbnail (BBC's are 240 pixels wide); those sit beside the
  // headline instead of being stretched across the card.
  const size = useImageSize(image?.url);
  const thumbnail = Boolean(size && size.width < 480);
  const open = (url?: string) => { if (url) Linking.openURL(url).catch(() => undefined); };
  // A blog's own name often holds its author's (“Simon Willison's Weblog”); the byline is then left out.
  const byline = [feed.author && !feed.alert && !feed.siteName.toLocaleLowerCase().includes(feed.author.toLocaleLowerCase()) ? `By ${feed.author}` : '', feed.audio ? `Episode${feed.audio.durationSeconds ? ` · ${Math.max(1, Math.round(feed.audio.durationSeconds / 60))} min` : ''}` : ''].filter(Boolean).join(' · ');

  return <View style={styles.card}>
    <View style={styles.header}>
      <Pressable accessibilityRole="link" accessibilityLabel={`Open ${feed.siteName}`} disabled={!siteUrl} onPress={() => open(siteUrl)} style={styles.site}>
        <SiteIcon url={feed.iconUrl} name={feed.siteName} styles={styles} />
        <Text numberOfLines={1} style={styles.siteName}>{feed.siteName}</Text>
        {feed.official ? <VerifiedTick size={14} label={`Official feed from ${feed.official.domain}`} /> : null}
      </Pressable>
      <Text style={styles.time}>{formatRelativeTime(post.createdAt)}</Text>
    </View>
    {feed.alert ? <AlertBanner alert={feed.alert} styles={styles} colors={colors} /> : null}
    {image?.url && size && !thumbnail ? <LeadImage url={image.url} altText={image.altText} aspectRatio={Math.min(2, Math.max(1.2, size.width / size.height))} onPress={articleUrl ? () => open(articleUrl) : undefined} styles={styles} /> : null}
    <View style={styles.story}>
      <View style={styles.storyText}>
        {post.title ? <Pressable accessibilityRole="link" disabled={!articleUrl} onPress={() => open(articleUrl)}><Text style={[styles.headline, feed.alert && styles.headlineAlert]}>{title}</Text></Pressable> : null}
        {post.body ? <Text numberOfLines={feed.alert ? 6 : 3} style={[styles.excerpt, !post.title && styles.excerptAlone]}>{body}</Text> : null}
      </View>
      {image?.url && thumbnail ? <Pressable accessibilityRole="link" accessibilityLabel={image.altText} disabled={!articleUrl} onPress={() => open(articleUrl)}><Image source={{ uri: image.url }} accessible accessibilityLabel={image.altText} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.thumbnail} /></Pressable> : null}
    </View>
    <TranslationNote note={translation.note} />
    {byline ? <Text numberOfLines={1} style={styles.byline}>{byline}</Text> : null}
    <View style={styles.footer}>
      {articleUrl ? <OriginalLink url={articleUrl} label={`${feed.audio ? 'Listen' : 'Read'} on ${articleHost}`} accessibilityLabel={`Read the full ${feed.audio ? 'episode' : feed.alert ? 'alert' : 'article'} on ${articleHost}`} /> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.why}><Text style={styles.whyText}>Why this?</Text></Pressable>
    </View>
    {expanded ? <View style={styles.explanation}>
      <Text style={styles.explanationTitle}>Why you’re seeing this</Text>
      {explanation.used.map((item) => <Text key={item} style={styles.explanationItem}>✓ {item}</Text>)}
      <Text style={styles.explanationSubtitle}>How {explanation.lens} works</Text>
      <Text style={styles.explanationItem}>{explanation.rules.join(' · ')}</Text>
      {explanation.scoring.length ? <><Text style={styles.explanationSubtitle}>How {explanation.lens} weighed this item</Text>{explanation.scoring.map((item) => <Text key={item} style={styles.explanationItem}>{item}</Text>)}</> : null}
      <Text style={styles.notUsed}>{explanation.tuneHint}</Text>
      <Text style={styles.explanationSubtitle}>About this feed</Text>
      {feed.official ? <Text style={styles.explanationItem}>✓ Official feed: served from {feed.official.domain}, {feed.official.name}’s own domain</Text> : null}
      <Text style={styles.explanationItem}>· {formatNames[feed.format]} feed at {feed.feedUrl}</Text>
      <Text style={styles.explanationItem}>· Open Media reads it at most every {feed.refreshMinutes} minutes, and asks only for changes</Text>
      <Text style={styles.explanationItem}>· Only the headline, a short excerpt and one image are shown; the full {feed.alert ? 'alert' : 'article'} stays on {articleHost}</Text>
      {feed.rights ? <Text style={styles.explanationItem}>· The publisher says: {feed.rights}</Text> : null}
      <Text style={styles.notUsed}>Search “unfollow {hostOf(siteUrl ?? feed.feedUrl)}” to stop following it, or “less from @{post.author.handle}” to see less of it. Not used: {explanation.notUsed.join(', ')}</Text>
    </View> : null}
  </View>;
}

/** Severity first, as weather services present alerts: the event, then until when and where. */
function AlertBanner({ alert, styles, colors }: { alert: WebFeedAlert; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  const urgent = alert.severity === 'extreme' || alert.severity === 'severe';
  const severity = alert.level ? `${alert.level[0].toUpperCase()}${alert.level.slice(1)} warning` : alert.severity === 'unknown' ? 'Alert' : `${alert.severity[0].toUpperCase()}${alert.severity.slice(1)}`;
  const until = alert.expires ? `Until ${new Date(alert.expires).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  return <View accessibilityRole="summary" style={styles.alert}>
    <View style={[styles.alertBar, { backgroundColor: urgent ? colors.danger : colors.text }]} />
    <View style={styles.alertCopy}>
      <Text style={[styles.alertSeverity, urgent && { color: colors.danger }]}>{severity.toUpperCase()}</Text>
      <Text style={styles.alertEvent}>{alert.event.replace(/^(Red|Amber|Yellow) warning: /, '')}</Text>
      {until || alert.area ? <Text numberOfLines={2} style={styles.alertWhere}>{[until, alert.area].filter(Boolean).join(' · ')}</Text> : null}
    </View>
  </View>;
}

/** The site's own icon; its initial on a quiet tile when there is none or it fails to load. */
function SiteIcon({ url, name, styles }: { url?: string; name: string; styles: ReturnType<typeof createStyles> }) {
  const [failed, setFailed] = useState(false);
  const safe = failed ? undefined : safeHttpsUrl(url);
  return <View style={styles.icon}>{safe ? <Image source={{ uri: safe }} accessibilityIgnoresInvertColors onError={() => setFailed(true)} resizeMode="contain" style={styles.iconImage} /> : <Text style={styles.iconLetter}>{name.replace(/^the\s+/i, '').slice(0, 1).toUpperCase()}</Text>}</View>;
}

/** An image's natural size once known; undefined while loading or when it can't be loaded. */
function useImageSize(url: string | undefined) {
  const [size, setSize] = useState<{ url: string; width: number; height: number }>();
  useEffect(() => {
    if (!url) return;
    let live = true;
    Image.getSize(url, (width, height) => { if (live && width && height) setSize({ url, width, height }); }, () => undefined);
    return () => { live = false; };
  }, [url]);
  return size?.url === url ? size : undefined;
}

/** One lead image at its own shape (within limits); it disappears quietly if it fails to load. */
function LeadImage({ url, altText, aspectRatio, onPress, styles }: { url: string; altText: string; aspectRatio: number; onPress?: () => void; styles: ReturnType<typeof createStyles> }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <Pressable accessibilityRole="link" accessibilityLabel={altText} disabled={!onPress} onPress={onPress}>
    <Image source={{ uri: url }} accessible accessibilityLabel={altText} accessibilityIgnoresInvertColors resizeMode="cover" onError={() => setFailed(true)} style={[styles.image, { aspectRatio }]} />
  </Pressable>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  card: { paddingVertical: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  site: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 22, height: 22, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  iconImage: { width: 22, height: 22 },
  iconLetter: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  siteName: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
  time: { color: colors.textTertiary, fontSize: 13 },
  image: { width: '100%', marginTop: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.chrome },
  story: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  storyText: { flex: 1, minWidth: 0 },
  thumbnail: { width: 92, height: 92, marginTop: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.chrome },
  headline: { marginTop: 12, color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  headlineAlert: { fontSize: 15, lineHeight: 21, fontWeight: '600', letterSpacing: 0 },
  excerpt: { marginTop: 6, color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  excerptAlone: { marginTop: 12, color: colors.text, fontSize: 16, lineHeight: 23.5 },
  byline: { marginTop: 8, color: colors.textTertiary, fontSize: 12 },
  // The same bottom-right group as every post: the original, then Why this?
  footer: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14 },
  why: { minHeight: 32, justifyContent: 'center' },
  whyText: { color: colors.textSecondary, fontSize: 12, textDecorationLine: 'underline' },
  alert: { marginTop: 14, flexDirection: 'row', gap: 12, padding: 14, borderRadius: 14, backgroundColor: colors.chrome },
  alertBar: { width: 3, borderRadius: 2 },
  alertCopy: { flex: 1, gap: 3 },
  alertSeverity: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  alertEvent: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  alertWhere: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  explanation: { marginTop: 10, padding: 14, borderRadius: 14, backgroundColor: colors.chrome },
  explanationTitle: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  explanationSubtitle: { marginTop: 10, marginBottom: 4, color: colors.text, fontSize: 12, fontWeight: '700' },
  explanationItem: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  notUsed: { marginTop: 8, color: colors.textTertiary, fontSize: 12, lineHeight: 15 },
}); }

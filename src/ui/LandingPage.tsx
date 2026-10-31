import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { agentInterfaces, honestStatus, mission, philosophy, principles, promises, roadmap, roadmapLabels, sourceRepository, surfaces, tagline } from '../domain/about';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { BrandMark } from './BrandMark';
import { LandingFilm } from './LandingFilm';
import { Text } from './Text';

export type PublicPage = 'landing' | 'feed' | 'mission' | 'developers';

/**
 * The website's front page for people who aren't signed in. It explains the idea in the order the
 * Master Builder Prompt does (the promise, the three benefits, the product, the philosophy, the
 * mission) and keeps the app's black-and-white system: Inter for reading, Instrument Serif only
 * for the few headlines that carry the idea.
 */
export function LandingPage({ onNavigate, onSignIn }: { onNavigate: (page: PublicPage) => void; onSignIn: () => void }) {
  const { colors } = useOpenMediaTheme();
  const { width, height: windowHeight } = useWindowDimensions();
  const wide = width >= 960;
  const medium = width >= 640;
  const styles = useMemo(() => createStyles(colors, wide, medium), [colors, wide, medium]);
  const apiURL = process.env.EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL;

  // The film fills the screen. On a landscape screen it takes the full height (trimming a little
  // from the sides); on a portrait one it keeps its 16:9 shape so its type is never cut off.
  const filmHeight = width / windowHeight >= 1.5 ? windowHeight : Math.min(width * 9 / 16, windowHeight);
  // As it scrolls into view it grows from an inset card to the full screen, the way Apple's
  // product pages do. Reduced motion skips the growth.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [filmTop, setFilmTop] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  const grow = reduceMotion ? new Animated.Value(1) : scrollY.interpolate({ inputRange: [filmTop - windowHeight, filmTop], outputRange: [0, 1], extrapolate: 'clamp' });
  const filmScale = grow.interpolate({ inputRange: [0, 1], outputRange: [wide ? 0.84 : 0.92, 1] });
  const filmRadius = grow.interpolate({ inputRange: [0, 1], outputRange: [wide ? 32 : 18, 0] });

  return <Animated.ScrollView style={styles.screen} contentContainerStyle={styles.content} scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}>
    <PublicNav current="landing" onNavigate={onNavigate} onSignIn={onSignIn} />

    <View style={styles.section}>
      <View style={styles.hero}>
        <View accessibilityRole="text" style={styles.eyebrow}><View style={styles.eyebrowDot} /><Text style={styles.eyebrowText}>Open source · Public beta</Text></View>
        <Text accessibilityRole="header" style={styles.heroTitle}>Your social world,{'\n'}<Text style={styles.heroItalic}>together.</Text></Text>
        <Text style={styles.heroLead}>Open Media brings the networks and inboxes you already use into one calm app: one feed, one inbox, one post to every network you choose. You decide what you see, and you can always leave with everything.</Text>
        <View style={styles.ctaRow}>
          <Button label="Open the feed" primary onPress={() => onNavigate('feed')} />
          <Button label="Read the mission" onPress={() => onNavigate('mission')} />
        </View>
        <Text style={styles.heroNote}>Free · No ads by default · Works on iPhone, Android and the web</Text>
      </View>
    </View>

    <Animated.View onLayout={(event) => setFilmTop(event.nativeEvent.layout.y)} style={[styles.film, { height: filmHeight, borderRadius: filmRadius, transform: [{ scale: filmScale }] }]}>
      <LandingFilm />
    </Animated.View>
    <View style={styles.section}>
      <Text style={styles.kicker}>The idea</Text>
      <Text accessibilityRole="header" style={styles.quote}>“{philosophy.line}”</Text>
      <Text style={styles.quoteBody}>{philosophy.body}</Text>
    </View>

    <View style={styles.rule} />
    <View style={styles.section}>
      <Text style={styles.kicker}>Three promises</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Everything technical comes down to three things you can feel.</Text>
      <View style={styles.grid}>
        {promises.map((item, index) => <View key={item.title} style={styles.card}>
          <Text style={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</Text>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardLine}>{item.line}</Text>
          <Text style={styles.cardBody}>{item.body}</Text>
        </View>)}
      </View>
    </View>

    <View style={styles.rule} />
    <View style={styles.section}>
      <Text style={styles.kicker}>The app</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Three places. Nothing more.</Text>
      <Text style={styles.sectionLead}>Search, settings and your profile stay out of the way until you need them. Open Media is useful on day one, even if none of your friends have joined, because it connects what you already have.</Text>
      <View style={styles.grid}>
        {surfaces.map((surface) => <View key={surface.name} style={styles.surface}>
          <View style={styles.surfaceIcon}><Ionicons name={surface.icon} size={20} color={colors.text} /></View>
          <Text style={styles.cardTitle}>{surface.name}</Text>
          <Text style={styles.cardBody}>{surface.body}</Text>
        </View>)}
      </View>
    </View>

    <View style={styles.rule} />
    <View style={styles.section}>
      <View style={styles.split}>
        <View style={styles.splitText}>
          <Text style={styles.kicker}>For people and agents</Text>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Open by design.</Text>
          <Text style={styles.sectionLead}>Everything Open Media does has a documented interface. Public posts, search, the mixed feed and every network’s capabilities are open to anyone, with no account. Your own account works through the same API and an MCP server, so an AI assistant can post, read and reply for you when you allow it.</Text>
          <View style={styles.ctaRow}>
            <Button label="Developers and agents" onPress={() => onNavigate('developers')} />
            {apiURL ? <Button label="Open the API" onPress={() => { Linking.openURL(`${apiURL}/v1`).catch(() => undefined); }} /> : null}
          </View>
        </View>
        <View accessibilityLabel="Example: search public posts from a terminal, or add Open Media to an AI assistant" style={styles.code}>
          <Text style={styles.codeComment}># Search every open network, no account needed</Text>
          <Text style={styles.codeLine}>curl "{apiURL ?? 'https://api.openmedia'}/v1/search?q=ethereum+videos"</Text>
          <Text style={[styles.codeComment, styles.codeGap]}># Give an AI assistant the same tools</Text>
          <Text style={styles.codeLine}>{'{ "mcpServers": { "open-media": {'}</Text>
          <Text style={styles.codeLine}>{`    "url": "${apiURL ?? 'https://api.openmedia'}/open/mcp" } } }`}</Text>
          <View style={styles.codeList}>
            {agentInterfaces.mcp.map((server) => <Text key={server.path} style={styles.codeMeta}>{server.path.padEnd(10)} {server.auth === 'none' ? 'no account' : server.auth}</Text>)}
          </View>
        </View>
      </View>
    </View>

    <View style={styles.rule} />
    <View style={styles.section}>
      <Text style={styles.kicker}>Principles</Text>
      <View style={styles.principles}>
        {principles.slice(0, 7).map((line) => <Text key={line} style={styles.principle}>{line}</Text>)}
      </View>
      <Pressable accessibilityRole="link" onPress={() => onNavigate('mission')}><Text style={styles.textLink}>Read the full mission →</Text></Pressable>
    </View>

    <View style={styles.rule} />
    <View style={styles.section}>
      <Text style={styles.kicker}>Where it’s going</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Built in the open, one honest step at a time.</Text>
      <View style={styles.roadmap}>
        {roadmap.map((item, index) => <View key={item.phase} style={[styles.roadmapRow, index > 0 && styles.roadmapDivider]}>
          <Text style={styles.roadmapIndex}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={styles.roadmapCopy}><Text style={styles.roadmapPhase}>{item.phase}</Text><Text style={styles.roadmapDetail}>{item.detail}</Text></View>
          <View style={[styles.status, item.status === 'done' && styles.statusDone]}><Text style={[styles.statusText, item.status === 'done' && styles.statusTextDone]}>{roadmapLabels[item.status]}</Text></View>
        </View>)}
      </View>
      <Text style={styles.honest}>{honestStatus.join(' ')}</Text>
    </View>

    <View style={styles.band}>
      <Text style={styles.bandKicker}>Our mission</Text>
      <Text accessibilityRole="header" style={styles.bandTitle}>{mission}</Text>
      <View style={styles.ctaRow}>
        <Button label="Open the feed" inverse primary onPress={() => onNavigate('feed')} />
        <Button label="Sign in" inverse onPress={onSignIn} />
      </View>
    </View>

    <PublicFooter onNavigate={onNavigate} />
  </Animated.ScrollView>;
}

/** The top bar shared by the landing, mission and developer pages. */
export function PublicNav({ current, onNavigate, onSignIn }: { current: PublicPage; onNavigate: (page: PublicPage) => void; onSignIn: () => void }) {
  const { colors } = useOpenMediaTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width >= 960, width >= 640), [colors, width]);
  const links: { page: PublicPage; label: string }[] = [{ page: 'feed', label: 'Feed' }, { page: 'mission', label: 'Mission' }, { page: 'developers', label: 'Developers' }];
  return <View role="navigation" style={styles.nav}>
    <Pressable accessibilityRole="link" accessibilityLabel="Open Media home" onPress={() => onNavigate('landing')}><BrandMark compact /></Pressable>
    <View style={styles.navLinks}>
      {width >= 640 ? links.map((link) => <Pressable key={link.page} accessibilityRole="link" onPress={() => onNavigate(link.page)} style={styles.navLink}><Text style={[styles.navLinkText, current === link.page && styles.navLinkActive]}>{link.label}</Text></Pressable>) : null}
      <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.navSignIn}><Text style={styles.navSignInText}>Sign in</Text></Pressable>
    </View>
  </View>;
}

export function PublicFooter({ onNavigate }: { onNavigate: (page: PublicPage) => void }) {
  const { colors } = useOpenMediaTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width >= 960, width >= 640), [colors, width]);
  return <View style={styles.footer}>
    <View style={styles.footerTop}>
      <BrandMark compact />
      <View style={styles.footerLinks}>
        {(['feed', 'mission', 'developers'] as PublicPage[]).map((page) => <Pressable key={page} accessibilityRole="link" onPress={() => onNavigate(page)}><Text style={styles.footerLink}>{page === 'feed' ? 'Feed' : page === 'mission' ? 'Mission' : 'Developers and agents'}</Text></Pressable>)}
        <Pressable accessibilityRole="link" onPress={() => { Linking.openURL(sourceRepository).catch(() => undefined); }}><Text style={styles.footerLink}>Source code</Text></Pressable>
      </View>
    </View>
    <Text style={styles.footerNote}>{tagline} Open source under the MIT License. Public posts are open to everyone; messages, email and contacts stay private.</Text>
  </View>;
}

function Button({ label, onPress, primary, inverse }: { label: string; onPress: () => void; primary?: boolean; inverse?: boolean }) {
  const { colors } = useOpenMediaTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width >= 960, width >= 640), [colors, width]);
  const filled = primary ? (inverse ? styles.buttonInverseFilled : styles.buttonFilled) : (inverse ? styles.buttonInverseOutline : styles.buttonOutline);
  const text = primary ? (inverse ? styles.buttonInverseFilledText : styles.buttonFilledText) : (inverse ? styles.buttonInverseOutlineText : styles.buttonOutlineText);
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.button, filled, pressed && styles.pressed]}><Text style={[styles.buttonText, text]}>{label}</Text></Pressable>;
}

export function createStyles(colors: ThemeColors, wide: boolean, medium: boolean) {
  const gutter = wide ? 48 : medium ? 32 : 20;
  const serif = { fontFamily: 'serif' } as const;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { alignItems: 'center', paddingBottom: 0 },
    nav: { width: '100%', maxWidth: 1180, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, paddingVertical: 18 },
    navLinks: { flexDirection: 'row', alignItems: 'center', gap: wide ? 8 : 4 },
    navLink: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
    navLinkText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    navLinkActive: { color: colors.text },
    navSignIn: { marginLeft: 6, minHeight: 38, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.text },
    navSignInText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    section: { width: '100%', maxWidth: 1180, paddingHorizontal: gutter, paddingVertical: wide ? 88 : 56 },
    rule: { width: '100%', maxWidth: 1180 - gutter * 2, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    hero: { alignItems: 'center', paddingTop: wide ? 24 : 8 },
    eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    eyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
    eyebrowText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    heroTitle: { ...serif, marginTop: 28, color: colors.text, fontSize: wide ? 96 : medium ? 72 : 52, lineHeight: wide ? 96 : medium ? 74 : 56, letterSpacing: wide ? -2.4 : -1.4, textAlign: 'center' },
    heroItalic: { ...serif, fontStyle: 'italic' },
    heroLead: { marginTop: 24, maxWidth: 640, color: colors.textSecondary, fontSize: medium ? 19 : 17, lineHeight: medium ? 30 : 27, textAlign: 'center' },
    heroNote: { marginTop: 20, color: colors.textTertiary, fontSize: 13, textAlign: 'center' },
    film: { width: '100%', overflow: 'hidden', backgroundColor: '#000' },
    ctaRow: { marginTop: 28, flexDirection: 'row', flexWrap: 'wrap', justifyContent: wide ? 'flex-start' : 'center', gap: 12 },
    kicker: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
    quote: { ...serif, marginTop: 20, maxWidth: 980, color: colors.text, fontSize: wide ? 64 : medium ? 48 : 38, lineHeight: wide ? 70 : medium ? 54 : 44, letterSpacing: wide ? -1.2 : -0.6 },
    quoteBody: { marginTop: 24, maxWidth: 680, color: colors.textSecondary, fontSize: 17, lineHeight: 28 },
    sectionTitle: { ...serif, marginTop: 16, maxWidth: 760, color: colors.text, fontSize: wide ? 48 : medium ? 40 : 34, lineHeight: wide ? 54 : medium ? 46 : 40, letterSpacing: -0.6 },
    sectionLead: { marginTop: 18, maxWidth: 640, color: colors.textSecondary, fontSize: 17, lineHeight: 28 },
    grid: { marginTop: 40, flexDirection: wide ? 'row' : 'column', gap: 16 },
    card: { flex: wide ? 1 : undefined, padding: 28, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    cardNumber: { ...serif, color: colors.textTertiary, fontSize: 28, lineHeight: 30 },
    cardTitle: { marginTop: 18, color: colors.text, fontSize: 19, fontWeight: '600', lineHeight: 25 },
    cardLine: { marginTop: 6, color: colors.text, fontSize: 15, fontWeight: '500', lineHeight: 22 },
    cardBody: { marginTop: 10, color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
    surface: { flex: wide ? 1 : undefined, paddingTop: 22, borderTopWidth: 1, borderTopColor: colors.text },
    surfaceIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accentSoft },
    split: { flexDirection: wide ? 'row' : 'column', gap: wide ? 56 : 32, alignItems: wide ? 'center' : 'stretch' },
    splitText: { flex: wide ? 1 : undefined },
    code: { flex: wide ? 1 : undefined, padding: 24, borderRadius: 18, backgroundColor: '#0B0B0B', borderWidth: StyleSheet.hairlineWidth, borderColor: '#262626' },
    codeComment: { color: '#8B8B85', fontSize: 13, lineHeight: 21, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }) },
    codeLine: { color: '#F2F2EE', fontSize: 13, lineHeight: 21, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }) },
    codeGap: { marginTop: 16 },
    codeList: { marginTop: 18, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2A2A2A', gap: 2 },
    codeMeta: { color: '#A6A6A0', fontSize: 12, lineHeight: 19, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }) },
    principles: { marginTop: 24, marginBottom: 24 },
    principle: { ...serif, paddingVertical: wide ? 18 : 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, color: colors.text, fontSize: wide ? 34 : 26, lineHeight: wide ? 40 : 32, letterSpacing: -0.3 },
    textLink: { color: colors.text, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
    roadmap: { marginTop: 32, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
    roadmapRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: medium ? 24 : 16, paddingVertical: 18, backgroundColor: colors.surface },
    roadmapDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    roadmapIndex: { ...serif, width: 30, color: colors.textTertiary, fontSize: 20 },
    roadmapCopy: { flex: 1 },
    roadmapPhase: { color: colors.text, fontSize: 16, fontWeight: '600' },
    roadmapDetail: { marginTop: 3, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
    status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    statusDone: { backgroundColor: colors.text, borderColor: colors.text },
    statusText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    statusTextDone: { color: colors.surface },
    honest: { marginTop: 24, maxWidth: 760, color: colors.textTertiary, fontSize: 14, lineHeight: 22 },
    band: { width: '100%', alignItems: 'center', paddingHorizontal: gutter, paddingVertical: wide ? 120 : 72, backgroundColor: colors.text },
    bandKicker: { color: colors.surface, opacity: 0.6, fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
    bandTitle: { ...serif, marginTop: 20, maxWidth: 980, color: colors.surface, fontSize: wide ? 48 : medium ? 38 : 30, lineHeight: wide ? 56 : medium ? 46 : 38, letterSpacing: -0.6, textAlign: 'center' },
    footer: { width: '100%', maxWidth: 1180, paddingHorizontal: gutter, paddingVertical: 40, gap: 18 },
    footerTop: { flexDirection: medium ? 'row' : 'column', justifyContent: 'space-between', alignItems: medium ? 'center' : 'flex-start', gap: 16 },
    footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
    footerLink: { color: colors.textSecondary, fontSize: 14 },
    footerNote: { color: colors.textTertiary, fontSize: 13, lineHeight: 20, maxWidth: 760 },
    button: { minHeight: 48, paddingHorizontal: 22, justifyContent: 'center', alignItems: 'center', borderRadius: 999, borderWidth: 1 },
    buttonText: { fontSize: 15, fontWeight: '600' },
    buttonFilled: { backgroundColor: colors.text, borderColor: colors.text },
    buttonFilledText: { color: colors.surface },
    buttonOutline: { backgroundColor: 'transparent', borderColor: colors.border },
    buttonOutlineText: { color: colors.text },
    buttonInverseFilled: { backgroundColor: colors.surface, borderColor: colors.surface },
    buttonInverseFilledText: { color: colors.text },
    buttonInverseOutline: { backgroundColor: 'transparent', borderColor: colors.textTertiary },
    buttonInverseOutlineText: { color: colors.surface },
    pressed: { opacity: 0.72 },
  });
}

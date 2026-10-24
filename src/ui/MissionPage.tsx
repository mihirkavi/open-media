import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { honestStatus, mission, neverDefaults, philosophy, principles, promises, roadmap, roadmapLabels } from '../domain/about';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { PublicFooter, PublicNav, PublicPage } from './LandingPage';
import { Text } from './Text';

/** The long-form idea behind Open Media, from the Master Builder Prompt, set like an essay. */
const chapters: { title: string; paragraphs: string[] }[] = [
  {
    title: 'Why this exists',
    paragraphs: [
      'Your online life is split across apps that each want to be the only one you use. Friends are on one, colleagues on another, family on a third, and email sits off to the side. Each app decides what you see with a ranking you cannot inspect, and each one owns your followers, your posts and your history. Leave, and you start from zero.',
      'People did not choose this. It is simply the default when every application is also the owner of everything that happens inside it.',
    ],
  },
  {
    title: 'A doorway, not a destination',
    paragraphs: [
      philosophy.body,
      'That is why Open Media must be useful before it has a network of its own. It connects to the networks and inboxes you already have, through official APIs and open protocols, so it is valuable on the first day even if none of your friends have joined.',
    ],
  },
  {
    title: 'Your feed is a lens you choose',
    paragraphs: [
      'Feeds start simple: Raw is every eligible post, newest first, and it always stays available. Relevant uses a short list of signals you can see, such as who you follow, the interests you picked and how recent a post is. Every ranked post answers “Why am I seeing this?”, including the private data it did not use.',
      'Later, feed algorithms become optional lenses that anyone can publish, inspect, install, fork or remove. Each declares what data it may touch, runs without access to your messages, ID documents or exact location, and can be switched off in a tap.',
    ],
  },
  {
    title: 'Safety without a single owner',
    paragraphs: [
      'Global deletion is exceptional; filtering is normal. You, your communities and your region choose filters, including filters from independent moderation providers. Reports are signals weighed by credibility and evidence, never a counter that a mob can push to an automatic takedown.',
      'When content has to be hidden somewhere, the reason is shown where the law allows, and hiding it in one place does not erase it everywhere.',
    ],
  },
  {
    title: 'Real people, private by default',
    paragraphs: [
      'Participation never requires proving who you are. Where uniqueness matters, such as voting, a person can prove they are a real and unique human without uploading a passport or storing biometrics, and can keep several personas that observers cannot link to each other.',
      'The protocol is governed by people, not money: one verified human, one vote. Core rights, including algorithm choice, data portability and the right to fork, are protected from easy change.',
    ],
  },
  {
    title: 'Technology in its place',
    paragraphs: [
      'Blockchains prove; they do not host the social network. They are used only where they add trust, such as anchoring authorship or recording a vote. Nobody needs a wallet, a token or an understanding of fees to read, post or chat.',
      'Money buys services, not power. The reference app ships without advertising, there is no speculative token, and creators will earn through subscriptions, tips and memberships with the payment method they prefer.',
      'AI agents may take part, always as clearly labelled agents, never posing as humans, and they cannot message you unless you allow it. Everything Open Media offers to people it also offers to software, through documented interfaces.',
    ],
  },
  {
    title: 'Open, and built to outlive its makers',
    paragraphs: [
      'Open Media is open source and founder-led for now, with protocol stewardship moving over time to an independent foundation. If Open Media the company disappeared, the network should keep running through independent implementations. It should never depend on one company, one server, one algorithm, one moderator, one storage provider or one payment provider.',
    ],
  },
];

export function MissionPage({ chrome, onNavigate, onSignIn, onBack }: { chrome: 'public' | 'app'; onNavigate?: (page: PublicPage) => void; onSignIn?: () => void; onBack?: () => void }) {
  const { colors } = useOpenMediaTheme();
  const { width } = useWindowDimensions();
  const medium = width >= 640;
  const styles = useMemo(() => createStyles(colors, medium), [colors, medium]);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {chrome === 'public' && onNavigate && onSignIn
      ? <PublicNav current="mission" onNavigate={onNavigate} onSignIn={onSignIn} />
      : <View style={styles.appBar}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable><Text style={styles.appTitle}>Our mission</Text></View>}
    <View style={styles.article}>
      {chrome === 'public' ? <Text style={styles.kicker}>Our mission</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>{mission}</Text>
      <Text style={styles.standfirst}>Open Media starts as one simple app for your social world. The goal is bigger than any single app: an open protocol for human communication that no company, including ours, can lock people into.</Text>

      <View style={styles.promises}>
        {promises.map((item, index) => <View key={item.title} style={[styles.promise, index > 0 && styles.promiseDivider]}>
          <Text style={styles.promiseNumber}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={styles.promiseCopy}><Text style={styles.promiseTitle}>{item.title}</Text><Text style={styles.paragraph}>{item.body}</Text></View>
        </View>)}
      </View>

      {chapters.map((chapter) => <View key={chapter.title} style={styles.chapter}>
        <Text accessibilityRole="header" style={styles.heading}>{chapter.title}</Text>
        {chapter.paragraphs.map((paragraph) => <Text key={paragraph.slice(0, 40)} style={styles.paragraph}>{paragraph}</Text>)}
      </View>)}

      <View style={styles.chapter}>
        <Text accessibilityRole="header" style={styles.heading}>What Open Media will never do by default</Text>
        {neverDefaults.map((line) => <View key={line} style={styles.bullet}><Text style={styles.bulletMark}>—</Text><Text style={styles.bulletText}>{line}</Text></View>)}
      </View>

      <View style={styles.chapter}>
        <Text accessibilityRole="header" style={styles.heading}>The road ahead</Text>
        {roadmap.map((item) => <View key={item.phase} style={styles.roadRow}>
          <Text style={styles.roadPhase}>{item.phase}</Text>
          <Text style={styles.roadStatus}>{roadmapLabels[item.status]}</Text>
          <Text style={styles.roadDetail}>{item.detail}</Text>
        </View>)}
      </View>

      <View style={styles.chapter}>
        <Text accessibilityRole="header" style={styles.heading}>Principles</Text>
        {principles.map((line) => <Text key={line} style={styles.principle}>{line}</Text>)}
      </View>

      <View style={[styles.chapter, styles.note]}>
        <Text style={styles.noteTitle}>Where things stand today</Text>
        <Text style={styles.noteText}>{honestStatus.join(' ')}</Text>
      </View>
    </View>
    {chrome === 'public' && onNavigate ? <PublicFooter onNavigate={onNavigate} /> : null}
  </ScrollView>;
}

function createStyles(colors: ThemeColors, medium: boolean) {
  const serif = { fontFamily: 'serif' } as const;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { alignItems: 'center', paddingBottom: 32 },
    appBar: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '100%', maxWidth: 760, paddingHorizontal: 12, paddingTop: 8 },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    appTitle: { color: colors.text, fontSize: 26, fontWeight: '700' },
    article: { width: '100%', maxWidth: 720, paddingHorizontal: medium ? 32 : 20, paddingTop: medium ? 40 : 16 },
    kicker: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
    title: { ...serif, marginTop: 18, color: colors.text, fontSize: medium ? 46 : 34, lineHeight: medium ? 54 : 41, letterSpacing: -0.6 },
    standfirst: { marginTop: 22, color: colors.textSecondary, fontSize: medium ? 19 : 17, lineHeight: medium ? 30 : 27 },
    promises: { marginTop: 40, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.text },
    promise: { flexDirection: 'row', gap: 18, paddingVertical: 22 },
    promiseDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    promiseNumber: { ...serif, width: 32, color: colors.textTertiary, fontSize: 24, lineHeight: 28 },
    promiseCopy: { flex: 1 },
    promiseTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
    chapter: { marginTop: 48 },
    heading: { ...serif, color: colors.text, fontSize: medium ? 32 : 28, lineHeight: medium ? 38 : 34, letterSpacing: -0.3 },
    paragraph: { marginTop: 14, color: colors.textSecondary, fontSize: 17, lineHeight: 28 },
    bullet: { flexDirection: 'row', gap: 12, marginTop: 14 },
    bulletMark: { color: colors.textTertiary, fontSize: 17, lineHeight: 28 },
    bulletText: { flex: 1, color: colors.textSecondary, fontSize: 17, lineHeight: 28 },
    roadRow: { marginTop: 16, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    roadPhase: { color: colors.text, fontSize: 16, fontWeight: '600' },
    roadStatus: { marginTop: 2, color: colors.textTertiary, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
    roadDetail: { marginTop: 6, color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
    principle: { ...serif, marginTop: 14, color: colors.text, fontSize: medium ? 24 : 21, lineHeight: medium ? 31 : 28 },
    note: { padding: 22, borderRadius: 16, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    noteTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    noteText: { marginTop: 8, color: colors.textSecondary, fontSize: 15, lineHeight: 24 },
  });
}

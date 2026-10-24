import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';

import { getSupabaseClient } from '../auth/supabase';
import { agentInterfaces, sourceRepository } from '../domain/about';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { PublicFooter, PublicNav, PublicPage } from './LandingPage';
import { Text } from './Text';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

/**
 * Developers and agents: every programmatic interface Open Media offers, in one place. Signed-in
 * people can also hand an assistant a short-lived access token for their own account.
 */
export function DevelopersPage({ chrome, signedIn, onNavigate, onSignIn, onBack }: { chrome: 'public' | 'app'; signedIn?: boolean; onNavigate?: (page: PublicPage) => void; onSignIn?: () => void; onBack?: () => void }) {
  const { colors } = useOpenMediaTheme();
  const { width } = useWindowDimensions();
  const medium = width >= 640;
  const styles = useMemo(() => createStyles(colors, medium), [colors, medium]);
  const api = process.env.EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL || process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL || 'https://<open-media-api>';
  const [tokenStatus, setTokenStatus] = useState('');

  const shareToken = async () => {
    setTokenStatus('');
    const session = (await getSupabaseClient()?.auth.getSession())?.data.session;
    if (!session) { setTokenStatus('Sign in first.'); return; }
    const minutes = Math.max(1, Math.round(((session.expires_at ?? 0) * 1000 - Date.now()) / 60000));
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(session.access_token);
        setTokenStatus(`Copied. It works for about ${minutes} minutes; copy a new one after that.`);
      } else {
        await Share.share({ message: session.access_token });
        setTokenStatus(`It works for about ${minutes} minutes.`);
      }
    } catch {
      setTokenStatus('Could not copy the token.');
    }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {chrome === 'public' && onNavigate && onSignIn
      ? <PublicNav current="developers" onNavigate={onNavigate} onSignIn={onSignIn} />
      : <View style={styles.appBar}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable><Text style={styles.appTitle}>Developers and agents</Text></View>}
    <View style={styles.page}>
      {chrome === 'public' ? <Text style={styles.kicker}>Developers and agents</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>Everything Open Media does, as an interface.</Text>
      <Text style={styles.lead}>People, programs and AI agents get the same capabilities. Public data needs no account and no key. Your own account works through the same API and an MCP server, with a token you choose to share and can let expire.</Text>

      <Section title="Start here" styles={styles}>
        {agentInterfaces.discovery.map((item) => <Row key={item.path} method="GET" path={item.path} description={item.description} api={api} styles={styles} />)}
      </Section>

      <Section title="MCP servers" caption="Connect an AI assistant such as Claude or ChatGPT. Each server lists its own tools." styles={styles}>
        {agentInterfaces.mcp.map((server) => <View key={server.path} style={styles.row}>
          <View style={styles.rowTop}><Text style={styles.path}>{server.path}</Text><Text style={styles.badge}>{server.auth === 'none' ? 'No account' : server.auth}</Text></View>
          <Text style={styles.description}>{server.description}</Text>
        </View>)}
        <Code styles={styles} lines={[
          '{',
          '  "mcpServers": {',
          `    "open-media": { "url": "${api}/open/mcp" },`,
          `    "open-media-account": { "url": "${api}/me/mcp",`,
          '      "headers": { "Authorization": "Bearer <your access token>" } }',
          '  }',
          '}',
        ]} />
      </Section>

      <Section title="Public API" caption="No account, no key. Rate limited per client; please cache." styles={styles}>
        {agentInterfaces.public.map((item) => <Row key={item.path} method={item.method} path={item.path} description={item.description} api={api} styles={styles} />)}
        <Code styles={styles} lines={[`curl "${api}/v1/search?q=videos+about+ethereum+on+lens"`]} />
      </Section>

      <Section title="Your account" caption="Send your access token as “Authorization: Bearer …”. Every call acts only as you; the database refuses anything else." styles={styles}>
        {agentInterfaces.account.map((item) => <Row key={`${item.method}${item.path}`} method={item.method} path={item.path} description={item.description} api={api} styles={styles} />)}
        <Code styles={styles} lines={[
          `curl -X POST "${api}/v1/me/posts" \\`,
          '  -H "Authorization: Bearer $OPEN_MEDIA_TOKEN" \\',
          '  -H "Content-Type: application/json" \\',
          '  -d \'{"body": "Hello from my agent"}\'',
        ]} />
        <View style={styles.tokenCard}>
          <Text style={styles.tokenTitle}>Access token</Text>
          <Text style={styles.description}>A token lets an app or assistant act as you until it expires, about an hour after you copy it. Share it only with tools you trust. Signing out ends it.</Text>
          {signedIn
            ? <Pressable accessibilityRole="button" onPress={shareToken} style={styles.tokenButton}><Ionicons name="key-outline" size={16} color={colors.surface} /><Text style={styles.tokenButtonText}>{Platform.OS === 'web' ? 'Copy my access token' : 'Share my access token'}</Text></Pressable>
            : <Text style={styles.hint}>Sign in, then open Settings → Developers and agents to get one.</Text>}
          {tokenStatus ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{tokenStatus}</Text> : null}
        </View>
      </Section>

      <Section title="Ground rules" styles={styles}>
        <Text style={styles.description}>Open Media’s own public posts and profiles may be read and indexed freely, preferably through the API. Messages, email and contacts are never public. Agents must identify themselves as agents and never pose as people. Other networks’ content keeps its source and links back to it. The code is open source: <Text accessibilityRole="link" onPress={() => { Linking.openURL(sourceRepository).catch(() => undefined); }} style={styles.link}>github.com/mihirkavi/open-media</Text>.</Text>
      </Section>
    </View>
    {chrome === 'public' && onNavigate ? <PublicFooter onNavigate={onNavigate} /> : null}
  </ScrollView>;
}

function Section({ title, caption, children, styles }: React.PropsWithChildren<{ title: string; caption?: string; styles: ReturnType<typeof createStyles> }>) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    <View style={styles.sectionBody}>{children}</View>
  </View>;
}

function Row({ method, path, description, api, styles }: { method: string; path: string; description: string; api: string; styles: ReturnType<typeof createStyles> }) {
  const openable = method === 'GET' && !path.includes('{') && !path.endsWith('=') && !api.includes('<') && !path.startsWith('/v1/me') && !path.startsWith('/v1/mail') && !path.startsWith('/v1/bridges');
  return <View style={styles.row}>
    <View style={styles.rowTop}>
      <Text style={styles.method}>{method}</Text>
      {openable
        ? <Text accessibilityRole="link" onPress={() => { Linking.openURL(api + path).catch(() => undefined); }} style={[styles.path, styles.pathLink]}>{path}</Text>
        : <Text style={styles.path}>{path}</Text>}
    </View>
    <Text style={styles.description}>{description}</Text>
  </View>;
}

function Code({ lines, styles }: { lines: string[]; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.code}>{lines.map((line, index) => <Text key={index} selectable style={styles.codeLine}>{line}</Text>)}</View>;
}

function createStyles(colors: ThemeColors, medium: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { alignItems: 'center', paddingBottom: 32 },
    appBar: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '100%', maxWidth: 820, paddingHorizontal: 12, paddingTop: 8 },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    appTitle: { color: colors.text, fontSize: 26, fontWeight: '700' },
    page: { width: '100%', maxWidth: 820, paddingHorizontal: medium ? 32 : 20, paddingTop: medium ? 40 : 16 },
    kicker: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
    title: { fontFamily: 'serif', marginTop: 16, color: colors.text, fontSize: medium ? 48 : 36, lineHeight: medium ? 54 : 42, letterSpacing: -0.6 },
    lead: { marginTop: 18, color: colors.textSecondary, fontSize: 17, lineHeight: 28 },
    section: { marginTop: 48 },
    sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
    caption: { marginTop: 6, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
    sectionBody: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.text },
    row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    method: { minWidth: 56, color: colors.textTertiary, fontSize: 12, fontWeight: '600', fontFamily: mono },
    path: { color: colors.text, fontSize: 14, fontFamily: mono },
    pathLink: { textDecorationLine: 'underline' },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: colors.border, color: colors.textSecondary, fontSize: 11, fontWeight: '600', overflow: 'hidden' },
    description: { marginTop: 5, color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
    code: { marginTop: 16, padding: 18, borderRadius: 14, backgroundColor: '#0B0B0B' },
    codeLine: { color: '#F2F2EE', fontSize: 13, lineHeight: 21, fontFamily: mono },
    tokenCard: { marginTop: 16, padding: 18, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt, gap: 4 },
    tokenTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
    tokenButton: { marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.text },
    tokenButtonText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    hint: { marginTop: 8, color: colors.textTertiary, fontSize: 13, lineHeight: 19 },
    link: { color: colors.text, textDecorationLine: 'underline' },
  });
}

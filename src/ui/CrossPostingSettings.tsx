import { useEffect, useMemo, useState } from 'react';
import { useThemedStyles } from './useThemedStyles';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from './Text';

import { DestinationId, destinationNames } from '../domain/crossPosting';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { CrossPostNetworkState, useCrossPosting } from './useCrossPosting';
import { NetworkMark } from './NetworkMark';
import { Loader } from './Loader';
import { lazyComponent } from './lazyComponent';

// The QR encoder loads only when an approval code is on screen.
const QrGrid = lazyComponent(() => import('./QrGrid').then((module) => module.QrGrid), 'none');

/**
 * Settings → Cross-posting. Connect a network once; after that every Open Media post goes there
 * too, unless its “Include by default” switch is off. Disconnecting forgets this device’s key.
 */
export function CrossPostingSettings() {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const crossPosting = useCrossPosting();
  const { prepareConnect } = crossPosting;
  // Connect buttons are on screen: load what they need now, so a tap opens the network right away.
  const unconnected = crossPosting.loaded ? crossPosting.networks.filter((item) => !item.account && item.availability.available).map((item) => item.network).join(',') : '';
  useEffect(() => { for (const network of unconnected.split(',').filter(Boolean)) prepareConnect(network as DestinationId); }, [unconnected, prepareConnect]);
  const connected = crossPosting.networks.filter((item) => item.account);
  const ready = crossPosting.networks.filter((item) => !item.account && item.availability.available);
  const onDevice = crossPosting.networks.filter((item) => !item.account && !item.availability.available && item.availability.setup === 'device');
  const waiting = crossPosting.networks.filter((item) => !item.account && !item.availability.available && item.availability.setup !== 'device');
  const row = (item: CrossPostNetworkState) => {
    const name = destinationNames[item.network];
    const included = !crossPosting.preferences.excludedByDefault.includes(item.network);
    return <View key={item.network} style={styles.row}>
      <View style={styles.rowTop}>
        <NetworkMark id={item.network} name={name} />
        <View style={styles.copy}>
          <Text style={styles.name}>{name}</Text>
          <Text numberOfLines={3} style={styles.detail}>{item.account ? item.account.handle : !item.availability.available ? item.availability.reason : about[item.network] ?? 'Not connected'}</Text>
        </View>
        {item.busy ? <Loader color={colors.text} /> : item.account
          ? <Switch accessibilityLabel={`Include ${name} in every post by default`} value={included} onValueChange={(value) => crossPosting.setIncludedByDefault(item.network, value)} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} />
          : !item.availability.available ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Connect ${name}`} onPress={() => crossPosting.connect(item.network)} style={[styles.button, styles.primary]}><Text style={[styles.buttonText, styles.primaryText]}>Connect</Text></Pressable>}
      </View>
      {item.account ? <View style={styles.connectedLine}>
        <Text style={styles.hint}>{included ? 'Every post goes here too.' : 'Only when you pick it for a post.'} {item.revokeHint}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${name}`} onPress={() => crossPosting.disconnect(item.network)} hitSlop={8}><Text style={styles.disconnect}>Disconnect</Text></Pressable>
      </View> : null}
      {item.textRequest ? <TextRequestCard key={item.textRequest.title} request={item.textRequest} onSubmit={(value) => crossPosting.submitText(item.network, value)} onCancel={() => crossPosting.cancelConnect(item.network)} /> : null}
      {item.approval ? <View accessibilityLiveRegion="polite" style={styles.approval}>
        <Text style={styles.name}>{item.approval.title}</Text>
        <Text style={styles.detail}>{item.approval.message}</Text>
        {item.approval.qrCode ? <QrGrid value={item.approval.url} label={`QR code to approve Open Media in ${name}`} /> : null}
        <View style={styles.rowTop}>
          <Pressable accessibilityRole="link" onPress={() => { Linking.openURL(item.approval!.url).catch(() => undefined); }} style={[styles.button, styles.primary]}><Text style={[styles.buttonText, styles.primaryText]}>Open {name}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => crossPosting.cancelConnect(item.network)} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></Pressable>
        </View>
        <Text style={styles.hint}>Waiting for approval…</Text>
      </View> : null}
      {item.error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{item.error}</Text> : null}
    </View>;
  };
  return <View>
    <Text style={styles.intro}>Write once and it goes everywhere you connect. Open Media never asks for your main password, seed phrase or secret key: each network approves a separate key you can revoke there at any time.</Text>
    {connected.length ? <><Text style={styles.group}>Connected · {connected.length}</Text>{connected.map(row)}</> : null}
    {ready.length ? <><Text style={styles.group}>Ready to connect</Text>{ready.map(row)}</> : null}
    {onDevice.length ? <><Text style={styles.group}>Needs an app on this device</Text>{onDevice.map(row)}</> : null}
    {waiting.length ? <View style={styles.row}>
      <Text style={[styles.group, styles.groupInline]}>Coming soon</Text>
      <View style={styles.marks}>{waiting.map((item) => <View key={item.network} style={styles.markItem}><NetworkMark id={item.network} name={destinationNames[item.network]} size={32} muted /><Text numberOfLines={1} style={styles.markName}>{destinationNames[item.network]}</Text></View>)}</View>
      <Text style={styles.hint}>These networks only allow posting through an app they have approved or set up. Each one turns on here by itself as soon as Open Media’s app is ready, with nothing for you to do until then.</Text>
    </View> : null}
  </View>;
}

/** One line on what connecting asks for, so nobody is surprised by the next step. */
const about: Partial<Record<DestinationId, string>> = {
  bluesky: 'Connect with an app password',
  mastodon: 'Any server, like mastodon.social',
  nostr: 'Approve with your signer app or extension',
  farcaster: 'Approve in the Farcaster app',
  lens: 'Approve with your wallet',
  hive: 'Approve with Hive Keychain',
  deso: 'Approve with DeSo Identity',
  x: 'Sign in with X', threads: 'Sign in with Threads', linkedin: 'Sign in with LinkedIn', instagram: 'Professional accounts, video posts', facebook: 'Posts to a Page you manage',
};

function TextRequestCard({ request, onSubmit, onCancel }: { request: { title: string; message: string; placeholder: string; secret?: boolean }; onSubmit: (value: string) => void; onCancel: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const [value, setValue] = useState('');
  return <View style={styles.approval}>
    <Text style={styles.name}>{request.title}</Text>
    <Text style={styles.detail}>{request.message}</Text>
    <TextInput accessibilityLabel={request.title} secureTextEntry={request.secret} dictation={request.secret ? false : undefined} autoFocus autoCapitalize="none" autoCorrect={false} value={value} onChangeText={setValue} placeholder={request.placeholder} placeholderTextColor={colors.textTertiary} onSubmitEditing={() => value.trim() && onSubmit(value)} returnKeyType="go" style={styles.input} />
    <View style={styles.rowTop}>
      <Pressable accessibilityRole="button" disabled={!value.trim()} onPress={() => onSubmit(value)} style={[styles.button, styles.primary, !value.trim() && styles.disabled]}><Text style={[styles.buttonText, styles.primaryText]}>Continue</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></Pressable>
    </View>
  </View>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  row: { gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  group: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  groupInline: { paddingHorizontal: 0, paddingTop: 2, paddingBottom: 0 },
  connectedLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingLeft: 48 },
  disconnect: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  markItem: { width: 64, alignItems: 'center', gap: 6 },
  markName: { maxWidth: 64, color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  detail: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  hint: { flex: 1, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 16 },
  approval: { gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.chrome },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface, fontSize: 16, letterSpacing: 0, paddingVertical: 0, outlineStyle: 'none' } as object,
  disabled: { opacity: 0.4 },
  qr: { width: 200, height: 200, alignSelf: 'center', borderRadius: 8, backgroundColor: '#FFFFFF' },
  button: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  primary: { backgroundColor: colors.text, borderColor: colors.text },
  primaryText: { color: colors.surface },
}); }

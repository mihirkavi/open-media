import { Ionicons } from '@expo/vector-icons';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BridgeLoginStep,
  BridgeNetworkStatus,
  cancelBridgeLogin,
  continueBridgeLogin,
  BridgeLoginFlow,
  disconnectBridge,
  loadBridgeFlows,
  loadBridgeStatus,
  startBridgeLogin,
} from '../connectors/bridgesConnector';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';

/** Networks no bridge can reach; listed so the inbox is honest about what's missing. */
const unreachable = [
  { name: 'iMessage', reason: 'Needs a Mac relay for each person; not supported.' },
  { name: 'Snapchat', reason: 'No working bridge exists.' },
  { name: 'TikTok', reason: 'No working bridge exists.' },
];

const plannedBridges = ['WhatsApp', 'Telegram', 'Signal', 'Google Messages', 'Instagram', 'Messenger', 'LinkedIn', 'X', 'Bluesky', 'Slack', 'Discord'];

type Flow = { network: string; name: string; stage: 'consent' | 'working'; step?: BridgeLoginStep; values: Record<string, string>; done?: boolean; flows?: BridgeLoginFlow[] };

/**
 * Settings → Chat networks (ADR 0011). WhatsApp and other networks join Messages through Open
 * Media's chat bridges. Connecting is opt-in per network and starts with a plain warning, because
 * these bridges are not official and the bridge server can read bridged chats.
 */
export function BridgedChatsSettings() {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [statuses, setStatuses] = useState<BridgeNetworkStatus[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [flow, setFlow] = useState<Flow | null>(null);
  const [flowError, setFlowError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState<string>();
  const attempt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setStatuses(await loadBridgeStatus());
      setLoadError('');
    } catch (error) {
      setStatuses([]);
      setLoadError(error instanceof Error ? error.message : 'Could not load chat networks.');
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => () => { attempt.current += 1; }, []);

  // Follows the bridge's steps: waits on QR and pairing codes, stops for typed input.
  const follow = async (network: string, first: BridgeLoginStep, id: number) => {
    let step = first;
    while (attempt.current === id) {
      setFlow((current) => current && { ...current, step });
      if (step.type === 'complete') {
        setFlow((current) => current && { ...current, done: true });
        await refresh();
        return;
      }
      if (step.type !== 'display_and_wait') return;
      step = await continueBridgeLogin(network, step);
    }
  };

  const begin = async (method: string) => {
    if (!flow) return;
    const id = ++attempt.current;
    setFlowError('');
    setFlow({ ...flow, stage: 'working', step: undefined, values: {} });
    try {
      await follow(flow.network, await startBridgeLogin(flow.network, method), id);
    } catch (error) {
      if (attempt.current === id) setFlowError(error instanceof Error ? error.message : 'The connection didn’t finish. Try again.');
    }
  };

  const submitInput = async () => {
    if (!flow?.step) return;
    const id = ++attempt.current;
    setFlowError('');
    try {
      await follow(flow.network, await continueBridgeLogin(flow.network, flow.step, flow.values), id);
    } catch (error) {
      if (attempt.current === id) setFlowError(error instanceof Error ? error.message : 'Check the details and try again.');
    }
  };

  const close = () => {
    attempt.current += 1;
    if (flow?.step && !flow.done) cancelBridgeLogin(flow.network, flow.step.loginId);
    setFlow(null);
    setFlowError('');
  };

  const disconnect = async (network: string, loginId: string) => {
    setConfirmDisconnect(undefined);
    try {
      await disconnectBridge(network, loginId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not disconnect.');
    }
    await refresh();
  };

  const offered = (statuses ?? []).filter((status) => status.available);
  const offeredNames = new Set(offered.map((status) => status.name));
  const phone = Platform.OS !== 'web';

  return <View>
    <Text style={styles.intro}>WhatsApp and other chat apps can join Messages through Open Media’s chat bridges, the same way Beeper connects them. These bridges aren’t made or approved by those companies, so connecting is your choice, one network at a time.</Text>
    <View style={styles.card}>
      {statuses === null ? <ActivityIndicator style={styles.spinner} color={colors.text} /> : null}
      {offered.map((status, index) => {
        const connected = status.logins.length > 0;
        return <View key={status.id} style={[styles.row, index > 0 && styles.divider]}>
          <View style={styles.rowTop}>
            <View style={styles.copy}>
              <Text style={styles.name}>{status.name}</Text>
              <Text style={styles.detail}>{connected ? status.logins.map((login) => `Connected${login.name ? ` as ${login.name}` : ''}${login.state === 'CONNECTED' ? '' : ` · ${stateLabel(login.state)}`}`).join('\n') : 'Not connected'}</Text>
            </View>
            {connected
              ? confirmDisconnect === status.id
                ? <>
                  <Button label="Cancel" onPress={() => setConfirmDisconnect(undefined)} />
                  <Button label="Disconnect" danger onPress={() => disconnect(status.id, status.logins[0].id)} />
                </>
                : <Button label="Disconnect" onPress={() => setConfirmDisconnect(status.id)} />
              : <Button label="Connect" primary disabled={Boolean(flow)} onPress={() => {
                setFlowError('');
                setFlow({ network: status.id, name: status.name, stage: 'consent', values: {} });
                loadBridgeFlows(status.id).then((flows) => setFlow((current) => current?.network === status.id ? { ...current, flows } : current)).catch((error) => setFlowError(error instanceof Error ? error.message : 'Could not load sign-in options.'));
              }} />}
          </View>
          {confirmDisconnect === status.id ? <Text style={styles.hint}>Open Media removes the linked device and its copy of these chats. Your {status.name} account itself is not changed.</Text> : null}
          {flow?.network === status.id ? <FlowCard flow={flow} phone={phone} error={flowError} onBegin={begin} onClose={close} onSubmit={submitInput} onValues={(values) => setFlow({ ...flow, values })} /> : null}
        </View>;
      })}
      {plannedBridges.filter((name) => !offeredNames.has(name)).map((name, index) => (
        <View key={name} style={[styles.row, (offered.length > 0 || index > 0) && styles.divider]}>
          <View style={styles.rowTop}>
            <View style={styles.copy}><Text style={[styles.name, styles.muted]}>{name}</Text><Text style={styles.detail}>A bridge exists; it isn’t running on this server yet.</Text></View>
            <Text style={styles.badge}>Planned</Text>
          </View>
        </View>
      ))}
      {unreachable.map((network) => (
        <View key={network.name} style={[styles.row, styles.divider]}>
          <View style={styles.rowTop}>
            <View style={styles.copy}><Text style={[styles.name, styles.muted]}>{network.name}</Text><Text style={styles.detail}>{network.reason}</Text></View>
            <Text style={styles.badge}>Not available</Text>
          </View>
        </View>
      ))}
    </View>
    {loadError && statuses?.length === 0 ? <Text style={styles.hint}>{loadError.includes('set up') ? 'Chat bridges aren’t set up on this server yet.' : loadError}</Text> : null}
  </View>;
}

function FlowCard({ flow, phone, error, onBegin, onClose, onSubmit, onValues }: {
  flow: Flow;
  phone: boolean;
  error: string;
  onBegin: (method: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onValues: (values: Record<string, string>) => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const step = flow.step;

  if (flow.done) return <View accessibilityLiveRegion="polite" style={styles.flow}>
    <Text style={styles.name}>{flow.name} is connected</Text>
    <Text style={styles.detail}>Your chats appear in Messages within a minute or two. Recent messages come first.</Text>
    <View style={styles.rowTop}><Button label="Done" primary onPress={onClose} /></View>
  </View>;

  if (flow.stage === 'consent') return <View style={styles.flow}>
    <Text style={styles.name}>Before you connect {flow.name}</Text>
    <Text style={styles.detail}>• {flow.name} doesn’t officially support this. It may limit or ban accounts that use unofficial apps.</Text>
    <Text style={styles.detail}>• Open Media’s bridge server keeps your {flow.name} session and can read the chats it brings into Messages. These chats aren’t end-to-end encrypted inside Open Media.</Text>
    <Text style={styles.detail}>• You can disconnect any time, here or in {flow.name}’s linked devices.</Text>
    <View style={styles.rowWrap}>
      {flow.network === 'whatsapp' ? <>
        <Button label={phone ? 'Use a pairing code' : 'Scan a QR code'} primary onPress={() => onBegin(phone ? 'phone' : 'qr')} />
        <Button label={phone ? 'Scan a QR code instead' : 'Use a pairing code instead'} onPress={() => onBegin(phone ? 'qr' : 'phone')} />
      </> : flow.flows ? flow.flows.map((option, index) => <Button key={option.id} label={option.name || 'Continue'} primary={index === 0} onPress={() => onBegin(option.id)} />) : <ActivityIndicator color={colors.text} />}
      <Button label="Cancel" onPress={onClose} />
    </View>
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
  </View>;

  return <View accessibilityLiveRegion="polite" style={styles.flow}>
    {!step ? <ActivityIndicator color={colors.text} /> : null}
    {step?.type === 'display_and_wait' && step.display?.type === 'qr' && step.display.data ? <>
      <Text style={styles.name}>Scan with {flow.name}</Text>
      <Text style={styles.detail}>{flow.network === 'whatsapp' ? 'On your phone, open WhatsApp → Settings → Linked devices → Link a device, then point the camera at this code.' : step.instructions}</Text>
      <QrGrid value={step.display.data} />
      <Text style={styles.hint}>The code refreshes by itself. Waiting for you to scan…</Text>
    </> : null}
    {step?.type === 'display_and_wait' && step.display?.type === 'code' && step.display.data ? <>
      <Text style={styles.name}>Enter this code in {flow.name}</Text>
      <Text selectable accessibilityLabel={`Pairing code ${step.display.data.split('').join(' ')}`} style={styles.code}>{step.display.data}</Text>
      <Text style={styles.detail}>{flow.network === 'whatsapp' ? 'Open WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead, then type this code.' : step.instructions}</Text>
      <Text style={styles.hint}>Waiting for you to enter it…</Text>
    </> : null}
    {step?.type === 'user_input' ? <>
      <Text style={styles.name}>{step.instructions || `Connect ${flow.name}`}</Text>
      {flow.network === 'bluesky' ? <Text style={styles.hint}>Use an app password (Bluesky → Settings → Privacy and security → App passwords) and allow direct messages, rather than your main password.</Text> : null}
      {(step.fields ?? []).map((field, index) => <View key={field.id}>
        <Text style={styles.detail}>{field.name}{field.description ? ` · ${field.description}` : ''}</Text>
        <TextInput
          accessibilityLabel={field.name}
          autoFocus={index === 0}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={field.type === 'phone_number' ? 'phone-pad' : field.type === 'email' ? 'email-address' : 'default'}
          secureTextEntry={field.type === 'password'}
          placeholder={field.type === 'phone_number' ? '+1 555 123 4567' : ''}
          placeholderTextColor={colors.textTertiary}
          value={flow.values[field.id] ?? ''}
          onChangeText={(value) => onValues({ ...flow.values, [field.id]: value })}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          style={styles.input}
        />
      </View>)}
      <View style={styles.rowWrap}><Button label="Continue" primary onPress={onSubmit} /></View>
    </> : null}
    {step?.type === 'cookies' ? <>
      <Text style={styles.name}>Copy your {flow.name} sign-in</Text>
      <Text style={styles.detail}>{flow.name} signs in through its website, and Open Media can’t read another site’s sign-in for you. Sign in at the link below in a desktop browser, open its developer tools, and copy each value here:</Text>
      {(step.fields ?? []).some((field) => field.description?.startsWith('cookie')) ? <Text style={styles.detail}>• Cookies: Application (Storage in Firefox) → Cookies → the site → copy the value.</Text> : null}
      {(step.fields ?? []).some((field) => field.description === 'request header') ? <Text style={styles.detail}>• Request headers: Network → reload the page → click any request to the site → Request Headers → copy the value.</Text> : null}
      {(step.fields ?? []).some((field) => field.description === 'local storage') ? <Text style={styles.detail}>• Local storage: Application → Local Storage → the site → copy the value.</Text> : null}
      {step.url ? <Pressable accessibilityRole="link" onPress={() => { Linking.openURL(step.url!).catch(() => undefined); }}><Text style={styles.link}>{step.url}</Text></Pressable> : null}
      {(step.fields ?? []).map((field) => <View key={field.id}>
        <Text style={styles.detail}>{field.name}{field.description ? ` · ${field.description}` : ''}</Text>
        <TextInput
          accessibilityLabel={field.name}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={flow.values[field.id] ?? ''}
          onChangeText={(value) => onValues({ ...flow.values, [field.id]: value })}
          style={styles.input}
        />
      </View>)}
      <View style={styles.rowWrap}><Button label="Connect" primary onPress={onSubmit} /></View>
      <Text style={styles.hint}>These values let the bridge act as you on {flow.name}. They go only to Open Media’s bridge server, and disconnecting removes them.</Text>
    </> : null}
    {step?.type === 'unsupported' ? <Text style={styles.detail}>{step.instructions}</Text> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    <View style={styles.rowWrap}>
      {error && flow.network === 'whatsapp' ? <Button label="Try again" primary onPress={() => onBegin(phone ? 'phone' : 'qr')} /> : null}
      <Button label="Cancel" onPress={onClose} />
    </View>
  </View>;
}

/** A QR code drawn with plain views, so it renders the same on web, iOS and Android. */
function QrGrid({ value }: { value: string }) {
  const rows = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const out: { start: number; length: number }[][] = [];
    for (let row = 0; row < modules.size; row += 1) {
      const runs: { start: number; length: number }[] = [];
      for (let column = 0; column < modules.size; column += 1) {
        if (!modules.get(row, column)) continue;
        const last = runs[runs.length - 1];
        if (last && last.start + last.length === column) last.length += 1;
        else runs.push({ start: column, length: 1 });
      }
      out.push(runs);
    }
    return out;
  }, [value]);
  const cell = Math.floor(216 / rows.length);
  const size = cell * rows.length;
  return <View accessibilityRole="image" accessibilityLabel="QR code to link this account" style={{ alignSelf: 'center', padding: cell * 3, backgroundColor: '#FFFFFF', borderRadius: 8 }}>
    <View style={{ width: size, height: size }}>
      {rows.map((runs, row) => runs.map((run) => <View key={`${row}-${run.start}`} style={{ position: 'absolute', top: row * cell, left: run.start * cell, width: run.length * cell, height: cell, backgroundColor: '#000000' }} />))}
    </View>
  </View>;
}

function Button({ label, onPress, primary, danger, disabled }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, primary && styles.primaryText, danger && styles.danger]}>{label}</Text>
  </Pressable>;
}

function stateLabel(state: string): string {
  if (state === 'BAD_CREDENTIALS') return 'signed out, connect again';
  if (state === 'CONNECTING' || state === 'TRANSIENT_DISCONNECT') return 'reconnecting';
  return 'needs attention';
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  intro: { paddingTop: 6, paddingBottom: 10, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  spinner: { padding: 16 },
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  muted: { color: colors.textSecondary },
  detail: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 16, paddingTop: 6 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  badge: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  flow: { gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.chrome },
  code: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: 4, textAlign: 'center', paddingVertical: 6 },
  input: { minHeight: 44, marginTop: 6, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface, fontSize: 16, paddingVertical: 0, outlineStyle: 'none' } as object,
  button: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  primary: { backgroundColor: colors.text, borderColor: colors.text },
  primaryText: { color: colors.surface },
  danger: { color: colors.danger },
  link: { color: colors.text, fontSize: 13, textDecorationLine: 'underline' },
  disabled: { opacity: 0.4 },
}); }

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { publishingConnector } from '../data/crossPostService';
import { networks } from '../domain/networkPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { useCrossPosting } from './useCrossPosting';

/**
 * Settings → Cross-posting. Connect a network once; after that every Open Media post goes there
 * too, unless its “Include by default” switch is off. Disconnecting forgets this device’s key.
 */
export function CrossPostingSettings() {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const crossPosting = useCrossPosting();
  return <View>
    <Text style={styles.intro}>Every Open Media post also goes to each network you connect here. Open Media never asks for your seed phrase or main keys: each network approves a separate key you can revoke there at any time.</Text>
    {crossPosting.networks.map((item) => {
      const name = networks[item.network].displayName;
      const included = !crossPosting.preferences.excludedByDefault.includes(item.network);
      return <View key={item.network} style={styles.row}>
        <View style={styles.rowTop}>
          <View style={styles.copy}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.detail}>{item.account ? `Connected as ${item.account.handle}` : item.availability.available ? 'Not connected' : item.availability.reason}</Text>
          </View>
          {item.busy ? <ActivityIndicator color={colors.text} /> : item.account
            ? <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${name}`} onPress={() => crossPosting.disconnect(item.network)} style={styles.button}><Text style={styles.buttonText}>Disconnect</Text></Pressable>
            : item.availability.available ? <Pressable accessibilityRole="button" accessibilityLabel={`Connect ${name}`} onPress={() => crossPosting.connect(item.network)} style={[styles.button, styles.primary]}><Text style={[styles.buttonText, styles.primaryText]}>Connect</Text></Pressable> : <Ionicons name="time-outline" size={18} color={colors.textTertiary} />}
        </View>
        {item.account ? <View style={styles.rowTop}>
          <Text style={[styles.detail, styles.copy]}>Include in every post by default</Text>
          <Switch accessibilityLabel={`Include ${name} in every post by default`} value={included} onValueChange={(value) => crossPosting.setIncludedByDefault(item.network, value)} />
        </View> : null}
        {item.account ? <Text style={styles.hint}>{publishingConnector(item.network).revokeHint}</Text> : null}
        {item.textRequest ? <TextRequestCard request={item.textRequest} onSubmit={(value) => crossPosting.submitText(item.network, value)} onCancel={() => crossPosting.cancelConnect(item.network)} /> : null}
        {item.approval ? <View accessibilityLiveRegion="polite" style={styles.approval}>
          <Text style={styles.name}>{item.approval.title}</Text>
          <Text style={styles.detail}>{item.approval.message}</Text>
          {item.approval.qrCode ? <Image accessibilityLabel={`QR code to approve Open Media in ${name}`} source={{ uri: item.approval.qrCode }} style={styles.qr} /> : null}
          <View style={styles.rowTop}>
            <Pressable accessibilityRole="link" onPress={() => { Linking.openURL(item.approval!.url).catch(() => undefined); }} style={[styles.button, styles.primary]}><Text style={[styles.buttonText, styles.primaryText]}>Open {name}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => crossPosting.cancelConnect(item.network)} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></Pressable>
          </View>
          <Text style={styles.hint}>Waiting for approval…</Text>
        </View> : null}
        {item.error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{item.error}</Text> : null}
      </View>;
    })}
  </View>;
}

function TextRequestCard({ request, onSubmit, onCancel }: { request: { title: string; message: string; placeholder: string }; onSubmit: (value: string) => void; onCancel: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [value, setValue] = useState('');
  return <View style={styles.approval}>
    <Text style={styles.name}>{request.title}</Text>
    <Text style={styles.detail}>{request.message}</Text>
    <TextInput accessibilityLabel={request.title} autoFocus autoCapitalize="none" autoCorrect={false} value={value} onChangeText={setValue} placeholder={request.placeholder} placeholderTextColor={colors.textTertiary} onSubmitEditing={() => value.trim() && onSubmit(value)} returnKeyType="go" style={styles.input} />
    <View style={styles.rowTop}>
      <Pressable accessibilityRole="button" disabled={!value.trim()} onPress={() => onSubmit(value)} style={[styles.button, styles.primary, !value.trim() && styles.disabled]}><Text style={[styles.buttonText, styles.primaryText]}>Continue</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></Pressable>
    </View>
  </View>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  detail: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
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

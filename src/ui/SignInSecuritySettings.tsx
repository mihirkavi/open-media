import Ionicons from './Icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { getSupabaseClient } from '../auth/supabase';
import { PasskeysSwitchedOff, addPasskey, hasPassword, listPasskeys, Passkey, passkeysSupportedHere, removePasskey, setPassword } from '../auth/accountSecurity';
import { passwordProblem } from '../domain/passwordRules';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Loader } from './Loader';
import { Text, TextInput } from './Text';

/**
 * Sign-in and security on your own profile (ADR 0034): a password, so you can sign in anywhere
 * without an email code, and passkeys as an optional second step after it.
 */
export function SignInSecuritySettings() {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [passkeys, setPasskeys] = useState<Passkey[]>();
  const [editingPassword, setEditingPassword] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const [switchedOff, setSwitchedOff] = useState(false);
  const supported = passkeysSupportedHere() && !switchedOff;
  const [email, setEmail] = useState<string>();
  useEffect(() => { getSupabaseClient()?.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? undefined)).catch(() => undefined); }, []);
  const problem = passwordProblem(password, email);

  // Unknown until checked; the button says "Set password" or "Change password" accordingly.
  const [passwordSet, setPasswordSet] = useState<boolean>();
  useEffect(() => { hasPassword().then(setPasswordSet).catch(() => undefined); }, []);
  const refresh = useCallback(async () => setPasskeys(await listPasskeys()), []);
  useEffect(() => { refresh().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load your passkeys.')); }, [refresh]);

  const run = async (label: string, action: () => Promise<void>, done: string) => {
    setBusy(label); setError(''); setMessage('');
    try { await action(); setMessage(done); }
    catch (reason) {
      // The server has passkeys off: say so once and stop offering the button, instead of an error.
      if (reason instanceof PasskeysSwitchedOff) { setSwitchedOff(true); return; }
      setError(reason instanceof Error ? reason.message : 'That didn’t work. Try again.');
    }
    finally { setBusy(''); }
  };
  const savePassword = () => run('password', async () => { await setPassword(password, email); setPasswordValue(''); setEditingPassword(false); setPasswordSet(true); }, passwordSet ? 'Password changed. Use the new one next time you sign in.' : 'Password saved. You can now sign in with your email and password.');
  const add = () => run('add', async () => { await addPasskey(deviceName()); await refresh(); }, 'Passkey added. From now on, signing in asks for it after your password or email code.');
  const remove = (passkey: Passkey) => run(`remove-${passkey.id}`, async () => { await removePasskey(passkey.id); setConfirmRemove(undefined); await refresh(); }, `Removed “${passkey.name}”.`);

  return <>
    <Text style={styles.title}>Sign-in and security</Text>
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="key-outline" size={20} color={colors.text} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>Password</Text>
          <Text style={styles.hint}>{passwordSet ? `You can sign in on any device with ${email ?? 'your email'} and your password.` : `Sign in on any device with ${email ?? 'your email'} and a password, instead of waiting for an email code.`}</Text>
        </View>
        {editingPassword ? null : <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => { setError(''); setMessage(''); setEditingPassword(true); }} style={styles.small}><Text style={styles.smallText}>{passwordSet ? 'Change password' : 'Set password'}</Text></Pressable>}
      </View>
      {editingPassword ? <View style={styles.block}>
        <TextInput accessibilityLabel="New password" secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" value={password} onChangeText={setPasswordValue} onSubmitEditing={!problem && !busy ? savePassword : undefined} placeholder={passwordSet ? 'New password' : 'Password (at least 8 characters)'} placeholderTextColor={colors.textTertiary} style={styles.input} />
        {password && problem ? <Text style={styles.hint}>{problem}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={Boolean(busy) || Boolean(problem)} onPress={savePassword} style={[styles.small, styles.smallOn, (Boolean(busy) || Boolean(problem)) && styles.disabled]}>{busy === 'password' ? <Loader color={colors.surface} /> : <Text style={styles.smallTextOn}>{passwordSet ? 'Save new password' : 'Save password'}</Text>}</Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => { setEditingPassword(false); setPasswordValue(''); }} style={styles.small}><Text style={styles.smallText}>Cancel</Text></Pressable>
        </View>
      </View> : null}

      <View style={[styles.row, styles.divider]}>
        <Ionicons name="finger-print-outline" size={20} color={colors.text} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>Passkeys</Text>
          <Text style={styles.hint}>{passkeys?.length
            ? 'Signing in asks for a passkey after your password or email code, so a stolen password alone can’t get in.'
            : 'Add a second step: after your password or email code, confirm with Touch ID, Face ID, Windows Hello, your phone or a security key.'}</Text>
          {switchedOff ? <Text style={styles.hint}>Passkeys aren’t switched on for Open Media yet. Your password and email codes work as usual.</Text>
            : !supported ? <Text style={styles.hint}>Add passkeys from Open Media on the web. The phone app gets passkeys next.</Text> : null}
        </View>
        {supported ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={add} style={styles.small}>{busy === 'add' ? <Loader color={colors.text} /> : <Text style={styles.smallText}>Add passkey</Text>}</Pressable> : null}
      </View>
      {passkeys === undefined && !error ? <Loader style={styles.loading} color={colors.text} /> : null}
      {passkeys?.map((passkey) => <View key={passkey.id} style={[styles.row, styles.divider]}>
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>{passkey.name}</Text>
          <Text style={styles.hint}>Added {new Date(passkey.addedAt).toLocaleDateString()}</Text>
        </View>
        {confirmRemove === passkey.id
          ? <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Confirm removing ${passkey.name}`} disabled={Boolean(busy)} onPress={() => remove(passkey)} style={[styles.small, styles.danger]}>{busy === `remove-${passkey.id}` ? <Loader color={colors.surface} /> : <Text style={styles.smallTextOn}>Remove</Text>}</Pressable>
            <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => setConfirmRemove(undefined)} style={styles.small}><Text style={styles.smallText}>Keep</Text></Pressable>
          </>
          : <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${passkey.name}`} disabled={Boolean(busy)} onPress={() => setConfirmRemove(passkey.id)} style={styles.small}><Text style={styles.smallText}>Remove</Text></Pressable>}
      </View>)}
    </View>
    {confirmRemove && passkeys?.length === 1 ? <Text style={styles.hint}>This is your only passkey. Removing it turns the passkey step off.</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
  </>;
}

/** A recognisable default name for a new passkey, from the browser. */
function deviceName(): string {
  if (typeof navigator === 'undefined') return 'Passkey';
  const agent = navigator.userAgent;
  const device = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Mac/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : 'This device';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  return browser ? `${device} · ${browser}` : device;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    title: { marginTop: 28, marginBottom: 10, color: colors.text, fontSize: 16, fontWeight: '700' },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    loading: { padding: 16 },
    block: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    row: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
    grow: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    input: { minHeight: 46, paddingHorizontal: 14, color: colors.text, fontSize: 15, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, outlineStyle: 'none' } as object,
    actions: { flexDirection: 'row', gap: 8 },
    small: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border },
    smallOn: { backgroundColor: colors.text, borderColor: colors.text },
    danger: { backgroundColor: colors.danger, borderColor: colors.danger },
    disabled: { opacity: 0.4 },
    smallText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    smallTextOn: { color: colors.surface, fontSize: 13, fontWeight: '600' },
    success: { marginTop: 8, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { marginTop: 8, color: colors.danger, fontSize: 12, lineHeight: 18 },
  });
}

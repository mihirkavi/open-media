import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { loadPublicPerson, PublicPerson, saveLinkedAccounts } from '../data/peopleService';
import { NetworkId, networks } from '../domain/networkPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { usePeople } from './people';
import { Text, TextInput } from './Text';

type LinkedAccount = PublicPerson['linkedAccounts'][number];
const handlePattern = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The people parts of your own profile (ADR 0013): your accounts on open networks, which you
 * choose to show publicly so others see one timeline, and your private, encrypted address book.
 */
export function PeopleSettings({ handle }: { handle: string }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const people = usePeople();
  const contacts = people?.contacts;
  const [accounts, setAccounts] = useState<LinkedAccount[]>();
  const [network, setNetwork] = useState<NetworkId>('farcaster');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadPublicPerson(handle).then((person) => setAccounts(person?.linkedAccounts ?? [])).catch(() => setAccounts([]));
  }, [handle]);

  const saveAccounts = async (next: LinkedAccount[]) => {
    setBusy('accounts'); setMessage('');
    try { await saveLinkedAccounts(next); setAccounts(next); setDraft(''); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not save your accounts.'); }
    finally { setBusy(''); }
  };
  const add = () => {
    const value = draft.trim().replace(/^@/, '');
    if (!handlePattern.test(value)) { setMessage('Use letters, numbers, dots, dashes or underscores.'); return; }
    if ((accounts ?? []).some((item) => item.network === network && item.handle.toLowerCase() === value.toLowerCase())) { setDraft(''); return; }
    if ((accounts ?? []).length >= 8) { setMessage('You can show up to 8 accounts.'); return; }
    saveAccounts([...(accounts ?? []), { network, handle: value }]);
  };
  const importContacts = async () => {
    if (!contacts) return;
    setBusy('contacts'); setMessage('');
    try { const count = await contacts.importFromDevice(); setMessage(`Imported ${count} ${count === 1 ? 'contact' : 'contacts'}.`); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not import your contacts.'); }
    finally { setBusy(''); }
  };

  return <>
    <Pressable accessibilityRole="link" onPress={() => people?.open({ ref: { kind: 'open_media', handle } })} style={[styles.action, styles.spaced]}>
      <Ionicons name="person-circle-outline" size={20} color={colors.text} />
      <Text style={styles.actionText}>View my public profile</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>

    <Text style={styles.title}>Your accounts elsewhere</Text>
    <Text style={styles.copy}>Shown on your public profile, so people see your posts from these networks in one timeline. Anyone can see this list.</Text>
    <View style={styles.card}>
      {accounts === undefined ? <ActivityIndicator style={styles.loading} color={colors.text} /> : accounts.map((account) => (
        <View key={`${account.network}:${account.handle}`} style={[styles.row, styles.divider]}>
          <Text style={styles.rowText}>@{account.handle}<Text style={styles.rowMeta}> on {networks[account.network]?.displayName ?? account.network}</Text></Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove @${account.handle}`} disabled={Boolean(busy)} onPress={() => saveAccounts(accounts.filter((item) => item !== account))} style={styles.small}><Text style={styles.smallText}>Remove</Text></Pressable>
        </View>
      ))}
      <View style={styles.adder}>
        <View style={styles.chips}>
          {(Object.keys(networks) as NetworkId[]).map((id) => (
            <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: network === id }} onPress={() => setNetwork(id)} style={[styles.chip, network === id && styles.chipOn]}>
              <Text style={[styles.chipText, network === id && styles.chipTextOn]}>{networks[id].displayName}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel={`Your ${networks[network].displayName} username`} value={draft} onChangeText={setDraft} onSubmitEditing={add} autoCapitalize="none" autoCorrect={false} placeholder="username" placeholderTextColor={colors.textTertiary} style={styles.input} />
          <Pressable accessibilityRole="button" disabled={!draft.trim() || Boolean(busy)} onPress={add} style={[styles.add, (!draft.trim() || busy) && styles.disabled]}>
            {busy === 'accounts' ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.addText}>Add</Text>}
          </Pressable>
        </View>
      </View>
    </View>

    {contacts ? <>
      <Text style={styles.title}>Your contacts</Text>
      <Text style={styles.copy}>Only you can see your contacts. They are encrypted on the server and used to recognise people you already know. Links to accounts are made only on an exact email or phone match, and you can undo any of them from the person’s profile.</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.text} />
          <Text style={[styles.rowText, styles.grow]}>{contacts.ready ? `${contacts.cards.length} saved ${contacts.cards.length === 1 ? 'contact' : 'contacts'}` : 'Loading…'}{contacts.suggestions.length ? <Text style={styles.rowMeta}> · {contacts.suggestions.length} to review</Text> : null}</Text>
          {Platform.OS !== 'web' ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={importContacts} style={styles.small}>
            {busy === 'contacts' ? <ActivityIndicator color={colors.text} /> : <Text style={styles.smallText}>Import from this device</Text>}
          </Pressable> : null}
        </View>
      </View>
      {Platform.OS === 'web' ? <Text style={styles.note}>Import contacts from the iPhone or Android app. You can also add someone from their profile.</Text> : null}
      {contacts.error ? <Text accessibilityRole="alert" style={styles.error}>{contacts.error}</Text> : null}
    </> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text> : null}
  </>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    spaced: { marginTop: 10 },
    action: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
    actionText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
    title: { marginTop: 28, color: colors.text, fontSize: 16, fontWeight: '700' },
    copy: { marginTop: 4, marginBottom: 10, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    loading: { padding: 16 },
    row: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
    grow: { flex: 1 },
    rowText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
    rowMeta: { color: colors.textTertiary, fontWeight: '400' },
    small: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border },
    smallText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    adder: { padding: 12, gap: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 16, backgroundColor: colors.chrome },
    chipOn: { backgroundColor: colors.text },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '500' },
    chipTextOn: { color: colors.surface },
    inputRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, minHeight: 42, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object,
    add: { minWidth: 64, minHeight: 42, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.text },
    addText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    disabled: { opacity: 0.4 },
    note: { marginTop: 8, color: colors.textTertiary, fontSize: 12, lineHeight: 18 },
    error: { marginTop: 8, color: colors.danger, fontSize: 12, lineHeight: 18 },
  });
}

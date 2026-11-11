import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Loader } from './Loader';

import { loadPublicPerson, PublicPerson, saveLinkedAccounts } from '../data/peopleService';
import { NetworkId, networks } from '../domain/networkPosts';
import { contactName } from '../domain/people';
import { initialsFor } from '../domain/publicPosts';
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
export function PeopleSettings({ handle, onOpenContacts }: { handle: string; onOpenContacts?: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const people = usePeople();
  const contacts = people?.contacts;
  const [accounts, setAccounts] = useState<LinkedAccount[]>();
  const [network, setNetwork] = useState<NetworkId>('farcaster');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const others = useMemo(() => (contacts?.cards ?? []).filter((card) => !card.self), [contacts?.cards]);

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

  return <>
    <Pressable accessibilityRole="link" onPress={() => people?.open({ ref: { kind: 'open_media', handle } })} style={[styles.action, styles.spaced]}>
      <Ionicons name="person-circle-outline" size={20} color={colors.text} />
      <Text style={styles.actionText}>View my public profile</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>

    <Text style={styles.title}>Your accounts elsewhere</Text>
    <Text style={styles.copy}>Shown on your public profile, so people see your posts from these networks in one timeline. Anyone can see this list.</Text>
    <View style={styles.card}>
      {accounts === undefined ? <Loader style={styles.loading} color={colors.text} /> : accounts.map((account) => (
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
            {busy === 'accounts' ? <Loader color={colors.surface} /> : <Text style={styles.addText}>Add</Text>}
          </Pressable>
        </View>
      </View>
    </View>

    {contacts ? <>
      <Text style={styles.title}>Contacts</Text>
      <Text style={styles.copy}>Only you can see your contacts. A saved name shows everywhere, and every chat and email from one person becomes one conversation.</Text>
      <Pressable accessibilityRole="link" accessibilityLabel={`Contacts, ${others.length} saved`} onPress={onOpenContacts} style={({ pressed }) => [styles.contactsLink, pressed && styles.pressed]}>
        <View style={styles.faces}>
          {(others.length ? others.slice(0, 3) : [undefined]).map((card, index) => <View key={card?.id ?? 'none'} style={[styles.face, index > 0 && styles.faceOverlap]}>
            {card ? <Text style={styles.faceText}>{initialsFor(contactName(card) || card.emails[0] || '?')}</Text> : <Ionicons name="people-outline" size={16} color={colors.text} />}
          </View>)}
        </View>
        <View style={styles.grow}>
          <Text style={styles.contactsTitle}>{contacts.ready ? (others.length ? `${others.length.toLocaleString()} ${others.length === 1 ? 'contact' : 'contacts'}` : 'Add your contacts') : 'Loading…'}</Text>
          <Text numberOfLines={1} style={styles.rowMeta}>{contacts.suggestions.length ? `${contacts.suggestions.length} to review · ` : ''}Add, import and export</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>
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
    contactRow: { minHeight: 60, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    pressed: { opacity: 0.6 },
    initials: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
    meInitials: { backgroundColor: colors.text },
    meInitialsText: { color: colors.surface },
    initialsText: { color: colors.text, fontSize: 12, fontWeight: '700' },
    contactName: { color: colors.text, fontSize: 15, fontWeight: '600' },
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
    contactsLink: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.surfaceAlt },
    faces: { flexDirection: 'row' },
    face: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome, borderWidth: 2, borderColor: colors.surfaceAlt },
    faceOverlap: { marginLeft: -12 },
    faceText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    contactsTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  });
}

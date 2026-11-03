import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Loader } from './Loader';

import { loadPublicPerson, PublicPerson, saveLinkedAccounts } from '../data/peopleService';
import { NetworkId, networks } from '../domain/networkPosts';
import { ContactCard, handleRef, IdentityRef } from '../domain/people';
import { initialsFor } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { ContactImport } from './ContactImport';
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
  const [showContacts, setShowContacts] = useState(false);
  const sortedContacts = useMemo(() => [...(contacts?.cards ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [contacts?.cards]);

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
      <Text style={styles.title}>Your contacts</Text>
      <Text style={styles.copy}>Only you can see your contacts. They are encrypted on the server and used to recognise people you already know: a saved name shows everywhere, and chats and email from any of a contact’s addresses, numbers or handles share one conversation. Open someone to edit them.</Text>
      <View style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showContacts }} disabled={!contacts.cards.length} onPress={() => setShowContacts((value) => !value)} style={styles.row}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.text} />
          <Text style={[styles.rowText, styles.grow]}>{contacts.ready ? `${contacts.cards.length} saved ${contacts.cards.length === 1 ? 'contact' : 'contacts'}` : 'Loading…'}{contacts.suggestions.length ? <Text style={styles.rowMeta}> · {contacts.suggestions.length} to review</Text> : null}</Text>
          {contacts.cards.length ? <Ionicons name={showContacts ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} /> : null}
        </Pressable>
        {showContacts ? sortedContacts.map((card) => <ContactRow key={card.id} card={card} onOpen={(target) => people?.open(target)} styles={styles} colors={colors} />) : null}
        <ContactImport contacts={contacts} />
      </View>
      {contacts.error ? <Text accessibilityRole="alert" style={styles.error}>{contacts.error}</Text> : null}
    </> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text> : null}
  </>;
}

/** Where tapping a contact goes: their Open Media profile when linked, else their email or phone. */
function contactTarget(card: ContactCard): { ref: IdentityRef; name: string } | undefined {
  const linked = card.links.find((link) => link.ref.kind === 'open_media') ?? card.links[0];
  const handle = card.handles?.find((item) => item.handle.trim());
  const ref: IdentityRef | undefined = linked?.ref ?? (card.emails[0] ? { kind: 'email', address: card.emails[0] } : card.phones[0] ? { kind: 'phone', number: card.phones[0] } : handle ? handleRef(handle) : undefined);
  return ref ? { ref, name: card.name } : undefined;
}

function ContactRow({ card, onOpen, styles, colors }: { card: ContactCard; onOpen: (target: { ref: IdentityRef; name: string }) => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  const target = contactTarget(card);
  const onOpenMedia = card.links.some((link) => link.ref.kind === 'open_media');
  const detail = [card.emails[0], card.phones[0]].filter(Boolean).join(' · ');
  return <Pressable accessibilityRole={target ? 'link' : undefined} disabled={!target} onPress={() => target && onOpen(target)} style={({ pressed }) => [styles.row, styles.contactRow, pressed && styles.pressed]}>
    <View style={styles.initials}><Text style={styles.initialsText}>{initialsFor(card.name || detail || '?')}</Text></View>
    <View style={styles.grow}>
      <Text numberOfLines={1} style={styles.contactName}>{card.name || detail}</Text>
      {detail || onOpenMedia ? <Text numberOfLines={1} style={styles.rowMeta}>{[onOpenMedia ? 'On Open Media' : '', card.name ? detail : ''].filter(Boolean).join(' · ')}</Text> : null}
    </View>
    {target ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
  </Pressable>;
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
  });
}

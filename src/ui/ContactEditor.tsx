import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Loader } from './Loader';

import { applyDraft, ContactDraft, draftOf, draftProblems, sharedWith } from '../domain/contactMerge';
import { networks } from '../domain/networkPosts';
import { ContactCard, contactName, HandleNetwork, phoneNetworks, selfLabel } from '../domain/people';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { sourceLabel } from './SourceMarker';
import { contactsRadius, contactsSpace, contactsType, touch } from './contactsDesign';
import { Text, TextInput } from './Text';

/**
 * Editing a contact (ADR 0023; Apple-style since ADR 0036), inside the person's profile: Cancel and
 * Done at the top, the name, then every way to reach them, each with a red remove control and green
 * "add" rows below, notes, and Delete Contact last (undoable, so it asks nothing).
 */

type Kind = 'email' | 'phone' | HandleNetwork;
interface Entry { id: number; kind: Kind; value: string }

const common: Kind[] = ['email', 'phone', 'whatsapp', 'telegram', 'signal', 'open_media', 'farcaster', 'lens'];
const more: Kind[] = ['hive', 'deso', 'gmessages', 'gvoice', 'instagram', 'messenger', 'linkedin', 'twitter', 'bluesky', 'slack', 'discord'];

export function kindLabel(kind: Kind): string {
  if (kind === 'email') return 'Email';
  if (kind === 'phone') return 'Phone';
  if (kind in networks) return networks[kind as keyof typeof networks].displayName;
  return sourceLabel(kind as Exclude<HandleNetwork, keyof typeof networks>);
}

function placeholder(kind: Kind): string {
  if (kind === 'email') return 'name@example.com';
  if (kind === 'phone' || phoneNetworks.has(kind as HandleNetwork)) return '+1 555 000 1234';
  return '@handle';
}

function entriesOf(draft: ContactDraft): Entry[] {
  let id = 0;
  return [
    ...draft.phones.map((value) => ({ id: id++, kind: 'phone' as Kind, value })),
    ...draft.emails.map((value) => ({ id: id++, kind: 'email' as Kind, value })),
    ...draft.handles.map((item) => ({ id: id++, kind: item.network as Kind, value: item.handle })),
  ];
}

function draftFrom(name: string, notes: string, entries: Entry[]): ContactDraft {
  return {
    name,
    notes,
    emails: entries.filter((entry) => entry.kind === 'email').map((entry) => entry.value),
    phones: entries.filter((entry) => entry.kind === 'phone').map((entry) => entry.value),
    handles: entries.filter((entry) => entry.kind !== 'email' && entry.kind !== 'phone').map((entry) => ({ network: entry.kind as HandleNetwork, handle: entry.value })),
  };
}

export function ContactEditor({ card, cards, selfName, onSave, onCancel, onDelete }: { card: ContactCard; cards: ContactCard[]; /** Set for the viewer's own card: its name comes from their profile. */ selfName?: string; onSave: (card: ContactCard) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void> }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const initial = useMemo(() => draftOf(card), [card]);
  const [name, setName] = useState(selfName ?? initial.name);
  const [notes, setNotes] = useState(initial.notes);
  const [entries, setEntries] = useState<Entry[]>(() => entriesOf(initial));
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focusId, setFocusId] = useState<number>();
  const nextId = useRef(entries.length);

  const draft = draftFrom(name, notes, entries);
  const problems = draftProblems(draft);
  const shared = sharedWith(cards, card.id, draft);
  const add = (kind: Kind) => {
    const id = nextId.current++;
    setEntries((current) => [...current, { id, kind, value: '' }]);
    setFocusId(id);
  };
  const save = async () => {
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);
    setError('');
    try { await onSave(applyDraft(card, draft)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the contact.'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    try { await onDelete(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete the contact.'); setBusy(false); }
  };

  const groups: Kind[] = ['phone', 'email'];
  const accountKinds = [...common, ...more].filter((kind) => kind !== 'email' && kind !== 'phone');

  return <View style={styles.editor}>
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} hitSlop={8} style={styles.barButton}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      <Text accessibilityRole="header" style={styles.barTitle}>{selfName !== undefined ? 'My card' : contactName(card) ? 'Edit contact' : 'New contact'}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} hitSlop={8} style={styles.barButton}>{busy ? <Loader color={colors.text} /> : <Text style={styles.doneText}>Done</Text>}</Pressable>
    </View>

    <View style={styles.group}>
      {selfName !== undefined ? <View style={styles.selfRow}>
        <Text style={styles.selfName}>{selfLabel(selfName)}</Text>
        <Text style={styles.hint}>Your name comes from your profile. Everything here stays private to you.</Text>
      </View> : <TextInput
        accessibilityLabel="Name"
        autoFocus={!contactName(card)}
        value={name}
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={colors.textTertiary}
        style={styles.name}
      />}
    </View>

    <View style={styles.group}>
      {entries.map((entry, index) => <View key={entry.id} style={[styles.entry, index > 0 && styles.divider]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${kindLabel(entry.kind)} ${entry.value}`.trim()} onPress={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} hitSlop={10} style={styles.remove}>
          <Ionicons name="remove-circle" size={22} color={colors.danger} />
        </Pressable>
        <Text numberOfLines={1} style={styles.entryKind}>{kindLabel(entry.kind)}</Text>
        <TextInput
          accessibilityLabel={kindLabel(entry.kind)}
          autoFocus={entry.id === focusId}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={entry.kind === 'email' ? 'email-address' : entry.kind === 'phone' || phoneNetworks.has(entry.kind as HandleNetwork) ? 'phone-pad' : 'default'}
          value={entry.value}
          onChangeText={(value) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, value } : item))}
          placeholder={placeholder(entry.kind)}
          placeholderTextColor={colors.textTertiary}
          style={styles.entryInput}
        />
      </View>)}
      {groups.map((kind, index) => <Pressable key={kind} accessibilityRole="button" onPress={() => add(kind)} style={({ pressed }) => [styles.addRow, (entries.length > 0 || index > 0) && styles.divider, pressed && styles.pressed]}>
        <Ionicons name="add-circle" size={22} color={colors.success} />
        <Text style={styles.addText}>add {kindLabel(kind).toLowerCase()}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showMore }} onPress={() => setShowMore(!showMore)} style={({ pressed }) => [styles.addRow, styles.divider, pressed && styles.pressed]}>
        <Ionicons name="add-circle" size={22} color={colors.success} />
        <Text style={[styles.addText, styles.grow]}>add account</Text>
        <Ionicons name={showMore ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
      </Pressable>
      {showMore ? <View style={styles.accounts}>
        {accountKinds.map((kind) => <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`Add ${kindLabel(kind)}`} onPress={() => { add(kind); setShowMore(false); }} style={({ pressed }) => [styles.account, pressed && styles.pressed]}>
          <Text style={styles.accountText}>{kindLabel(kind)}</Text>
        </Pressable>)}
      </View> : null}
    </View>

    <View style={styles.group}>
      <TextInput
        accessibilityLabel="Notes"
        multiline
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={colors.textTertiary}
        style={styles.notes}
      />
    </View>

    {shared.length ? <Text style={styles.hint}>{shared.map((item) => `${item.contact} also has ${item.value}.`).join(' ')} Messages from it stay in their own conversation until only one contact has it.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    {onDelete ? <Pressable accessibilityRole="button" accessibilityHint="You can undo this for a few seconds" disabled={busy} onPress={remove} style={({ pressed }) => [styles.group, styles.deleteRow, pressed && styles.pressed]}>
      <Text style={styles.deleteText}>Delete Contact</Text>
    </Pressable> : null}
  </View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    editor: { gap: contactsSpace.l },
    bar: { flexDirection: 'row', alignItems: 'center', minHeight: touch },
    barButton: { minWidth: 64, minHeight: touch, justifyContent: 'center' },
    barTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '600' },
    cancelText: { color: colors.text, ...contactsType.body },
    doneText: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'right' },
    group: { borderRadius: contactsRadius.group, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    grow: { flex: 1 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    pressed: { backgroundColor: colors.chrome },
    name: { minHeight: 56, paddingHorizontal: contactsSpace.l, color: colors.text, fontSize: 22, fontWeight: '600', letterSpacing: -0.3, outlineStyle: 'none' } as object,
    selfRow: { padding: contactsSpace.l, gap: 4 },
    selfName: { color: colors.text, fontSize: 22, fontWeight: '600' },
    entry: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.s, minHeight: 52, paddingLeft: contactsSpace.m, paddingRight: contactsSpace.l },
    remove: { width: 32, height: touch, alignItems: 'center', justifyContent: 'center' },
    entryKind: { width: 84, color: colors.textSecondary, ...contactsType.label },
    entryInput: { flex: 1, minWidth: 0, minHeight: touch, color: colors.text, ...contactsType.body, outlineStyle: 'none' } as object,
    addRow: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 52, paddingHorizontal: contactsSpace.l + 2 },
    addText: { color: colors.text, ...contactsType.body },
    accounts: { flexDirection: 'row', flexWrap: 'wrap', gap: contactsSpace.s, paddingHorizontal: contactsSpace.l, paddingBottom: contactsSpace.l },
    account: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: contactsRadius.pill, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    accountText: { color: colors.text, fontSize: 14, fontWeight: '500' },
    notes: { minHeight: 96, padding: contactsSpace.l, color: colors.text, ...contactsType.body, textAlignVertical: 'top', outlineStyle: 'none' } as object,
    hint: { paddingHorizontal: 4, color: colors.textTertiary, ...contactsType.footnote },
    error: { paddingHorizontal: 4, color: colors.danger, ...contactsType.footnote },
    deleteRow: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
    deleteText: { color: colors.danger, fontSize: 17, fontWeight: '500' },
  });
}

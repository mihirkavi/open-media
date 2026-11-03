import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Loader } from './Loader';

import { applyDraft, ContactDraft, draftOf, draftProblems, sharedWith } from '../domain/contactMerge';
import { networks } from '../domain/networkPosts';
import { ContactCard, contactName, HandleNetwork, phoneNetworks } from '../domain/people';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { sourceLabel } from './SourceMarker';
import { Text, TextInput } from './Text';

/**
 * Editing a contact (ADR 0023), inside the person's profile. A name, then every way to reach them:
 * email addresses, phone numbers and handles on other networks. Anything that comes in from one of
 * these joins this person's one conversation in Messages.
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
    ...draft.emails.map((value) => ({ id: id++, kind: 'email' as Kind, value })),
    ...draft.phones.map((value) => ({ id: id++, kind: 'phone' as Kind, value })),
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

export function ContactEditor({ card, cards, onSave, onCancel, onDelete }: { card: ContactCard; cards: ContactCard[]; onSave: (card: ContactCard) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void> }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const initial = useMemo(() => draftOf(card), [card]);
  const [name, setName] = useState(initial.name);
  const [notes, setNotes] = useState(initial.notes);
  const [entries, setEntries] = useState<Entry[]>(() => entriesOf(initial));
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  return <View style={styles.editor}>
    <TextInput
      accessibilityLabel="Name"
      autoFocus={!contactName(card)}
      value={name}
      onChangeText={setName}
      placeholder="Name"
      placeholderTextColor={colors.textTertiary}
      style={styles.name}
    />
    <View style={styles.entries}>
      {entries.map((entry) => <View key={entry.id} style={styles.entry}>
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
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${kindLabel(entry.kind)} ${entry.value}`.trim()} onPress={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} hitSlop={8} style={styles.entryRemove}>
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>)}
    </View>

    <View style={styles.addBlock}>
      <Text style={styles.addTitle}>Add</Text>
      <View style={styles.addChips}>
        {[...common, ...(showMore ? more : [])].map((kind) => <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`Add ${kindLabel(kind)}`} onPress={() => add(kind)} style={styles.addChip}>
          <Ionicons name="add" size={13} color={colors.textSecondary} />
          <Text style={styles.addChipText}>{kindLabel(kind)}</Text>
        </Pressable>)}
        {showMore ? null : <Pressable accessibilityRole="button" onPress={() => setShowMore(true)} style={[styles.addChip, styles.addChipQuiet]}><Text style={styles.addChipText}>More</Text></Pressable>}
      </View>
    </View>

    <TextInput
      accessibilityLabel="Notes"
      multiline
      value={notes}
      onChangeText={setNotes}
      placeholder="Notes"
      placeholderTextColor={colors.textTertiary}
      style={styles.notes}
    />

    {shared.length ? <Text style={styles.hint}>{shared.map((item) => `${item.contact} also has ${item.value}.`).join(' ')} Messages from it stay in their own conversation until only one contact has it.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    <View style={styles.actions}>
      {onDelete ? confirmDelete
        ? <Pressable accessibilityRole="button" disabled={busy} onPress={remove} style={styles.deleteConfirm}><Text style={styles.deleteConfirmText}>Delete contact</Text></Pressable>
        : <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmDelete(true)} style={styles.delete}><Text style={styles.deleteText}>Delete</Text></Pressable>
        : null}
      <View style={styles.spacer} />
      {busy ? <Loader color={colors.text} /> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.save}><Text style={styles.saveText}>Save</Text></Pressable>
    </View>
  </View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    editor: { gap: 14 },
    name: { minHeight: 44, paddingVertical: 6, color: colors.text, fontSize: 20, fontWeight: '600', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, outlineStyle: 'none' } as object,
    entries: { gap: 2 },
    entry: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    entryKind: { width: 92, color: colors.textTertiary, fontSize: 13 },
    entryInput: { flex: 1, minWidth: 0, minHeight: 40, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object,
    entryRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
    addBlock: { gap: 8 },
    addTitle: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
    addChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    addChip: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 30, paddingLeft: 9, paddingRight: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
    addChipQuiet: { paddingLeft: 12, backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    addChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    notes: { minHeight: 64, padding: 12, borderRadius: 12, color: colors.text, fontSize: 14, lineHeight: 20, textAlignVertical: 'top', backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, outlineStyle: 'none' } as object,
    hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    error: { color: colors.danger, fontSize: 13 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    spacer: { flex: 1 },
    delete: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
    deleteText: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
    deleteConfirm: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.danger },
    deleteConfirmText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    cancel: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
    cancelText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    save: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 18, backgroundColor: colors.text },
    saveText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
  });
}

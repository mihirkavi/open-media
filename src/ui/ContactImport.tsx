import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Loader } from './Loader';

import { canPickContacts, pickContacts } from '../contacts/contactPicker';
import { pickContactsFiles } from '../data/contactImportFiles';
import { ImportedContact, ImportPlan, parseContactsFile, planImport } from '../domain/contactImport';
import { initialsFor } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { ContactsState, newId } from './people';
import { Text } from './Text';

/**
 * Importing contacts (ADR 0023), inside “Your contacts”: straight from the phone, from the
 * browser's contact picker where it exists, or from a vCard or CSV file (or, on a computer, by
 * dropping one, including contacts dragged out of the Mac's Contacts app). Nothing is saved until
 * the person has seen what will change.
 */

interface Review { source: string; contacts: ImportedContact[]; plan: ImportPlan }

export function ContactImport({ contacts }: { contacts: ContactsState }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const drop = useRef<View>(null);
  const native = Platform.OS !== 'web';
  const picker = !native && canPickContacts();
  const desktop = !native && typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)').matches;

  const prepare = (source: string, imported: ImportedContact[]) => {
    if (!imported.length) return;
    setError(''); setMessage('');
    setReview({ source, contacts: imported, plan: planImport(contacts.cards, imported, newId) });
  };
  const fromFiles = async (files: { name: string; text: string }[]) => {
    const imported: ImportedContact[] = [];
    for (const file of files) imported.push(...parseContactsFile(file.name, file.text));
    prepare(files.length === 1 ? files[0].name : `${files.length} files`, imported);
  };
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'That didn’t work. Try again.'); } finally { setBusy(''); }
  };

  // Dropping files on the web; the Mac's Contacts app drags people out as a vCard file.
  useEffect(() => {
    const node = drop.current as unknown as HTMLElement | null;
    if (native || !node?.addEventListener) return;
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); setDragging(true); } };
    const leave = () => setDragging(false);
    const dropped = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) run('file', async () => fromFiles(await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })))));
    };
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', dropped);
    return () => { node.removeEventListener('dragover', over); node.removeEventListener('dragleave', leave); node.removeEventListener('drop', dropped); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, contacts.cards]);

  const confirm = () => review && run('save', async () => {
    await contacts.saveMany(review.plan.changed);
    const { added, updated } = review.plan;
    const parts = [added ? `added ${added} ${added === 1 ? 'contact' : 'contacts'}` : '', updated ? `updated ${updated}` : ''].filter(Boolean).join(' and ');
    setMessage(parts ? `${parts[0].toUpperCase()}${parts.slice(1)}.` : 'Everyone was already in your contacts.');
    setReview(undefined);
  });

  if (review) {
    const { plan } = review;
    const names = review.contacts.map((item) => item.name).filter(Boolean);
    const sample = review.contacts.slice(0, 4);
    return <View style={styles.review}>
      <View style={styles.reviewHead}>
        <View style={styles.stack}>
          {sample.map((item, index) => <View key={index} style={[styles.face, index > 0 && styles.faceOverlap]}><Text style={styles.faceText}>{initialsFor(item.name || item.emails[0] || '?')}</Text></View>)}
        </View>
        <View style={styles.grow}>
          <Text style={styles.reviewTitle}>{review.contacts.length} {review.contacts.length === 1 ? 'contact' : 'contacts'} in {review.source}</Text>
          <Text numberOfLines={1} style={styles.reviewNames}>{names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')}</Text>
        </View>
      </View>
      <View style={styles.counts}>
        <Count value={plan.added} label="new" styles={styles} />
        <Count value={plan.updated} label="add details" styles={styles} />
        <Count value={plan.unchanged} label="already saved" styles={styles} />
      </View>
      <Text style={styles.reviewNote}>People who share an email address or phone number with a contact you have are added to that contact, never duplicated. Your saved names stay as they are.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.reviewActions}>
        <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => setReview(undefined)} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={Boolean(busy) || !plan.changed.length} onPress={confirm} style={[styles.primary, !plan.changed.length && styles.disabled]}>
          {busy === 'save' ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>{plan.changed.length ? `Import ${plan.added + plan.updated}` : 'Nothing to add'}</Text>}
        </Pressable>
      </View>
    </View>;
  }

  return <View ref={drop} style={[styles.box, dragging && styles.boxDragging]}>
    <View style={styles.sources}>
      {native ? <Source icon="phone-portrait-outline" title={Platform.OS === 'ios' ? 'From this iPhone' : 'From this phone'} detail="Your contacts app" busy={busy === 'device'} onPress={() => run('device', async () => { const count = await contacts.importFromDevice(); setMessage(`Imported ${count} ${count === 1 ? 'contact' : 'contacts'} from this phone.`); })} styles={styles} colors={colors} /> : null}
      {picker ? <Source icon="people-outline" title="Pick from this phone" detail="Choose who to add" busy={busy === 'picker'} onPress={() => run('picker', async () => prepare('your selection', await pickContacts()))} styles={styles} colors={colors} /> : null}
      <Source icon="document-text-outline" title="From a file" detail="vCard (.vcf) or CSV from Apple, Google or Outlook" busy={busy === 'file'} onPress={() => run('file', async () => fromFiles(await pickContactsFiles()))} styles={styles} colors={colors} />
    </View>
    {desktop ? <View style={[styles.dropZone, dragging && styles.dropZoneActive]}>
      <Ionicons name={dragging ? 'download-outline' : 'arrow-down-circle-outline'} size={18} color={dragging ? colors.text : colors.textTertiary} />
      <Text style={styles.dropText}>{dragging ? 'Drop to review' : 'Or drop a .vcf or .csv here. On a Mac, open Contacts, press ⌘A and drag everyone onto this box.'}</Text>
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.done}><Ionicons name="checkmark-circle" size={13} color={colors.text} /> {message}</Text> : null}
  </View>;
}

function Source({ icon, title, detail, busy, onPress, styles, colors }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; busy: boolean; onPress: () => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  return <Pressable accessibilityRole="button" accessibilityHint={detail} disabled={busy} onPress={onPress} style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.source, (hovered || pressed) && styles.sourceHover]}>
    <View style={styles.sourceIcon}>{busy ? <Loader color={colors.text} /> : <Ionicons name={icon} size={18} color={colors.text} />}</View>
    <View style={styles.grow}>
      <Text style={styles.sourceTitle}>{title}</Text>
      <Text style={styles.sourceDetail}>{detail}</Text>
    </View>
  </Pressable>;
}

function Count({ value, label, styles }: { value: number; label: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.count}><Text style={[styles.countValue, !value && styles.countZero]}>{value}</Text><Text style={styles.countLabel}>{label}</Text></View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    box: { padding: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    boxDragging: { backgroundColor: colors.surfaceAlt },
    sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    source: { flexGrow: 1, flexBasis: 220, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sourceHover: { borderColor: colors.textTertiary },
    sourceIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sourceTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    sourceDetail: { marginTop: 1, color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
    grow: { flex: 1, minWidth: 0 },
    dropZone: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
    dropZoneActive: { borderColor: colors.text },
    dropText: { flex: 1, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    review: { padding: 16, gap: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surfaceAlt },
    reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stack: { flexDirection: 'row' },
    face: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome, borderWidth: 2, borderColor: colors.surfaceAlt },
    faceOverlap: { marginLeft: -10 },
    faceText: { color: colors.text, fontSize: 11, fontWeight: '700' },
    reviewTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    reviewNames: { marginTop: 2, color: colors.textTertiary, fontSize: 13 },
    counts: { flexDirection: 'row', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    count: { flex: 1, alignItems: 'center', paddingVertical: 12 },
    countValue: { color: colors.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
    countZero: { color: colors.textTertiary },
    countLabel: { marginTop: 2, color: colors.textTertiary, fontSize: 12 },
    reviewNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    reviewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    secondary: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 19, borderWidth: 1, borderColor: colors.border },
    secondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    primary: { minWidth: 96, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 19, backgroundColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    disabled: { opacity: 0.4 },
    error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
    done: { color: colors.text, fontSize: 12, lineHeight: 18 },
  });
}

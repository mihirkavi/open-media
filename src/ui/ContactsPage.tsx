import Ionicons from './Icon';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { saveContactsFile } from '../data/contactExportFiles';
import { contactsToVCard, exportFileName } from '../domain/contactExport';
import { displayPhone } from '../domain/contactRules';
import { ContactCard, contactLabel, contactName, handleRef, IdentityRef, phoneNetworks, selfCard, selfLabel } from '../domain/people';
import { initialsFor } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { kindLabel } from './ContactEditor';
import { ContactImport } from './ContactImport';
import { avatarSize, contactsRadius, contactsSpace, contactsType, touch } from './contactsDesign';
import { Loader } from './Loader';
import { newId, PersonTarget, usePeople } from './people';
import { Text, TextInput } from './Text';

/**
 * Contacts (ADR 0036): every person you saved, in one calm list. A large title, one search field,
 * New contact, Import and Export, your own card first, then everyone from A to Z. Opening someone
 * shows their card, where you edit them. Only you can see this page.
 */

type Panel = 'import' | undefined;

export function ContactsPage({ handle, onBack }: { handle: string; onBack?: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const people = usePeople();
  const contacts = people?.contacts;
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>();
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const gutter = width >= 720 ? contactsSpace.wideGutter : contactsSpace.gutter;
  // On a phone, Import and Export are round icon buttons beside a full-width New contact.
  const narrow = width < 560;

  const others = useMemo(() => (contacts?.cards ?? []).filter((card) => !card.self), [contacts?.cards]);
  const sections = useMemo(() => {
    const needle = fold(query);
    const matches = others.filter((card) => !needle || matchesQuery(card, needle, digits(query)));
    const groups = new Map<string, ContactCard[]>();
    for (const card of matches.sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base' }))) {
      const first = sortKey(card).charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : '#';
      groups.set(letter, [...(groups.get(letter) ?? []), card]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))).map(([title, data]) => ({ title, data }));
  }, [others, query]);

  if (!contacts) return null;
  const me = selfCard(contacts.cards);
  const total = others.length;
  const shown = sections.reduce((count, section) => count + section.data.length, 0);

  const exportAll = async () => {
    setBusy('export'); setNote('');
    try {
      await saveContactsFile(exportFileName(), contactsToVCard(contacts.cards));
      setNote(`Exported ${total.toLocaleString()} ${total === 1 ? 'contact' : 'contacts'} as a vCard file.`);
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : 'Could not export your contacts.');
    } finally { setBusy(''); }
  };

  const createContact = (name = '') => {
    const now = new Date().toISOString();
    const card: ContactCard = { id: newId(), source: 'manual', name: name.trim(), nicknames: [], phones: [], emails: [], handles: [], notes: '', links: [], rejected: [], updatedAt: now };
    // A draft until Done, as in Apple Contacts: Cancel leaves nothing behind.
    people?.open({ ref: { kind: 'phone', number: '' }, cardId: card.id, editing: true, draft: card });
  };

  const header = <View style={[styles.header, { paddingHorizontal: gutter }]}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back to profile" onPress={onBack} hitSlop={8} style={styles.back}>
      <Ionicons name="chevron-back" size={20} color={colors.text} /><Text style={styles.backText}>Profile</Text>
    </Pressable> : null}
    <Text accessibilityRole="header" style={styles.largeTitle}>Contacts</Text>
    <View style={styles.privacy}>
      <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />
      <Text style={styles.privacyText}>{contacts.ready ? `${total.toLocaleString()} ${total === 1 ? 'person' : 'people'} · only you can see them` : 'Loading your contacts…'}</Text>
    </View>

    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => createContact()} style={({ pressed }) => [styles.primary, narrow && styles.primaryWide, pressed && styles.pressed]}>
        <Ionicons name="add" size={18} color={colors.surface} /><Text style={styles.primaryText}>New contact</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Import contacts" accessibilityState={{ expanded: panel === 'import' }} onPress={() => setPanel(panel === 'import' ? undefined : 'import')} style={({ pressed }) => [styles.secondary, narrow && styles.round, panel === 'import' && styles.secondaryOn, pressed && styles.pressed]}>
        <Ionicons name="arrow-down-circle-outline" size={20} color={colors.text} />{narrow ? null : <Text style={styles.secondaryText}>Import</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Export contacts as a vCard file" disabled={!total || Boolean(busy)} onPress={exportAll} style={({ pressed }) => [styles.secondary, narrow && styles.round, (!total || busy) && styles.disabled, pressed && styles.pressed]}>
        {busy === 'export' ? <Loader color={colors.text} /> : <Ionicons name="share-outline" size={20} color={colors.text} />}{narrow ? null : <Text style={styles.secondaryText}>Export</Text>}
      </Pressable>
    </View>
    {note ? <Text accessibilityLiveRegion="polite" style={styles.note}>{note}</Text> : null}

    {panel === 'import' || (contacts.ready && !total) ? <View style={styles.importPanel}>
      {!total ? <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Your people, in one place.</Text>
        <Text style={styles.emptyCopy}>Bring in the contacts you already have. A saved name shows everywhere, and every chat and email from one person becomes one conversation.</Text>
      </View> : null}
      <ContactImport contacts={contacts} onDone={() => setPanel(undefined)} />
    </View> : null}

    {total ? <View style={styles.search}>
      <Ionicons name="search" size={17} color={colors.textTertiary} />
      <TextInput accessibilityLabel="Search contacts" value={query} onChangeText={setQuery} placeholder={`Search ${total.toLocaleString()} contacts`} placeholderTextColor={colors.textTertiary} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" style={styles.searchInput} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={17} color={colors.textTertiary} /></Pressable> : null}
    </View> : null}

    {contacts.suggestions.length && !query ? <Pressable accessibilityRole="button" onPress={() => people?.open({ ref: contacts.suggestions[0].ref })} style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
      <View style={styles.bannerIcon}><Ionicons name="git-merge-outline" size={16} color={colors.text} /></View>
      <View style={styles.grow}>
        <Text style={styles.bannerTitle}>{contacts.suggestions.length === 1 ? '1 person may already be a contact' : `${contacts.suggestions.length} people may already be contacts`}</Text>
        <Text style={styles.bannerCopy}>Review</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable> : null}

    {!query ? <Pressable accessibilityRole="link" accessibilityLabel={`${selfLabel(people?.me?.name ?? '')}, my card`} onPress={() => people?.open({ ref: { kind: 'open_media', handle } })} style={({ pressed }) => [styles.meRow, pressed && styles.pressed]}>
      <View style={[styles.avatar, styles.meAvatar]}><Text style={[styles.avatarText, styles.meAvatarText]}>{initialsFor(people?.me?.name || 'Me')}</Text></View>
      <View style={styles.grow}>
        <Text numberOfLines={1} style={styles.name}>{people?.me?.name || 'Me'}</Text>
        <Text numberOfLines={1} style={styles.detail}>My card{me ? ` · ${reachSummary(me) || 'add your other addresses'}` : ' · add your other addresses'}</Text>
      </View>
    </Pressable> : null}

    {query && !shown ? <View style={styles.noMatch}>
      <Text style={styles.noMatchText}>No one called “{query.trim()}”.</Text>
      <Pressable accessibilityRole="button" onPress={() => createContact(query)} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        <Ionicons name="add" size={18} color={colors.text} /><Text style={styles.secondaryText}>Add “{query.trim()}”</Text>
      </Pressable>
    </View> : null}
  </View>;

  return <SectionList
    style={styles.screen}
    contentContainerStyle={styles.content}
    sections={contacts.ready ? sections : []}
    keyExtractor={(card) => card.id}
    keyboardShouldPersistTaps="handled"
    stickySectionHeadersEnabled
    initialNumToRender={30}
    windowSize={11}
    ListHeaderComponent={header}
    ListFooterComponent={!contacts.ready ? <Loader style={styles.loading} color={colors.text} /> : <View style={styles.footer}>{contacts.error ? <Text accessibilityRole="alert" style={styles.error}>{contacts.error}</Text> : null}</View>}
    renderSectionHeader={({ section }) => <View style={[styles.sectionHeader, { paddingHorizontal: gutter }]}><Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text></View>}
    renderItem={({ item, index, section }) => <ContactRow card={item} last={index === section.data.length - 1} gutter={gutter} onOpen={() => people?.open(targetFor(item))} styles={styles} colors={colors} />}
  />;
}

function ContactRow({ card, last, gutter, onOpen, styles, colors }: { card: ContactCard; last: boolean; gutter: number; onOpen: () => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  const name = contactName(card);
  const summary = reachSummary(card);
  return <Pressable accessibilityRole="link" accessibilityLabel={[name || contactLabel(card), card.company ? 'company' : '', summary].filter(Boolean).join(', ')} onPress={onOpen}
    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, { paddingHorizontal: gutter }, (pressed || hovered) && styles.rowActive]}>
    <View style={[styles.avatar, card.company && styles.companyAvatar]}>
      {card.company ? <Ionicons name="business-outline" size={18} color={colors.textSecondary} /> : <Text style={styles.avatarText}>{initialsFor(name || summary || '?')}</Text>}
    </View>
    <View style={[styles.rowCopy, !last && styles.rowDivider]}>
      <Text numberOfLines={1} style={[styles.name, !name && styles.unnamed]}>{name || contactLabel(card)}</Text>
      {summary && name ? <Text numberOfLines={1} style={styles.detail}>{summary}</Text> : null}
    </View>
  </Pressable>;
}

/** How you reach someone, in a few words: "+1 555 010 0021 · Signal · LinkedIn". */
export function reachSummary(card: ContactCard): string {
  const networks = [...new Set([
    ...(card.handles ?? []).map((item) => kindLabel(item.network)),
    ...card.links.flatMap((link) => link.ref.kind === 'bridge' ? [kindLabel(link.ref.network)] : link.ref.kind === 'open_media' ? ['Open Media'] : []),
  ])];
  const first = card.phones[0] ? displayPhone(card.phones[0]) : card.emails[0];
  return [first, ...networks.filter((label) => label !== 'Phone' && label !== 'Email').slice(0, 2)].filter(Boolean).join(' · ');
}

/** Where opening a contact goes: their card, by its id, shown on their Open Media profile when linked. */
export function targetFor(card: ContactCard): PersonTarget {
  const linked = card.links.find((link) => link.ref.kind === 'open_media') ?? card.links[0];
  const handle = card.handles?.find((item) => item.handle.trim() && !phoneNetworks.has(item.network));
  const ref: IdentityRef = linked?.ref ?? (card.emails[0] ? { kind: 'email', address: card.emails[0] } : card.phones[0] ? { kind: 'phone', number: card.phones[0] } : handle ? handleRef(handle) : { kind: 'phone', number: '' });
  return { ref, name: contactName(card) || undefined, cardId: card.id };
}

/**
 * Search as in Apple Contacts: the start of any word of the name or a nickname ("ab" finds Erica
 * Ablan-Go), the start of a handle, digits anywhere in a number, and inside email addresses only
 * when the search looks like one (has "@" or ".").
 */
function matchesQuery(card: ContactCard, needle: string, number: string): boolean {
  const words = [contactLabel(card), ...card.nicknames].flatMap((value) => fold(value).split(/[\s\-'’.()]+/)).filter(Boolean);
  const terms = needle.split(/\s+/).filter(Boolean);
  if (terms.every((term) => words.some((word) => word.startsWith(term)))) return true;
  if ((card.handles ?? []).some((item) => fold(item.handle.replace(/^@/, '')).startsWith(needle.replace(/^@/, '')))) return true;
  if (number.length >= 3 && card.phones.some((phone) => digits(phone).includes(number))) return true;
  return /[@.]/.test(needle) && card.emails.some((email) => fold(email).includes(needle));
}

function sortKey(card: ContactCard): string {
  return fold(contactLabel(card)).replace(/^[^a-z0-9]+/, '') || '#';
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: 96 },
    header: { paddingTop: contactsSpace.l },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: touch, marginLeft: -6, paddingRight: 8 },
    backText: { color: colors.text, ...contactsType.subhead },
    largeTitle: { marginTop: contactsSpace.s, color: colors.text, ...contactsType.largeTitle },
    privacy: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: contactsSpace.xs },
    privacyText: { color: colors.textTertiary, ...contactsType.footnote },
    actions: { flexDirection: 'row', gap: contactsSpace.s, marginTop: contactsSpace.xl },
    primary: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 16, paddingRight: 20, borderRadius: contactsRadius.pill, backgroundColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 15, fontWeight: '600' },
    secondary: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 14, paddingRight: 18, borderRadius: contactsRadius.pill, backgroundColor: colors.chrome },
    secondaryOn: { backgroundColor: colors.border },
    primaryWide: { flex: 1, justifyContent: 'center' },
    round: { width: touch, paddingLeft: 0, paddingRight: 0, justifyContent: 'center' },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.42 },
    pressed: { transform: [{ scale: 0.97 }], opacity: 0.85 },
    note: { marginTop: contactsSpace.m, color: colors.textSecondary, ...contactsType.footnote },
    importPanel: { marginTop: contactsSpace.xl, padding: contactsSpace.l, gap: contactsSpace.l, borderRadius: contactsRadius.group, backgroundColor: colors.surfaceAlt },
    empty: { gap: contactsSpace.s, paddingTop: contactsSpace.s },
    emptyTitle: { color: colors.text, ...contactsType.title },
    emptyCopy: { color: colors.textSecondary, ...contactsType.subhead },
    search: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.s, minHeight: touch, marginTop: contactsSpace.xl, paddingHorizontal: contactsSpace.m, borderRadius: contactsRadius.input, backgroundColor: colors.chrome },
    searchInput: { flex: 1, minWidth: 0, minHeight: touch, color: colors.text, ...contactsType.body, outlineStyle: 'none' } as object,
    banner: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 60, marginTop: contactsSpace.l, paddingHorizontal: contactsSpace.l, borderRadius: contactsRadius.group, backgroundColor: colors.surfaceAlt },
    bannerIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    bannerTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    bannerCopy: { color: colors.textSecondary, ...contactsType.footnote },
    meRow: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 72, marginTop: contactsSpace.l },
    meAvatar: { backgroundColor: colors.text },
    meAvatarText: { color: colors.surface },
    noMatch: { alignItems: 'flex-start', gap: contactsSpace.m, paddingVertical: contactsSpace.xxl },
    noMatchText: { color: colors.textSecondary, ...contactsType.body },
    sectionHeader: { paddingTop: contactsSpace.l, paddingBottom: contactsSpace.xs, backgroundColor: colors.surface },
    sectionTitle: { color: colors.textTertiary, ...contactsType.section },
    row: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 60 },
    rowActive: { backgroundColor: colors.surfaceAlt },
    rowCopy: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center', paddingVertical: contactsSpace.s },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    avatar: { width: avatarSize.row, height: avatarSize.row, borderRadius: contactsRadius.avatar, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
    companyAvatar: { borderRadius: 12 },
    avatarText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    name: { color: colors.text, ...contactsType.name },
    unnamed: { color: colors.textSecondary },
    detail: { marginTop: 1, color: colors.textSecondary, ...contactsType.footnote },
    grow: { flex: 1, minWidth: 0 },
    loading: { padding: contactsSpace.xxl },
    footer: { height: contactsSpace.xxl },
    error: { marginTop: contactsSpace.m, color: colors.danger, textAlign: 'center', ...contactsType.footnote },
  });
}

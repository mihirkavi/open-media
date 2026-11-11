import Ionicons from './Icon';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { displayPhone } from '../domain/contactRules';
import { networks } from '../domain/networkPosts';
import { ContactCard, confirmLink, contactLabel, contactName, IdentityRef, LinkSuggestion, phoneNetworks, refKey, selfLabel } from '../domain/people';
import { initialsFor } from '../domain/publicPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { ContactEditor, kindLabel } from './ContactEditor';
import { contactsRadius, contactsSpace, contactsType, touch } from './contactsDesign';
import { Loader } from './Loader';
import { ContactsState } from './people';
import { Text, TextInput } from './Text';

/**
 * What only the viewer knows about a person (ADR 0023, redesigned in ADR 0036): quick actions to
 * call or write, their saved details in one quiet group (label above value, tap to use), the chats
 * linked to them, and editing in place. Deleting is immediate and can be undone for a few seconds.
 */
export function ContactCardView({ contacts, card, self, meName, target, publicName, suggestions, editing, onEditing, draft, onDiscard, onAddSelf, onAddNew }: {
  contacts: ContactsState;
  card?: ContactCard;
  self: boolean;
  meName?: string;
  target: { ref: IdentityRef };
  publicName: string;
  suggestions: LinkSuggestion[];
  editing: boolean;
  onEditing: (value: boolean) => void;
  /** A new contact not saved yet: Cancel discards it. */
  draft?: boolean;
  onDiscard?: () => void;
  onAddSelf: () => Promise<void>;
  onAddNew: () => Promise<void>;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState('');
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [deleted, setDeleted] = useState<ContactCard>();
  const act = async (label: string, action: () => Promise<unknown>) => { setBusy(label); try { await action(); } finally { setBusy(''); } };

  // The undo offer stays for eight seconds, as long as a snackbar would.
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(undefined), 8000);
    return () => clearTimeout(timer);
  }, [deleted]);

  if (deleted && !card) return <View style={styles.wrap}>
    <View accessibilityLiveRegion="polite" style={styles.undoBar}>
      <Ionicons name="trash-outline" size={16} color={colors.surface} />
      <Text style={styles.undoText} numberOfLines={1}>{contactLabel(deleted)} deleted</Text>
      <Pressable accessibilityRole="button" onPress={() => act('undo', async () => { await contacts.save(deleted); setDeleted(undefined); })} hitSlop={8} style={styles.undoButton}><Text style={styles.undoButtonText}>Undo</Text></Pressable>
    </View>
  </View>;

  if (card && editing) return <View style={styles.wrap}>
    <ContactEditor
      key={card.id}
      selfName={card.self ? meName ?? card.name : undefined}
      card={card}
      cards={contacts.cards}
      onCancel={() => (draft ? onDiscard?.() : onEditing(false))}
      onSave={async (next) => { await contacts.save(next); onEditing(false); }}
      onDelete={card.self || draft ? undefined : async () => { await contacts.remove(card.id); onEditing(false); setDeleted(card); }}
    />
  </View>;

  const details = card ? [
    ...card.phones.map((value) => ({ key: `p:${value}`, label: 'Phone', value: displayPhone(value), href: `tel:${value.replace(/[^\d+*#]/g, '')}` })),
    ...card.emails.map((value) => ({ key: `e:${value}`, label: 'Email', value, href: `mailto:${value}` })),
    ...(card.handles ?? []).map((item) => ({ key: `h:${item.network}:${item.handle}`, label: kindLabel(item.network), value: phoneNetworks.has(item.network) ? displayPhone(item.handle) : /^\d+$/.test(item.handle) ? item.handle : `@${item.handle.replace(/^@/, '')}`, href: handleHref(item.network, item.handle) })),
    ...(card.nicknames.length ? [{ key: 'nick', label: card.nicknames.length > 1 ? 'Nicknames' : 'Nickname', value: card.nicknames.join(', '), href: undefined }] : []),
    ...(card.notes ? [{ key: 'notes', label: 'Notes', value: card.notes, href: undefined }] : []),
  ] : [];
  const call = card?.phones[0];
  const mail = card?.emails[0];

  return <View style={styles.wrap}>
    {card && (call || mail) && !card.self ? <View style={styles.quickActions}>
      {call ? <QuickAction icon="call-outline" label="Call" onPress={() => Linking.openURL(`tel:${call.replace(/[^\d+*#]/g, '')}`).catch(() => undefined)} styles={styles} colors={colors} /> : null}
      {mail ? <QuickAction icon="mail-outline" label="Mail" onPress={() => Linking.openURL(`mailto:${mail}`).catch(() => undefined)} styles={styles} colors={colors} /> : null}
    </View> : null}

    <View style={styles.groupHead}>
      <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />
      <Text style={[styles.groupHeadText, styles.grow]}>{card?.self ? 'Your card · only you see this' : 'Only you see this'}</Text>
      {card ? <Pressable accessibilityRole="button" accessibilityLabel={card.self ? 'Edit my card' : `Edit ${contactLabel(card)}`} onPress={() => onEditing(true)} hitSlop={10} style={styles.editButton}><Text style={styles.editText}>Edit</Text></Pressable> : null}
    </View>

    {card ? <View style={styles.group}>
      {!contactName(card) && !card.self ? <Pressable accessibilityRole="button" onPress={() => onEditing(true)} style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
        <Text style={styles.itemLabel}>Name</Text>
        <Text style={styles.nudge}>Add their name. It shows instead of the address everywhere.</Text>
      </Pressable> : null}
      {details.map((item, index) => <Pressable key={item.key} accessibilityRole={item.href ? 'link' : 'text'} accessibilityLabel={`${item.label}, ${item.value}`} disabled={!item.href} onPress={() => item.href && Linking.openURL(item.href).catch(() => undefined)}
        style={({ pressed }) => [styles.item, (index > 0 || !contactName(card)) && styles.itemDivider, pressed && styles.itemPressed]}>
        <Text style={styles.itemLabel}>{item.label}</Text>
        <Text selectable style={[styles.itemValue, item.href && styles.itemLink]}>{item.value}</Text>
      </Pressable>)}
      {!details.length && contactName(card) ? <Pressable accessibilityRole="button" onPress={() => onEditing(true)} style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
        <Text style={styles.nudge}>{card.self ? 'Add your other emails, numbers and accounts, so mail and chats from them are recognised as you.' : 'Add their emails, numbers and accounts. Everything they send from any of them lands in one conversation.'}</Text>
      </Pressable> : null}
    </View> : null}

    {self && !card ? <View style={styles.group}>
      <Text style={[styles.nudge, styles.groupCopy]}>Add your other email addresses, phone numbers and accounts. Mail and chats from any of them are recognised as you, and you appear as {selfLabel(meName ?? '')} in your contacts.</Text>
      <ActionRow icon="person-circle-outline" label="Add my other addresses" busy={busy === 'me'} onPress={() => act('me', onAddSelf)} divider styles={styles} colors={colors} />
    </View> : null}

    {card?.links.length ? <>
      <Text style={styles.sectionTitle}>Linked chats and accounts</Text>
      <View style={styles.group}>
        {card.links.map((link, index) => <View key={refKey(link.ref)} style={[styles.linkRow, index > 0 && styles.itemDivider]}>
          <View style={styles.linkIcon}><Ionicons name={linkIcon(link.ref)} size={16} color={colors.text} /></View>
          <View style={styles.grow}>
            <Text numberOfLines={1} style={styles.linkName}>{describe(link.ref)}</Text>
            <Text numberOfLines={1} style={styles.linkWhy}>{link.method === 'auto' ? `Linked automatically · ${link.evidence.charAt(0).toLowerCase()}${link.evidence.slice(1)}` : 'Linked by you'}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Unlink ${describe(link.ref)}`} disabled={Boolean(busy)} onPress={() => act('undo', () => contacts.undo(card.id, link.ref))} hitSlop={8} style={styles.quietButton}><Text style={styles.quietButtonText}>Unlink</Text></Pressable>
        </View>)}
      </View>
    </> : null}

    {!self && suggestions.length ? <View style={[styles.group, styles.groupSpaced]}>
      {suggestions.map((suggestion, index) => {
        const suggested = contacts.cards.find((item) => item.id === suggestion.cardId);
        return suggested ? <View key={suggestion.cardId} style={[styles.suggestion, index > 0 && styles.itemDivider]}>
          <Text style={styles.linkName}>Is this {contactLabel(suggested)}?</Text>
          <Text style={styles.linkWhy}>{suggestion.reason}</Text>
          <View style={styles.suggestionActions}>
            <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('yes', () => contacts.confirm(suggestion.cardId, target.ref))} style={styles.pillStrong}><Text style={styles.pillStrongText}>Yes, link them</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('no', () => contacts.reject(suggestion.cardId, target.ref))} style={styles.pill}><Text style={styles.pillText}>Not the same person</Text></Pressable>
          </View>
        </View> : null;
      })}
    </View> : null}

    {!card && !self ? <View style={[styles.group, styles.groupSpaced]}>
      <ActionRow icon="person-add-outline" label="Add to Contacts" busy={busy === 'add'} onPress={() => act('add', onAddNew)} styles={styles} colors={colors} />
      {contacts.cards.some((item) => !item.self) ? <ActionRow icon="git-merge-outline" label="Add to an Existing Contact" onPress={() => setPicking(!picking)} divider styles={styles} colors={colors} /> : null}
      {picking ? <View style={styles.picker}>
        <TextInput autoFocus accessibilityLabel="Find a contact" value={query} onChangeText={setQuery} placeholder={`Who is ${publicName || 'this'}?`} placeholderTextColor={colors.textTertiary} style={styles.pickerInput} />
        {contacts.cards
          .filter((item) => !item.self && (!query.trim() || [item.name, ...item.emails, ...item.phones].join(' ').toLowerCase().includes(query.trim().toLowerCase())))
          .sort((a, b) => contactLabel(a).localeCompare(contactLabel(b))).slice(0, 6)
          .map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Add to ${contactLabel(item)}`} disabled={Boolean(busy)} onPress={() => act('merge', async () => { await contacts.save(confirmLink(item, target.ref)); setPicking(false); setQuery(''); })} style={({ pressed }) => [styles.pickerRow, pressed && styles.itemPressed]}>
            <View style={styles.pickerFace}><Text style={styles.pickerInitials}>{initialsFor(contactLabel(item))}</Text></View>
            <View style={styles.grow}><Text numberOfLines={1} style={styles.linkName}>{contactLabel(item)}</Text>{item.emails[0] || item.phones[0] ? <Text numberOfLines={1} style={styles.linkWhy}>{item.emails[0] ?? item.phones[0]}</Text> : null}</View>
            <Ionicons name="add-circle" size={22} color={colors.success} />
          </Pressable>)}
      </View> : null}
    </View> : null}
  </View>;
}

function QuickAction({ icon, label, onPress, styles, colors }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}>
    <Ionicons name={icon} size={20} color={colors.text} />
    <Text style={styles.quickLabel}>{label}</Text>
  </Pressable>;
}

function ActionRow({ icon, label, busy, divider, onPress, styles, colors }: { icon: keyof typeof Ionicons.glyphMap; label: string; busy?: boolean; divider?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  return <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={({ pressed }) => [styles.actionRow, divider && styles.itemDivider, pressed && styles.itemPressed]}>
    {busy ? <Loader color={colors.text} /> : <Ionicons name={icon} size={20} color={colors.text} />}
    <Text style={styles.actionRowText}>{label}</Text>
  </Pressable>;
}

function handleHref(network: string, handle: string): string | undefined {
  const value = handle.trim().replace(/^@/, '');
  const urls: Record<string, string> = {
    linkedin: `https://www.linkedin.com/in/${encodeURIComponent(value)}`, twitter: `https://x.com/${encodeURIComponent(value)}`,
    instagram: `https://www.instagram.com/${encodeURIComponent(value)}`, telegram: `https://t.me/${encodeURIComponent(value)}`,
    bluesky: `https://bsky.app/profile/${encodeURIComponent(value)}`, whatsapp: `https://wa.me/${value.replace(/\D/g, '')}`,
  };
  return urls[network];
}

function linkIcon(ref: IdentityRef): keyof typeof Ionicons.glyphMap {
  if (ref.kind === 'email') return 'mail-outline';
  if (ref.kind === 'phone') return 'call-outline';
  if (ref.kind === 'bridge') return 'chatbubble-outline';
  return 'person-outline';
}

function describe(ref: IdentityRef): string {
  switch (ref.kind) {
    case 'open_media': return `@${ref.handle} on Open Media`;
    case 'email': return ref.address;
    case 'phone': return ref.number;
    case 'network': return `@${ref.handle} on ${networks[ref.network].displayName}`;
    case 'bridge': return `${kindLabel(ref.network)} chat${ref.phone ? ` · ${ref.phone}` : /^\+?\d{7,15}$/.test(ref.id) ? ` · ${ref.id}` : ''}`;
  }
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginHorizontal: contactsSpace.l, marginBottom: contactsSpace.xl },
    grow: { flex: 1, minWidth: 0 },
    quickActions: { flexDirection: 'row', justifyContent: 'center', gap: contactsSpace.m, marginBottom: contactsSpace.xl },
    quick: { width: 76, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 16, backgroundColor: colors.surfaceAlt },
    quickPressed: { transform: [{ scale: 0.97 }], backgroundColor: colors.chrome },
    quickLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: touch, paddingHorizontal: 4 },
    groupHeadText: { color: colors.textTertiary, ...contactsType.footnote },
    editButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 14, borderRadius: contactsRadius.pill, backgroundColor: colors.chrome },
    editText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    group: { borderRadius: contactsRadius.group, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    groupSpaced: { marginTop: contactsSpace.l },
    groupCopy: { padding: contactsSpace.l },
    item: { minHeight: 60, justifyContent: 'center', paddingHorizontal: contactsSpace.l, paddingVertical: 10 },
    itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    itemPressed: { backgroundColor: colors.chrome },
    itemLabel: { color: colors.textTertiary, ...contactsType.label },
    itemValue: { marginTop: 2, color: colors.text, ...contactsType.body },
    itemLink: { color: colors.text },
    nudge: { marginTop: 2, color: colors.textSecondary, ...contactsType.subhead },
    sectionTitle: { marginTop: contactsSpace.xl, marginBottom: contactsSpace.s, paddingHorizontal: 4, color: colors.textTertiary, ...contactsType.section, textTransform: 'uppercase' },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 60, paddingHorizontal: contactsSpace.l, paddingVertical: 10 },
    linkIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    linkName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    linkWhy: { marginTop: 1, color: colors.textTertiary, ...contactsType.footnote },
    quietButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 12, borderRadius: contactsRadius.pill },
    quietButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    suggestion: { gap: 4, padding: contactsSpace.l },
    suggestionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: contactsSpace.s, marginTop: contactsSpace.s },
    pill: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: contactsRadius.pill, backgroundColor: colors.chrome },
    pillText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    pillStrong: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: contactsRadius.pill, backgroundColor: colors.text },
    pillStrongText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 56, paddingHorizontal: contactsSpace.l },
    actionRowText: { color: colors.text, ...contactsType.body },
    picker: { paddingHorizontal: contactsSpace.s, paddingBottom: contactsSpace.s, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    pickerInput: { minHeight: touch, paddingHorizontal: contactsSpace.s, color: colors.text, ...contactsType.body, outlineStyle: 'none' } as object,
    pickerRow: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 52, paddingHorizontal: contactsSpace.s, borderRadius: 12 },
    pickerFace: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
    pickerInitials: { color: colors.text, fontSize: 12, fontWeight: '600' },
    undoBar: { flexDirection: 'row', alignItems: 'center', gap: contactsSpace.m, minHeight: 52, paddingLeft: contactsSpace.l, paddingRight: 6, borderRadius: contactsRadius.pill, backgroundColor: colors.text },
    undoText: { flex: 1, color: colors.surface, fontSize: 15, fontWeight: '500' },
    undoButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: contactsRadius.pill, backgroundColor: colors.surface },
    undoButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  });
}

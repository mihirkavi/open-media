import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FollowStatus, followPerson, loadPublicPerson, loadTimeline, PublicPerson, sourcesFor, TimelineSource, unfollowPerson } from '../data/peopleService';
import { networks } from '../domain/networkPosts';
import { cardFor, ContactCard, IdentityRef, linkedIdentities, refKey, shownName } from '../domain/people';
import { SocialPost } from '../domain/posts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { PostCard } from './OpenMediaFeed';
import { newId, PersonTarget, usePeople } from './people';
import { ProfessionalLines } from './ProfessionalLines';
import { Text } from './Text';
import { VerifiedTick } from './VerifiedTick';

/**
 * The unified profile (ADR 0013): one view of a person, built for the viewer. The top shows what
 * the person made public; a clearly marked section shows what only the viewer knows (their saved
 * name, numbers, notes, and how identities were linked). Below is one timeline of the person's
 * posts across Open Media and their open-network accounts.
 */
export function PersonProfile({ target, viewerId, onBack, onMessage }: { target: PersonTarget; viewerId?: string; onBack?: () => void; onMessage?: (handle: string) => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const people = usePeople();
  const contacts = people?.contacts;
  const [person, setPerson] = useState<PublicPerson | null>();
  const [posts, setPosts] = useState<SocialPost[]>();
  const [failed, setFailed] = useState<TimelineSource[]>([]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [follow, setFollow] = useState<FollowStatus>(null);
  const [followError, setFollowError] = useState('');

  const handle = target.ref.kind === 'open_media' || target.ref.kind === 'network' ? target.ref.handle.replace(/^@/, '') : undefined;
  const card = contacts ? cardFor(contacts.cards, target.ref) : undefined;
  const refs = contacts ? linkedIdentities(contacts.cards, target.ref) : [target.ref];
  const omHandle = (refs.find((ref) => ref.kind === 'open_media') as Extract<IdentityRef, { kind: 'open_media' }> | undefined)?.handle;

  useEffect(() => {
    let active = true;
    setPerson(undefined);
    if (!omHandle) { setPerson(null); return; }
    loadPublicPerson(omHandle).then((value) => { if (active) { setPerson(value ?? null); setFollow(value?.followStatus ?? null); } }).catch(() => { if (active) setPerson(null); });
    return () => { active = false; };
  }, [omHandle]);

  const sources = useMemo(() => sourcesFor(refs, person ?? undefined), [refs.map(refKey).join('|'), person]);
  const sourceKey = sources.map((source) => source.kind === 'open_media' ? `om:${source.handle}` : `${source.network}:${source.handle}`).join('|');
  useEffect(() => {
    if (person === undefined) return;
    let active = true;
    setPosts(undefined);
    loadTimeline(sources).then((result) => { if (active) { setPosts(result.posts); setFailed(result.failed); } }).catch(() => { if (active) setPosts([]); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, person === undefined]);

  const names = shownName({ declaredName: person?.displayName ?? (target.ref.kind === 'network' ? target.name : undefined), handle: person?.handle ?? handle }, card);
  const name = target.ref.kind === 'email' || target.ref.kind === 'phone' || target.ref.kind === 'bridge' ? (card?.name ?? target.name ?? names.name) : names.name;
  const avatar = person?.avatarUrl ?? target.avatarUrl;
  const where = target.ref.kind === 'network' ? networks[target.ref.network].displayName : target.ref.kind === 'open_media' ? 'Open Media' : undefined;
  const sourceLabel = (source: TimelineSource) => source.kind === 'open_media' ? 'Open Media' : networks[source.network].displayName;
  const visible = (posts ?? []).filter((post) => filter === 'all' || post.provenance.connectorId === filter);
  const filters = ['all', ...new Set(sources.map((source) => source.kind === 'open_media' ? 'open-media' : source.network))];
  const suggestions = contacts?.suggestions.filter((item) => refKey(item.ref) === refKey(target.ref)) ?? [];
  const external = target.ref.kind === 'network' ? posts?.find((post) => post.provenance.canonicalURL)?.provenance.canonicalURL : undefined;
  const self = Boolean(viewerId && person?.id === viewerId);
  const locked = Boolean(person && !person.canView);

  const toggleFollow = async () => {
    if (!person) return;
    setFollowError('');
    const before = follow;
    setFollow(before ? null : person.visibility === 'private' ? 'pending' : 'accepted');
    try {
      if (before) await unfollowPerson(person.handle);
      else setFollow(await followPerson(person.handle));
      if (before === 'accepted' && person.visibility === 'private') setPerson(await loadPublicPerson(person.handle) ?? null);
    } catch (reason) {
      setFollow(before);
      setFollowError(reason instanceof Error ? reason.message : 'That didn’t work. Try again.');
    }
  };

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    try { await action(); } finally { setBusy(''); }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {onBack ? <View style={styles.bar}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable></View> : <View style={styles.barSpace} />}

    <View style={styles.header}>
      {avatar ? <Image accessibilityIgnoresInvertColors source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.initials}>{(name.replace(/^@/, '')[0] ?? '?').toUpperCase()}</Text></View>}
      <View style={styles.nameLine}><Text accessibilityRole="header" style={styles.name}>{name}</Text>{person?.verified ? <VerifiedTick size={20} /> : null}</View>
      <Text style={styles.meta}>{[handle ? `@${handle}` : undefined, where].filter(Boolean).join(' · ')}</Text>
      {person?.bio ? <Text style={styles.bio}>{person.bio}</Text> : null}
      <ProfessionalLines profile={person?.professional} />
      {person?.joinedAt ? <Text style={styles.small}>{`Joined ${new Date(person.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · ${person.postCount ?? 0} ${person.postCount === 1 ? 'post' : 'posts'}`}</Text> : null}
      <View style={styles.actions}>
        {person && viewerId && !self ? <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(follow) }} onPress={toggleFollow} style={[styles.button, !follow && styles.primary]}>
          <Text style={follow ? styles.buttonText : styles.primaryText}>{follow === 'accepted' ? 'Following' : follow === 'pending' ? 'Requested' : 'Follow'}</Text>
        </Pressable> : null}
        {person && onMessage && !self ? <Pressable accessibilityRole="button" onPress={() => onMessage(person.handle)} style={[styles.button, styles.primary]}><Ionicons name="chatbubble-outline" size={16} color={colors.surface} /><Text style={styles.primaryText}>Message</Text></Pressable> : null}
        {external ? <Pressable accessibilityRole="link" onPress={() => { Linking.openURL(external).catch(() => undefined); }} style={styles.button}><Text style={styles.buttonText}>Open on {where}</Text><Ionicons name="open-outline" size={14} color={colors.text} /></Pressable> : null}
      </View>
      {followError ? <Text accessibilityRole="alert" style={styles.error}>{followError}</Text> : null}
      {person?.linkedAccounts.length ? <Text style={styles.small}>Also on {person.linkedAccounts.map((account) => `${networks[account.network]?.displayName ?? account.network} @${account.handle}`).join(' · ')} <Text style={styles.faint}>(listed by {person.handle})</Text></Text> : null}
    </View>

    {contacts && (card || suggestions.length || !self) ? <View style={styles.private}>
      <View style={styles.privateTitleRow}><Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} /><Text style={styles.privateTitle}>Only you see this</Text></View>
      {card ? <>
        {names.alias || card.name !== name ? <Row label="Saved as" value={card.name} styles={styles} /> : null}
        {card.nicknames.length ? <Row label="Nicknames" value={card.nicknames.join(', ')} styles={styles} /> : null}
        {card.phones.map((phone) => <Row key={phone} label="Phone" value={phone} styles={styles} />)}
        {card.emails.map((email) => <Row key={email} label="Email" value={email} styles={styles} />)}
        {card.notes ? <Row label="Notes" value={card.notes} styles={styles} /> : null}
        <Text style={styles.linkedTitle}>Linked to this contact</Text>
        {card.links.map((link) => <View key={refKey(link.ref)} style={styles.linkRow}>
          <View style={styles.linkCopy}><Text style={styles.linkName}>{describe(link.ref)}</Text><Text style={styles.linkWhy}>{link.method === 'auto' ? `Linked automatically: ${link.evidence}` : 'You linked this'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Unlink ${describe(link.ref)}`} disabled={Boolean(busy)} onPress={() => act('undo', () => contacts.undo(card.id, link.ref))} style={styles.chip}><Text style={styles.chipText}>{link.method === 'auto' ? 'Undo' : 'Unlink'}</Text></Pressable>
        </View>)}
      </> : null}
      {suggestions.map((suggestion) => {
        const suggested = contacts.cards.find((item) => item.id === suggestion.cardId);
        return suggested ? <View key={suggestion.cardId} style={styles.linkRow}>
          <View style={styles.linkCopy}><Text style={styles.linkName}>Is this {suggested.name} from your contacts?</Text><Text style={styles.linkWhy}>{suggestion.reason}</Text></View>
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('yes', () => contacts.confirm(suggestion.cardId, target.ref))} style={[styles.chip, styles.chipStrong]}><Text style={styles.chipStrongText}>Yes</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('no', () => contacts.reject(suggestion.cardId, target.ref))} style={styles.chip}><Text style={styles.chipText}>No</Text></Pressable>
        </View> : null;
      })}
      {!card && !self ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('add', () => contacts.save(newCard(name, target.ref)))} style={styles.addContact}><Ionicons name="person-add-outline" size={15} color={colors.text} /><Text style={styles.buttonText}>Add to my contacts</Text></Pressable> : null}
      {busy ? <ActivityIndicator color={colors.text} /> : null}
    </View> : null}

    {locked ? <View style={styles.lockedBox}>
      <Ionicons name="lock-closed-outline" size={22} color={colors.text} />
      <Text style={styles.lockedTitle}>This account is private</Text>
      <Text style={styles.lockedCopy}>{follow === 'pending' ? 'Your request is waiting. You’ll see their posts once they accept.' : viewerId ? 'Follow to ask to see their posts.' : 'Sign in and follow to ask to see their posts.'}</Text>
    </View> : null}

    {locked ? null : <View style={styles.timeline}>
      {filters.length > 2 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {filters.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item === 'all' ? 'All' : item === 'open-media' ? 'Open Media' : networks[item as keyof typeof networks].displayName}</Text></Pressable>)}
      </ScrollView> : null}
      {failed.length ? <Text style={styles.small}>{failed.map(sourceLabel).join(', ')} {failed.length === 1 ? 'isn’t' : 'aren’t'} loading right now.</Text> : null}
      {posts === undefined ? <ActivityIndicator style={styles.loading} color={colors.text} /> : visible.length === 0 ? <Text style={styles.empty}>{sources.length ? 'No public posts to show.' : 'This person has no public posts here.'}</Text> : visible.map((post) => <PostCard key={post.id} post={post} mode="raw" viewer={viewerId ? { id: viewerId, initials: '' } : undefined} />)}
    </View>}
  </ScrollView>;
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text selectable style={styles.rowValue}>{value}</Text></View>;
}

function describe(ref: IdentityRef): string {
  switch (ref.kind) {
    case 'open_media': return `@${ref.handle} on Open Media`;
    case 'email': return ref.address;
    case 'phone': return ref.number;
    case 'network': return `@${ref.handle} on ${networks[ref.network].displayName}`;
    case 'bridge': return `${ref.network === 'gmessages' ? 'Google Messages' : ref.network[0].toUpperCase() + ref.network.slice(1)} chat`;
  }
}

function newCard(name: string, ref: IdentityRef): ContactCard {
  const now = new Date().toISOString();
  return { id: newId(), source: 'manual', name: name.replace(/^@/, ''), nicknames: [], phones: [], emails: ref.kind === 'email' ? [ref.address] : [], notes: '', links: [{ ref, method: 'confirmed', evidence: 'You added this', linkedAt: now }], rejected: [], updatedAt: now };
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingBottom: 48 },
    bar: { paddingHorizontal: 8, paddingTop: 8 },
    barSpace: { height: 16 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
    lockedBox: { alignItems: 'center', gap: 8, marginHorizontal: 16, paddingVertical: 32, paddingHorizontal: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    lockedTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    lockedCopy: { maxWidth: 320, color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    header: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 6 },
    avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.chrome, marginBottom: 8 },
    avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
    initials: { color: colors.text, fontSize: 32, fontWeight: '600' },
    name: { color: colors.text, fontSize: 26, fontWeight: '700', textAlign: 'center' },
    meta: { color: colors.textTertiary, fontSize: 14 },
    bio: { marginTop: 6, maxWidth: 520, color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    small: { marginTop: 4, color: colors.textTertiary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    faint: { color: colors.textTertiary, fontSize: 12 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 12 },
    button: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
    buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    primary: { backgroundColor: colors.text, borderColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    private: { marginHorizontal: 16, marginBottom: 20, padding: 16, gap: 8, borderRadius: 16, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    privateTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    privateTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
    row: { flexDirection: 'row', gap: 12 },
    rowLabel: { width: 84, color: colors.textTertiary, fontSize: 14 },
    rowValue: { flex: 1, color: colors.text, fontSize: 14 },
    linkedTitle: { marginTop: 6, color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    linkCopy: { flex: 1 },
    linkName: { color: colors.text, fontSize: 14, fontWeight: '500' },
    linkWhy: { color: colors.textTertiary, fontSize: 12, marginTop: 1 },
    chip: { minHeight: 30, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: colors.border },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    chipStrong: { backgroundColor: colors.text, borderColor: colors.text },
    chipStrongText: { color: colors.surface, fontSize: 13, fontWeight: '600' },
    addContact: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
    timeline: { paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    filters: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    filter: { minHeight: 32, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 16, backgroundColor: colors.accentSoft },
    filterActive: { backgroundColor: colors.text },
    filterText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    filterTextActive: { color: colors.surface },
    loading: { padding: 32 },
    empty: { padding: 32, color: colors.textTertiary, fontSize: 14, textAlign: 'center' },
  });
}

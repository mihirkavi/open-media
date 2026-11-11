import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Loader } from './Loader';

import { FollowStatus, followPerson, loadPublicPerson, loadTimeline, PublicPerson, resumeUrl, sourcesFor, TimelineSource, unfollowPerson } from '../data/peopleService';
import { networks } from '../domain/networkPosts';
import { ContactCard, contactName, identitiesOf, IdentityRef, refKey, resolveContact, selfCard, selfLabel, shownName } from '../domain/people';
import { SocialPost } from '../domain/posts';
import { initialsFor } from '../domain/publicPosts';
import { fieldDefinition, fieldDisplay, fieldHref, publicProfileUrl } from '../domain/profileFields';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { PostCard } from './OpenMediaFeed';
import { newId, PersonTarget, usePeople } from './people';
import { ContactCardView } from './ContactCardView';
import { ProfessionalLines } from './ProfessionalLines';
import { Text } from './Text';
import { VerifiedSeal, personVerification } from './VerifiedSeal';
import { WebFeedProfile } from './WebFeedProfile';

/**
 * The unified profile (ADR 0013): one view of a person, built for the viewer. The top shows what
 * the person made public; a clearly marked section shows what only the viewer knows (their saved
 * name, numbers, notes, and how identities were linked). Below is one timeline of the person's
 * posts across Open Media and their open-network accounts.
 */
type PersonProfileProps = { target: PersonTarget; viewerId?: string; onBack?: () => void; /** Leaves the profile (a discarded new contact). */ onClose?: () => void; onMessage?: (handle: string) => void };

/** A person's profile, or a web feed's when the target is a feed (ADR 0024). */
export function PersonProfile(props: PersonProfileProps) {
  return props.target.webFeed ? <WebFeedProfile feed={props.target.webFeed} viewerId={props.viewerId} onBack={props.onBack} /> : <PersonView {...props} />;
}

function PersonView({ target, viewerId, onBack, onClose, onMessage }: PersonProfileProps) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const people = usePeople();
  const contacts = people?.contacts;
  const [person, setPerson] = useState<PublicPerson | null>();
  const [posts, setPosts] = useState<SocialPost[]>();
  const [failed, setFailed] = useState<TimelineSource[]>([]);
  const [filter, setFilter] = useState('all');
  const [follow, setFollow] = useState<FollowStatus>(null);
  const [followError, setFollowError] = useState('');
  const [editing, setEditing] = useState(Boolean(target.editing));

  const handle = target.ref.kind === 'open_media' || target.ref.kind === 'network' ? target.ref.handle.replace(/^@/, '') : undefined;
  // Your own profile, or one of your own addresses or accounts: it shows your own card (ADR 0023).
  const me = people?.me;
  // A new contact stays a draft until Done saves it (ADR 0036).
  const isDraft = Boolean(target.draft && !contacts?.cards.some((item) => item.id === target.draft?.id));
  // Which contact this is, asked the one way every screen asks (ADR 0037).
  const resolved = contacts && !isDraft ? resolveContact(contacts.cards, target) : undefined;
  const ownHandle = Boolean(me && target.ref.kind === 'open_media' && target.ref.handle.replace(/^@/, '').toLowerCase() === me.handle.toLowerCase());
  const mine = Boolean(resolved?.mine) || ownHandle;
  const card = contacts ? (isDraft ? target.draft : mine ? selfCard(contacts.cards) : resolved?.card) : undefined;
  const refs = mine ? [target.ref] : identitiesOf(card, target.ref);
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
  const publicName = target.ref.kind === 'email' || target.ref.kind === 'phone' || target.ref.kind === 'bridge' ? (target.name ?? names.name) : names.name;
  // The name the viewer saved comes first, wherever they saved one (ADR 0023); the public name follows it.
  const name = mine && me ? (target.ref.kind === 'open_media' ? person?.displayName || me.name : selfLabel(me.name)) : contactName(card) || (isDraft ? 'New contact' : publicName);
  const alsoKnownAs = !mine && card && publicName && publicName.replace(/^@/, '').toLowerCase() !== name.toLowerCase() && !publicName.startsWith('@') ? publicName : undefined;
  const avatar = person?.avatarUrl ?? target.avatarUrl;
  const where = target.ref.kind === 'network' ? networks[target.ref.network].displayName : target.ref.kind === 'open_media' ? 'Open Media' : undefined;
  const sourceLabel = (source: TimelineSource) => source.kind === 'open_media' ? 'Open Media' : networks[source.network].displayName;
  const visible = (posts ?? []).filter((post) => filter === 'all' || post.provenance.connectorId === filter);
  const filters = ['all', ...new Set(sources.map((source) => source.kind === 'open_media' ? 'open-media' : source.network))];
  const suggestions = contacts?.suggestions.filter((item) => refKey(item.ref) === refKey(target.ref)) ?? [];
  const external = target.ref.kind === 'network' ? posts?.find((post) => post.provenance.canonicalURL)?.provenance.canonicalURL : undefined;
  const self = Boolean(viewerId && person?.id === viewerId) || mine;
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


  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {onBack ? <View style={styles.bar}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable></View> : <View style={styles.barSpace} />}

    <View style={styles.header}>
      <VerifiedSeal verification={person?.verified ? personVerification(name) : undefined} size={88}>{avatar ? <Image accessibilityIgnoresInvertColors source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.initials}>{initialsFor(name.replace(/^@/, '')) || '?'}</Text></View>}</VerifiedSeal>
      <View style={styles.nameLine}><Text accessibilityRole="header" style={styles.name}>{name}</Text></View>
      <Text style={styles.meta}>{[alsoKnownAs, handle ? `@${handle}` : undefined, where].filter(Boolean).join(' · ')}</Text>
      {person?.bio ? <Text style={styles.bio}>{person.bio}</Text> : null}
      <ProfessionalLines profile={person?.professional} />
      {person?.fields.length ? <View style={styles.fields}>{person.fields.map((item) => {
        const href = fieldHref(item.field, item.value);
        const label = fieldDefinition(item.field)?.label ?? item.field;
        return <Text key={item.field} style={styles.small}>{label}: {href ? <Text accessibilityRole="link" onPress={() => { Linking.openURL(href).catch(() => undefined); }} style={styles.fieldLink}>{fieldDisplay(item.field, item.value)}</Text> : fieldDisplay(item.field, item.value)}</Text>;
      })}</View> : null}
      {handle && target.ref.kind === 'open_media' ? <Text style={styles.small}><Text accessibilityRole="link" onPress={() => { Linking.openURL(publicProfileUrl(handle)).catch(() => undefined); }} style={styles.fieldLink}>{publicProfileUrl(handle).replace('https://', '')}</Text>{person?.professional ? <> · <Text accessibilityRole="link" onPress={() => { Linking.openURL(resumeUrl(handle)).catch(() => undefined); }} style={styles.fieldLink}>Resume</Text></> : null}</Text> : null}
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

    {contacts ? <ContactCardView
      contacts={contacts}
      card={card}
      self={self}
      meName={me?.name}
      target={target}
      publicName={publicName}
      suggestions={suggestions}
      editing={editing}
      onEditing={setEditing}
      draft={isDraft}
      onDiscard={() => (onClose ?? onBack)?.()}
      onAddSelf={async () => { if (!me) return; await contacts.save(newSelfCard(me)); setEditing(true); }}
      onAddNew={async () => { await contacts.save(newCard(publicName, target.ref)); setEditing(true); }}
    /> : null}

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
      {posts === undefined ? <Loader style={styles.loading} color={colors.text} /> : visible.length === 0 ? <Text style={styles.empty}>{sources.length ? 'No public posts to show.' : 'This person has no public posts here.'}</Text> : visible.map((post) => <PostCard key={post.id} post={post} mode="raw" viewer={viewerId ? { id: viewerId, initials: '' } : undefined} />)}
    </View>}
  </ScrollView>;
}



/** Your own card: it starts with your Open Media handle, and its name always follows your profile. */
function newSelfCard(me: { handle: string; name: string }): ContactCard {
  return { id: newId(), source: 'manual', self: true, name: me.name, nicknames: [], phones: [], emails: [], handles: [{ network: 'open_media', handle: me.handle }], notes: '', links: [], rejected: [], updatedAt: new Date().toISOString() };
}

/**
 * A new contact for this identity, holding it as an email, number or handle so it can be edited.
 * When all we know is an address or number, the name starts empty, so the editor asks for one.
 */
function newCard(shown: string, ref: IdentityRef): ContactCard {
  const now = new Date().toISOString();
  const name = contactName({ name: shown.replace(/^@/, '') } as ContactCard);
  const handles = ref.kind === 'open_media' ? [{ network: 'open_media' as const, handle: ref.handle }]
    : ref.kind === 'network' ? [{ network: ref.network, handle: ref.handle }]
    : ref.kind === 'bridge' ? [{ network: ref.network, handle: ref.id }] : [];
  return { id: newId(), source: 'manual', name, nicknames: [], phones: ref.kind === 'phone' ? [ref.number] : ref.kind === 'bridge' && ref.phone ? [ref.phone] : [], emails: ref.kind === 'email' ? [ref.address] : [], handles, notes: '', links: [{ ref, method: 'confirmed', evidence: 'You added this', linkedAt: now }], rejected: [], updatedAt: now };
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
    fields: { marginTop: 8, alignItems: 'center', gap: 3 },
    fieldLink: { color: colors.text, textDecorationLine: 'underline' },
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
    grow: { flex: 1 },
    selfIntro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    nameNudge: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    nameNudgeText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    nameNudgeStrong: { color: colors.text, fontWeight: '600' },
    edit: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    editText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    addRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, rowGap: 4 },
    quietText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    picker: { gap: 2, marginTop: 4, padding: 6, borderRadius: 14, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    pickerInput: { minHeight: 40, paddingHorizontal: 10, color: colors.text, fontSize: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, outlineStyle: 'none' } as object,
    pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 8, borderRadius: 10 },
    pickerFace: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
    pickerInitials: { color: colors.text, fontSize: 12, fontWeight: '700' },
    pickerCancel: { alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 6 },
    pressed: { opacity: 0.6 },
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

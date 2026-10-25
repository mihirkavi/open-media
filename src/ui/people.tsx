import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { readDeviceContacts } from '../contacts/deviceContacts';
import { loadContactCards, loadPublicPerson, PublicPerson, saveContactCards } from '../data/peopleService';
import { networks } from '../domain/networkPosts';
import { ContactCard, confirmLink, Encounter, IdentityRef, importDeviceContacts, LinkSuggestion, reconcile, refKey, rejectSuggestion, unlink } from '../domain/people';
import { SocialPost } from '../domain/posts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Portal } from './Portal';
import { Text } from './Text';
import { VerifiedTick } from './VerifiedTick';

/**
 * Opening a person from anywhere (ADR 0013): every name and avatar in Feed, Clips, Messages and
 * Search is a PersonLink. Tapping opens the unified profile; on desktop web, hovering briefly
 * shows a small preview. Keyboard and screen readers use the same link.
 */
export interface PersonTarget { ref: IdentityRef; name?: string; avatarUrl?: string }

export interface ContactsState {
  cards: ContactCard[];
  suggestions: LinkSuggestion[];
  ready: boolean;
  error: string;
  confirm: (cardId: string, ref: IdentityRef) => Promise<void>;
  reject: (cardId: string, ref: IdentityRef) => Promise<void>;
  undo: (cardId: string, ref: IdentityRef) => Promise<void>;
  save: (card: ContactCard) => Promise<void>;
  importFromDevice: () => Promise<number>;
}

interface PeopleValue { open: (target: PersonTarget) => void; contacts?: ContactsState }

const PeopleContext = createContext<PeopleValue | null>(null);

export function PeopleProvider({ value, children }: PropsWithChildren<{ value: PeopleValue }>) {
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople(): PeopleValue | null {
  return useContext(PeopleContext);
}

export function targetForPost(post: SocialPost): PersonTarget {
  const handle = post.author.handle.replace(/^@/, '');
  const network = post.provenance.connectorId;
  const ref: IdentityRef = network === 'open-media' ? { kind: 'open_media', handle } : { kind: 'network', network: network as keyof typeof networks, handle };
  return { ref, name: post.author.displayName, avatarUrl: post.author.avatarUrl };
}

/** The viewer's encrypted contacts, kept in sync and reconciled with the people they encounter. */
export function useContactsStore(enabled: boolean, encounters: Encounter[]): ContactsState {
  const [cards, setCards] = useState<ContactCard[]>([]);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const cardsRef = useRef<ContactCard[]>([]);

  const apply = useCallback(async (next: ContactCard[], changed: ContactCard[]) => {
    cardsRef.current = next;
    setCards(next);
    if (changed.length) await saveContactCards(changed).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not save your contacts.'));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadContactCards().then((loaded) => { if (active) { cardsRef.current = loaded; setCards(loaded); setReady(true); } }).catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : 'Could not load your contacts.'); setReady(true); } });
    return () => { active = false; };
  }, [enabled]);

  // Exact email or phone matches link on their own; anything weaker waits for the viewer.
  const encounterKey = encounters.map((item) => refKey(item.ref)).join('|');
  useEffect(() => {
    if (!enabled || !ready || !cardsRef.current.length || !encounters.length) return;
    const before = new Map(cardsRef.current.map((card) => [card.id, card.links.length]));
    const result = reconcile(cardsRef.current, encounters);
    setSuggestions(result.suggestions);
    const changed = result.cards.filter((card) => before.get(card.id) !== card.links.length);
    if (changed.length) apply(result.cards, changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, encounterKey]);

  const update = useCallback(async (cardId: string, change: (card: ContactCard) => ContactCard) => {
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card) return;
    const next = change(card);
    setSuggestions((current) => current.filter((item) => item.cardId !== cardId || next.links.every((link) => refKey(link.ref) !== refKey(item.ref)) && !next.rejected.includes(refKey(item.ref))));
    await apply(cardsRef.current.map((item) => item.id === cardId ? next : item), [next]);
  }, [apply]);

  return {
    cards, suggestions, ready, error,
    confirm: (cardId, ref) => update(cardId, (card) => confirmLink(card, ref)),
    reject: (cardId, ref) => update(cardId, (card) => rejectSuggestion(card, ref)),
    undo: (cardId, ref) => update(cardId, (card) => unlink(card, ref)),
    save: async (card) => apply([...cardsRef.current.filter((item) => item.id !== card.id), card], [card]),
    importFromDevice: async () => {
      const snapshots = await readDeviceContacts();
      const next = importDeviceContacts(cardsRef.current, snapshots, newId);
      await apply(next, next);
      return snapshots.length;
    },
  };
}

export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function PersonLink({ target, children, style, label }: PropsWithChildren<{ target: PersonTarget; style?: StyleProp<ViewStyle>; label?: string }>) {
  const people = usePeople();
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const anchor = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [preview, setPreview] = useState<{ x: number; y: number }>();
  if (!people) return <View style={style}>{children}</View>;
  const hoverable = Platform.OS === 'web';
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => anchor.current?.measureInWindow((x, y, _width, height) => setPreview({ x, y: y + height + 6 })), 450);
  };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(undefined), 150); };
  return <View ref={anchor} style={style}>
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label ?? `Open ${target.name ?? 'profile'}`}
      onPress={() => { clearTimeout(timer.current); setPreview(undefined); people.open(target); }}
      onHoverIn={hoverable ? show : undefined}
      onHoverOut={hoverable ? hide : undefined}
      style={styles.link}
    >
      {children}
    </Pressable>
    {preview ? <Portal><View onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={hide} style={[styles.preview, { left: preview.x, top: preview.y } as object]}>
      <ProfilePreview target={target} onOpen={() => { setPreview(undefined); people.open(target); }} />
    </View></Portal> : null}
  </View>;
}

/** The small desktop preview: who it is, where they are, and a way to open the full profile. */
function ProfilePreview({ target, onOpen }: { target: PersonTarget; onOpen: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [person, setPerson] = useState<PublicPerson>();
  useEffect(() => {
    if (target.ref.kind !== 'open_media') return;
    loadPublicPerson(target.ref.handle).then(setPerson).catch(() => undefined);
  }, [target.ref]);
  const where = target.ref.kind === 'network' ? networks[target.ref.network].displayName : target.ref.kind === 'open_media' ? 'Open Media' : '';
  const handle = target.ref.kind === 'open_media' || target.ref.kind === 'network' ? `@${target.ref.handle.replace(/^@/, '')}` : '';
  const avatar = person?.avatarUrl ?? target.avatarUrl;
  const name = person?.displayName ?? target.name ?? handle;
  return <View style={styles.card}>
    <View style={styles.cardTop}>
      {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.initials}>{(name.replace(/^@/, '')[0] ?? '?').toUpperCase()}</Text></View>}
      <View style={styles.cardCopy}>
        <View style={styles.nameLine}><Text numberOfLines={1} style={[styles.name, styles.shrink]}>{name}</Text>{person?.verified ? <VerifiedTick size={15} /> : null}</View>
        <Text numberOfLines={1} style={styles.meta}>{[handle, where].filter(Boolean).join(' · ')}</Text>
      </View>
    </View>
    {person?.bio ? <Text numberOfLines={3} style={styles.bio}>{person.bio}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.open}><Text style={styles.openText}>View profile</Text></Pressable>
  </View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    link: { cursor: 'pointer' } as object,
    preview: { position: 'fixed', zIndex: 1000 } as object,
    card: { width: 300, padding: 16, gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, boxShadow: '0 12px 32px rgba(0,0,0,0.12)' } as object,
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardCopy: { flex: 1 },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.chrome },
    avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
    initials: { color: colors.text, fontSize: 16, fontWeight: '600' },
    name: { color: colors.text, fontSize: 16, fontWeight: '700' },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    shrink: { flexShrink: 1 },
    meta: { marginTop: 2, color: colors.textTertiary, fontSize: 13 },
    bio: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    open: { alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 17, backgroundColor: colors.text },
    openText: { color: colors.surface, fontSize: 13, fontWeight: '600' },
  });
}

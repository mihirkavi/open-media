import Ionicons from './Icon';
import { PropsWithChildren, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from './Text';

import { deleteCurrentAccount, exportCurrentAccountData, loadShareReadReceipts, setShareReadReceipts } from '../data/openMediaService';
import { searchSettings, SettingIndexEntry, settingForSection, settingPath, SettingsScreen } from '../domain/settings';
import { languageName } from '../domain/translation';
import type { SocialPost } from '../domain/posts';
import { AppearanceMode, ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { AiModelsSettings } from './AiModelsSettings';
import { CrossPostingSettings } from './CrossPostingSettings';
import { FeedAlgorithmSettings } from './FeedAlgorithmSettings';
import { IdentitySettings } from './IdentitySettings';
import { lazyComponent } from './lazyComponent';
import { Loader } from './Loader';
import { OndcStoreSettings } from './OndcStoreSettings';
import { FeedPicker } from './OpenMediaFeed';
import { PaymentsSettings } from './PaymentsSettings';
import { SettingAnchor, SettingAnchorScope, SettingFocus } from './SettingAnchor';
import { SignInSecuritySettings } from './SignInSecuritySettings';
import type { FeedLenses } from './useFeedLenses';
import { useTranslationPreferences } from './useTranslation';

// Pages opened from a row load only then.
const ConnectionSettings = lazyComponent(() => import('./SettingsView').then((module) => module.SettingsView));
const MissionPage = lazyComponent(() => import('./MissionPage').then((module) => module.MissionPage));
const DevelopersPage = lazyComponent(() => import('./DevelopersPage').then((module) => module.DevelopersPage));

type Icon = keyof typeof Ionicons.glyphMap;

/** Each Settings page as it appears in the list on the first page. */
const screens: Record<Exclude<SettingsScreen, 'home'>, { title: string; icon: Icon; summary: string }> = {
  account: { title: 'Account', icon: 'key-outline', summary: 'Password, passkeys, export or delete' },
  privacy: { title: 'Privacy and identity', icon: 'shield-outline', summary: 'Who sees your posts, your name, read receipts' },
  payments: { title: 'Payments', icon: 'wallet-outline', summary: 'Card payments, wallets and tips' },
  store: { title: 'Sell on ONDC', icon: 'storefront-outline', summary: 'Your store in India’s open network' },
  algorithm: { title: 'Your algorithm', icon: 'options-outline', summary: 'How your feed is ranked, in plain words' },
  'cross-posting': { title: 'Cross-posting', icon: 'share-social-outline', summary: 'Post to Bluesky, Mastodon, X, LinkedIn and more' },
  connections: { title: 'Email and chat apps', icon: 'mail-outline', summary: 'Mailboxes and chat apps in Messages' },
  ai: { title: 'Open Media AI', icon: 'sparkles-outline', summary: 'Your own keys and which model answers' },
  mission: { title: 'Our mission', icon: 'information-circle-outline', summary: 'Why Open Media exists' },
  developers: { title: 'Developers and agents', icon: 'code-slash-outline', summary: 'APIs, MCP servers and your token' },
};

const groups: { label: string; screens: Exclude<SettingsScreen, 'home'>[]; signedIn?: boolean }[] = [
  { label: 'You', screens: ['account', 'privacy', 'payments', 'store'], signedIn: true },
  { label: 'Feed and posting', screens: ['algorithm', 'cross-posting'] },
  { label: 'Connections and AI', screens: ['connections', 'ai'] },
  { label: 'About', screens: ['mission', 'developers'] },
];

export interface OpenMediaSettingsProps {
  lenses: FeedLenses;
  signedIn: boolean;
  /** Your handle, for Privacy and identity. */
  handle?: string;
  posts?: SocialPost[];
  onMailSynced: () => void;
  /** A setting to show: from Search, Open Media AI or a link (ADR 0028). */
  focus?: SettingFocus;
  /** Opens a setting that lives elsewhere, such as Profile. */
  onOpenSetting?: (id: string) => void;
  onSignOut?: () => Promise<void>;
  onAccountDeleted?: () => void;
}

/**
 * Settings: everyday controls first (appearance, default feed, translation), then one row per page,
 * grouped. Every setting is at most one tap from here, and Settings' search (or Search anywhere)
 * opens the exact page and outlines the setting.
 */
export function OpenMediaSettings(props: OpenMediaSettingsProps) {
  const { focus } = props;
  const [screen, setScreen] = useState<SettingsScreen>('home');
  // The section to scroll to on the page that opens; `at` makes a repeat request count again.
  const [target, setTarget] = useState<{ anchor?: string; at: number }>();
  const open = (entry: SettingIndexEntry) => {
    if (entry.page !== 'settings') { props.onOpenSetting?.(entry.id); return; }
    setScreen(entry.screen ?? 'home');
    setTarget({ anchor: entry.anchor, at: Date.now() });
  };
  useEffect(() => {
    const entry = focus ? settingForSection(focus.id) : undefined;
    if (entry) open(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.at]);
  const goHome = () => { setScreen('home'); setTarget(undefined); };
  // Android's back button leaves a Settings page before it leaves Settings.
  useEffect(() => {
    if (screen === 'home' || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goHome(); return true; });
    return () => subscription.remove();
  }, [screen]);

  if (screen === 'connections') return <ConnectionSettings onClose={goHome} onMailSynced={props.onMailSynced} focus={target?.anchor ? { anchor: target.anchor, at: target.at } : undefined} />;
  if (screen === 'mission') return <MissionPage chrome="app" onBack={goHome} />;
  if (screen === 'developers') return <DevelopersPage chrome="app" signedIn onBack={goHome} />;
  if (screen === 'home') return <Home {...props} target={target} onOpen={open} onScreen={(next) => { setScreen(next); setTarget(undefined); }} />;
  const info = screens[screen];
  return <Page title={info.title} target={target} onBack={goHome}>
    {screen === 'account' ? <AccountPage {...props} /> : null}
    {screen === 'privacy' ? <PrivacyPage handle={props.handle} signedIn={props.signedIn} /> : null}
    {screen === 'payments' ? <PaymentsSettings titled={false} /> : null}
    {screen === 'store' ? <OndcStoreSettings titled={false} /> : null}
    {screen === 'algorithm' ? <FeedAlgorithmSettings lenses={props.lenses} signedIn={props.signedIn} posts={props.posts} /> : null}
    {screen === 'cross-posting' ? <Card><CrossPostingSettings /></Card> : null}
    {screen === 'ai' ? <Card><AiModelsSettings signedIn={props.signedIn} /></Card> : null}
  </Page>;
}

function Home({ lenses, signedIn, onSignOut, target, onOpen, onScreen }: OpenMediaSettingsProps & { target?: { anchor?: string; at: number }; onOpen: (entry: SettingIndexEntry) => void; onScreen: (screen: Exclude<SettingsScreen, 'home'>) => void }) {
  const { colors, appearance, setAppearance } = useOpenMediaTheme(); const styles = useStyles();
  const translation = useTranslationPreferences();
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim() ? searchSettings(query) : []), [query]);
  const scroller = useRef<ScrollView>(null);
  const [signingOut, setSigningOut] = useState(false);
  return <ScrollView ref={scroller} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <SettingAnchorScope scroller={scroller} anchor={target?.anchor} at={target?.at}>
      <Text accessibilityRole="header" style={styles.title}>Settings</Text>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput accessibilityLabel="Search settings" value={query} onChangeText={setQuery} placeholder="Search settings" placeholderTextColor={colors.textTertiary} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => { if (results[0]) onOpen(results[0]); }} style={styles.searchInput} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={colors.textTertiary} /></Pressable> : null}
      </View>

      {query.trim() ? <>
        {results.length ? <Card>
          {results.map((entry, index) => <Row key={entry.id} first={index === 0} icon={iconFor(entry)} title={entry.title} subtitle={settingPath(entry)} hint={`Opens ${settingPath(entry)}`} onPress={() => onOpen(entry)} />)}
        </Card> : <Text style={styles.empty}>No setting matches “{query.trim()}”. Try other words, or ask Open Media AI in Search.</Text>}
      </> : <>
        <Card>
          <SettingAnchor id="appearance">
            <View style={[styles.row, styles.controlRow]}>
              <IconTile icon="contrast-outline" />
              <Text style={[styles.rowTitle, styles.grow]}>Appearance</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={styles.segment}>
                {(['system', 'light', 'dark'] as AppearanceMode[]).map((choice) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: appearance === choice }} onPress={() => setAppearance(choice)} style={[styles.segmentItem, appearance === choice && styles.segmentActive]}>
                  <Text style={[styles.segmentText, appearance === choice && styles.segmentTextActive]}>{choice === 'system' ? 'Auto' : choice === 'light' ? 'Light' : 'Dark'}</Text>
                </Pressable>)}
              </View>
            </View>
          </SettingAnchor>
          <SettingAnchor id="default-feed">
            <View style={[styles.row, styles.controlRow, styles.divider]}>
              <IconTile icon="newspaper-outline" />
              <Text style={[styles.rowTitle, styles.grow]}>Default feed</Text>
              <FeedPicker value={lenses.lens.id} lenses={lenses.lenses} onChange={lenses.choose} />
            </View>
          </SettingAnchor>
          <SettingAnchor id="translation">
            <View style={[styles.row, styles.divider]}>
              <IconTile icon="language" />
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>Translate automatically</Text>
                <Text style={styles.rowSubtitle}>Other languages appear in {languageName(translation.preferences.target)}, with the original a tap away.</Text>
              </View>
              <Switch accessibilityLabel="Translate automatically" value={translation.preferences.auto} onValueChange={(auto) => translation.setPreferences({ auto })} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} />
            </View>
          </SettingAnchor>
        </Card>

        {groups.filter((group) => signedIn || !group.signedIn).map((group) => <View key={group.label}>
          <Text accessibilityRole="header" style={styles.groupLabel}>{group.label}</Text>
          <Card>
            {group.screens.map((id, index) => <Row key={id} first={index === 0} icon={screens[id].icon} title={screens[id].title} subtitle={id === 'algorithm' ? `${lenses.lens.name} · ${screens[id].summary}` : screens[id].summary} onPress={() => onScreen(id)} />)}
          </Card>
        </View>)}

        {onSignOut ? <SettingAnchor id="sign-out"><View style={styles.signOut}><Card>
          <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => { setSigningOut(true); onSignOut().finally(() => setSigningOut(false)); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <IconTile icon="log-out-outline" />
            <Text style={[styles.rowTitle, styles.grow]}>Sign out</Text>
            {signingOut ? <Loader color={colors.text} /> : null}
          </Pressable>
        </Card></View></SettingAnchor> : null}
      </>}
    </SettingAnchorScope>
  </ScrollView>;
}

/** Account: sign-in and security, a copy of your data, and deleting the account. */
function AccountPage({ signedIn, onAccountDeleted }: OpenMediaSettingsProps) {
  const { colors } = useOpenMediaTheme(); const styles = useStyles();
  const [exporting, setExporting] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false); const [deleting, setDeleting] = useState(false); const [error, setError] = useState('');
  if (!signedIn) return <Text style={styles.empty}>Sign in to manage your password, passkeys and data.</Text>;
  const exportAccount = async () => {
    setExporting(true); setError('');
    try {
      const json = JSON.stringify(await exportCurrentAccountData(), null, 2);
      if (Platform.OS === 'web') downloadJSON(json); else await Share.share({ title: 'Open Media data export', message: json });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Data export failed.'); } finally { setExporting(false); }
  };
  const removeAccount = async () => {
    setDeleting(true); setError('');
    try { await deleteCurrentAccount(); setDeleteOpen(false); onAccountDeleted?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Account deletion failed.'); } finally { setDeleting(false); }
  };
  return <>
    <SettingAnchor id="security"><SignInSecuritySettings /></SettingAnchor>
    <SettingAnchor id="your-data">
      <Text accessibilityRole="header" style={styles.groupLabel}>Your data</Text>
      <Card>
        <Pressable accessibilityRole="button" disabled={exporting} onPress={exportAccount} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <IconTile icon="download-outline" />
          <View style={styles.grow}><Text style={styles.rowTitle}>Export my data</Text><Text style={styles.rowSubtitle}>A readable copy of your account. Encrypted mailbox passwords are never included.</Text></View>
          {exporting ? <Loader color={colors.text} /> : null}
        </Pressable>
      </Card>
    </SettingAnchor>
    {error && !deleteOpen ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {onAccountDeleted ? <SettingAnchor id="delete-account"><View style={styles.signOut}><Card>
      <Pressable accessibilityRole="button" onPress={() => { setError(''); setDeleteOpen(true); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <IconTile icon="trash-outline" danger />
        <Text style={[styles.rowTitle, styles.danger, styles.grow]}>Delete account</Text>
      </Pressable>
    </Card></View></SettingAnchor> : null}
    <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => !deleting && setDeleteOpen(false)}>
      <View style={styles.backdrop}><View style={styles.dialog}>
        <Text accessibilityRole="header" style={styles.dialogTitle}>Delete your Open Media account?</Text>
        <Text style={styles.dialogCopy}>This permanently removes your profile, private mailbox data, authored messages, memberships, and direct conversations. This cannot be undone.</Text>
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={deleting} onPress={removeAccount} style={styles.dialogDelete}>{deleting ? <Loader color="#FFFFFF" /> : <Text style={styles.dialogDeleteText}>Delete account permanently</Text>}</Pressable>
        <Pressable accessibilityRole="button" disabled={deleting} onPress={() => setDeleteOpen(false)} style={styles.dialogCancel}><Text style={styles.dialogCancelText}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}

/** Privacy and identity: who sees your posts, your name, followers, and read receipts. */
function PrivacyPage({ handle, signedIn }: { handle?: string; signedIn: boolean }) {
  const { colors } = useOpenMediaTheme(); const styles = useStyles();
  const [share, setShare] = useState<boolean>(); const [status, setStatus] = useState('');
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    loadShareReadReceipts().then((value) => { if (active) setShare(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [signedIn]);
  if (!signedIn || !handle) return <Text style={styles.empty}>Sign in to choose who sees your posts and whether people see when you’ve read their messages.</Text>;
  const change = async (next: boolean) => {
    const before = share; setShare(next); setStatus('');
    try { setShare(await setShareReadReceipts(next)); } catch (reason) { setShare(before); setStatus(reason instanceof Error ? reason.message : 'That didn’t save. Try again.'); }
  };
  return <>
    <SettingAnchor id="identity"><IdentitySettings handle={handle} titled={false} /></SettingAnchor>
    <SettingAnchor id="read-receipts">
      <Text accessibilityRole="header" style={styles.groupLabel}>Messages</Text>
      <Card>
        <View style={styles.row}>
          <IconTile icon="checkmark-done-outline" />
          <View style={styles.grow}><Text style={styles.rowTitle}>Read receipts</Text><Text style={styles.rowSubtitle}>{share === false ? 'Off: people don’t see when you read their messages, and you don’t see theirs. “Delivered” still shows.' : 'On: people see “Read” when you’ve opened their messages, and you see when they read yours.'}</Text></View>
          {share === undefined ? <Loader color={colors.text} /> : <Switch accessibilityLabel="Read receipts" value={share} onValueChange={(next) => { change(next).catch(() => undefined); }} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} />}
        </View>
      </Card>
      {status ? <Text accessibilityRole="alert" style={styles.error}>{status}</Text> : null}
    </SettingAnchor>
  </>;
}

/** A Settings page: a back button to Settings, the page's title, then its sections. */
function Page({ title, target, onBack, children }: PropsWithChildren<{ title: string; target?: { anchor?: string; at: number }; onBack: () => void }>) {
  const { colors } = useOpenMediaTheme(); const styles = useStyles();
  const scroller = useRef<ScrollView>(null);
  return <ScrollView ref={scroller} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <SettingAnchorScope scroller={scroller} anchor={target?.anchor} at={target?.at}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Settings" hitSlop={8} onPress={onBack} style={styles.back}>
        <Ionicons name="chevron-back" size={20} color={colors.text} />
        <Text style={styles.backText}>Settings</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
      {children}
    </SettingAnchorScope>
  </ScrollView>;
}

function Card({ children }: { children: ReactNode }) { const styles = useStyles(); return <View style={styles.card}>{children}</View>; }

function IconTile({ icon, danger }: { icon: Icon; danger?: boolean }) {
  const { colors } = useOpenMediaTheme(); const styles = useStyles();
  return <View style={styles.tile}><Ionicons name={icon} size={17} color={danger ? colors.danger : colors.text} /></View>;
}

/** A row that opens a page: icon, title, one line of what's there, and a chevron. */
function Row({ icon, title, subtitle, hint, first, onPress }: { icon: Icon; title: string; subtitle?: string; hint?: string; first?: boolean; onPress: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [styles.row, !first && styles.divider, pressed && styles.pressed]}>
    <IconTile icon={icon} />
    <View style={styles.grow}>
      <Text style={styles.rowTitle}>{title}</Text>
      {subtitle ? <Text numberOfLines={2} style={styles.rowSubtitle}>{subtitle}</Text> : null}
    </View>
    <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
  </Pressable>;
}

function iconFor(entry: SettingIndexEntry): Icon {
  if (entry.page !== 'settings') return entry.page === 'edit-profile' ? 'person-outline' : 'people-outline';
  if (!entry.screen || entry.screen === 'home') return entry.anchor === 'appearance' ? 'contrast-outline' : entry.anchor === 'translation' ? 'language' : entry.anchor === 'sign-out' ? 'log-out-outline' : 'newspaper-outline';
  return screens[entry.screen].icon;
}

function downloadJSON(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `open-media-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click(); URL.revokeObjectURL(url);
}

function useStyles() { const { colors } = useOpenMediaTheme(); return useMemo(() => createStyles(colors), [colors]); }

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 72 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  pageTitle: { marginTop: 6, marginBottom: 12, color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
  back: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6, paddingRight: 8 },
  backText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  search: { minHeight: 44, marginTop: 14, marginBottom: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.chrome },
  searchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object,
  empty: { marginTop: 20, color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  groupLabel: { marginTop: 26, marginBottom: 8, marginLeft: 4, color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  card: { marginTop: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlRow: { flexWrap: 'wrap', rowGap: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.chrome },
  grow: { flex: 1, minWidth: 120 },
  tile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSubtitle: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  segment: { flexDirection: 'row', padding: 3, gap: 2, borderRadius: 10, backgroundColor: colors.chrome },
  segmentItem: { minHeight: 32, minWidth: 56, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: colors.text },
  signOut: { marginTop: 12 },
  danger: { color: colors.danger },
  error: { marginTop: 10, color: colors.danger, fontSize: 13, lineHeight: 18 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.5)' },
  dialog: { width: '100%', maxWidth: 440, padding: 24, borderRadius: 20, backgroundColor: colors.surface },
  dialogTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  dialogCopy: { marginTop: 10, color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  dialogDelete: { minHeight: 48, marginTop: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.danger },
  dialogDeleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  dialogCancel: { minHeight: 46, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  dialogCancelText: { color: colors.text, fontSize: 14, fontWeight: '700' },
}); }

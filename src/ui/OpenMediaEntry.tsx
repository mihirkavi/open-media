import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { completeSignInURL, getSupabaseClient, localAutoSignInAvailable, sendSignInLink, signOut, verifySignInCode, waitForLocalSignInCode } from '../auth/supabase';
import { getCurrentProfile, OpenMediaProfile, saveCurrentProfile } from '../data/openMediaService';
import { FeedMode } from '../domain/posts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { BrandMark } from './BrandMark';
import { DevelopersPage } from './DevelopersPage';
import { LandingPage, PublicPage } from './LandingPage';
import { MissionPage } from './MissionPage';
import { OpenMediaApp } from './OpenMediaApp';
import { FeedView } from './OpenMediaFeed';
import { SearchView } from './SearchView';
import { useMixedFeed } from './useMixedFeed';

export function OpenMediaEntry() {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session>();
  const [profile, setProfile] = useState<OpenMediaProfile>();
  const [loading, setLoading] = useState(Boolean(client));
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  // The person whose profile is already on screen. Supabase re-announces the
  // session (e.g. when the browser tab regains focus or the token refreshes);
  // for the same person that must not reload the app or lose your place.
  const loadedUserId = useRef<string | undefined>(undefined);
  const matrixAvailable = __DEV__ && Boolean(process.env.EXPO_PUBLIC_MATRIX_BRIDGE_URL);
  const [matrixDemo, setMatrixDemo] = useState(matrixAvailable && process.env.EXPO_PUBLIC_MATRIX_AUTO_CONNECT === '1');

  useEffect(() => {
    if (!client) return;
    let active = true;
    let request = 0;
    const acceptSession = async (nextSession?: Session | null) => {
      if (!active) return;
      // Same person (already loaded or loading): keep the app as it is.
      if (nextSession && nextSession.user.id === loadedUserId.current) {
        setSession(nextSession);
        return;
      }
      const currentRequest = ++request;
      loadedUserId.current = nextSession?.user.id;
      setLoading(true);
      setLoadFailed(false);
      setError('');
      setSession(nextSession ?? undefined);
      setProfile(undefined);
      try {
        if (nextSession) {
          const nextProfile = await getCurrentProfile(nextSession);
          if (active && currentRequest === request) setProfile(nextProfile);
        }
      } catch (reason) {
        if (active && currentRequest === request) {
          loadedUserId.current = undefined;
          setError(messageFor(reason));
          setLoadFailed(true);
        }
      } finally {
        if (active && currentRequest === request) setLoading(false);
      }
    };
    const consumeURL = (url: string | null) => {
      if (!url) return;
      completeSignInURL(url).catch((reason) => { setError(messageFor(reason)); setSigningIn(true); });
    };
    const initialURL = Platform.OS === 'web' && typeof window !== 'undefined'
      ? Promise.resolve(window.location.href)
      : Linking.getInitialURL();
    initialURL.then(consumeURL);
    const linkSubscription = Linking.addEventListener('url', ({ url }) => consumeURL(url));
    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) throw sessionError;
      return acceptSession(data.session);
    }).catch((reason) => { if (active) { setError(messageFor(reason)); setLoadFailed(true); setLoading(false); } });
    const authSubscription = client.auth.onAuthStateChange((_event, nextSession) => {
      acceptSession(nextSession).catch((reason) => setError(messageFor(reason)));
    }).data.subscription;
    return () => { active = false; linkSubscription.remove(); authSubscription.unsubscribe(); };
  }, [client, retryVersion]);

  if (matrixDemo) return <OpenMediaApp currentUserId="@openmedia:localhost" messageMode="matrix" profile={{ id: '@openmedia:localhost', handle: 'openmedia', displayName: 'Open Media Tester', bio: 'Local Matrix bridge sandbox' }} onSignOut={async () => setMatrixDemo(false)} />;
  if (!client) return <ConfigurationRequired onMatrixDemo={matrixAvailable ? () => setMatrixDemo(true) : undefined} />;
  if (loading) return <CenteredStatus label="Opening Open Media…" />;
  if (loadFailed) return <RetryStatus error={error} onRetry={() => setRetryVersion((value) => value + 1)} onSignOut={session ? async () => { await signOut(); setSession(undefined); setLoadFailed(false); } : undefined} />;
  if (!session && !signingIn) return <PublicSite onSignIn={() => { setError(''); setSigningIn(true); }} />;
  if (!session) return <SignInScreen error={error} onError={setError} onBack={() => setSigningIn(false)} onMatrixDemo={matrixAvailable ? () => setMatrixDemo(true) : undefined} />;
  if (!profile) return <ProfileSetup session={session} error={error} onError={setError} onComplete={(nextProfile) => { loadedUserId.current = session.user.id; setProfile(nextProfile); }} onSignOut={async () => { await signOut(); setSession(undefined); }} />;
  return <OpenMediaApp currentUserId={session.user.id} profile={profile} onSignOut={async () => { await signOut(); setSession(undefined); setProfile(undefined); }} onAccountDeleted={() => { setSession(undefined); setProfile(undefined); }} />;
}

const publicPages: PublicPage[] = ['landing', 'feed', 'mission', 'developers'];

function pageFromHash(): PublicPage {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'feed';
  const hash = window.location.hash.replace('#', '') as PublicPage;
  return publicPages.includes(hash) && hash !== 'landing' ? hash : 'landing';
}

/**
 * Signed out. On the web this is the website: the landing page at /, then #feed, #mission and
 * #developers, each a real link that survives reloads. The phone apps open straight to the feed.
 */
function PublicSite({ onSignIn }: { onSignIn: () => void }) {
  const [page, setPage] = useState<PublicPage>(pageFromHash);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (next: PublicPage) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.hash = next === 'landing' ? '' : next;
      window.scrollTo?.(0, 0);
    }
    setPage(Platform.OS === 'web' || next !== 'landing' ? next : 'feed');
  };
  if (page === 'landing') return <LandingPage onNavigate={navigate} onSignIn={onSignIn} />;
  if (page === 'mission') return <MissionPage chrome={Platform.OS === 'web' ? 'public' : 'app'} onNavigate={navigate} onSignIn={onSignIn} onBack={() => navigate('feed')} />;
  if (page === 'developers') return <DevelopersPage chrome={Platform.OS === 'web' ? 'public' : 'app'} onNavigate={navigate} onSignIn={onSignIn} onBack={() => navigate('feed')} />;
  return <PublicHome onSignIn={onSignIn} onNavigate={navigate} />;
}

/** Signed-out feed: public posts are readable by anyone, without an account. */
function PublicHome({ onSignIn, onNavigate }: { onSignIn: () => void; onNavigate: (page: PublicPage) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const feed = useMixedFeed();
  const [mode, setMode] = useState<FeedMode>('raw');
  const [searching, setSearching] = useState(false);
  if (searching) return <View style={styles.screen}><SearchView posts={feed.posts} conversations={[]} onClose={() => setSearching(false)} /></View>;
  return <View style={styles.screen}>
    <View style={styles.publicBar}><Pressable accessibilityRole="link" accessibilityLabel={Platform.OS === 'web' ? 'Open Media home' : 'About Open Media'} onPress={() => onNavigate(Platform.OS === 'web' ? 'landing' : 'mission')}><BrandMark compact /></Pressable><View style={styles.publicActions}>{Platform.OS !== 'web' ? <Pressable accessibilityRole="button" accessibilityLabel="Our mission" onPress={() => onNavigate('mission')} style={styles.publicSearch}><Ionicons name="information-circle-outline" size={22} color={colors.text} /></Pressable> : null}<Pressable accessibilityRole="search" accessibilityLabel="Search everything" onPress={() => setSearching(true)} style={styles.publicSearch}><Ionicons name="search" size={20} color={colors.text} /></Pressable><Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signInButton}><Text style={styles.signInText}>Sign in</Text></Pressable></View></View>
    <FeedView mode={mode} onModeChange={setMode} posts={feed.posts} loading={feed.loading} error={feed.error} hasMore={feed.hasMore} onRetry={feed.refresh} onLoadMore={feed.loadMore} sources={feed.sources} loadingMore={feed.loadingMore} pendingCount={feed.pendingCount} onShowPending={feed.showPending} />
    <Pressable accessibilityRole="link" onPress={() => onNavigate('developers')} style={styles.apiLink}><Ionicons name="code-slash-outline" size={14} color={colors.textSecondary} /><Text style={styles.apiLinkText}>Open data · APIs and MCP for developers and agents</Text></Pressable>
  </View>;
}

function SignInScreen({ error, onError, onBack, onMatrixDemo }: { error: string; onError: (value: string) => void; onBack: () => void; onMatrixDemo?: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const validCode = /^\d{6,10}$/.test(code.replace(/\s+/g, ''));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onError('');
    try { await action(); }
    catch (reason) { onError(messageFor(reason)); }
    finally { setBusy(false); }
  };
  const [autoSigningIn, setAutoSigningIn] = useState(false);
  const sendLink = () => run(async () => {
    const requestedAt = new Date();
    await sendSignInLink(email.trim());
    setSent(true);
    setCode('');
    if (!localAutoSignInAvailable()) return;
    // Local Mac setup: the code lands in the local inbox; finish signing in automatically.
    setAutoSigningIn(true);
    try {
      const localCode = await waitForLocalSignInCode(email, requestedAt);
      if (localCode) await verifySignInCode(email, localCode);
      else onError('The sign-in code did not arrive. Try “Send a new code”.');
    } finally {
      setAutoSigningIn(false);
    }
  });
  const submitCode = () => run(() => verifySignInCode(email, code));
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Your social world, together.</Text><Text style={styles.copy}>Sign in to post, report, and message people on Open Media. Reading public posts never needs an account.</Text>
    {sent && autoSigningIn
      ? <View style={styles.success} accessibilityLiveRegion="polite"><View style={styles.autoRow}><ActivityIndicator color={colors.text} /><Text style={styles.successTitle}>Signing you in…</Text></View><Text style={styles.successCopy}>Open Media is running on this Mac, so it fills in your sign-in code for you.</Text></View>
      : sent
      ? <><View style={styles.success} accessibilityLiveRegion="polite"><Text style={styles.successTitle}>Check your email</Text><Text style={styles.successCopy}>We sent a sign-in link and code to {email.trim()}. Open the link {Platform.OS === 'web' ? 'in this browser' : 'on this device'}, or type the code below. The code works on any device.</Text></View>
        <Text style={styles.label}>Code from the email</Text><TextInput accessibilityLabel="Sign-in code" autoComplete="one-time-code" textContentType="oneTimeCode" keyboardType="number-pad" inputMode="numeric" maxLength={12} returnKeyType="go" onSubmitEditing={validCode && !busy ? submitCode : undefined} value={code} onChangeText={(value) => setCode(value.replace(/[^\d\s]/g, ''))} placeholder="123456" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.codeInput]} />
        <Pressable accessibilityRole="button" disabled={busy || !validCode} onPress={submitCode} style={[styles.primary, (busy || !validCode) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>Sign in with code</Text>}</Pressable>
        <View style={styles.inlineActions}><Pressable accessibilityRole="button" disabled={busy} onPress={sendLink}><Text style={styles.textButton}>Send a new code</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setSent(false); setCode(''); onError(''); }}><Text style={styles.textButton}>Use a different email</Text></Pressable></View></>
      : <><Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="send" onSubmitEditing={validEmail && !busy ? sendLink : undefined} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.textTertiary} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy || !validEmail} onPress={sendLink} style={[styles.primary, (busy || !validEmail) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>Continue with email</Text>}</Pressable>
        <Pressable accessibilityRole="button" disabled={!validEmail} onPress={() => { onError(''); setSent(true); }}><Text style={[styles.textButton, !validEmail && styles.disabled]}>I already have a code</Text></Pressable></>}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {onMatrixDemo ? <><View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View><Pressable accessibilityRole="button" onPress={onMatrixDemo} style={styles.secondary}><Text style={styles.secondaryText}>Try the local Matrix sandbox</Text></Pressable></> : null}
    <Pressable accessibilityRole="button" onPress={() => { onError(''); onBack(); }} style={styles.secondary}><Text style={styles.secondaryText}>Keep browsing without an account</Text></Pressable><Text style={styles.privacy}>Posts and profiles on Open Media are public. Messages stay private. No social passwords are stored in the app, and connections appear only when an official API or open protocol supports them.</Text></View></EntryShell>;
}

function ProfileSetup({ session, error, onError, onComplete, onSignOut }: { session: Session; error: string; onError: (value: string) => void; onComplete: (profile: OpenMediaProfile) => void; onSignOut: () => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  const suggestedName = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? '';
  const [displayName, setDisplayName] = useState(String(suggestedName)); const [handle, setHandle] = useState(String(suggestedName).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); onError('');
    try { onComplete(await saveCurrentProfile(session, { displayName, handle })); }
    catch (reason) { onError(messageFor(reason)); }
    finally { setBusy(false); }
  };
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Create your Open Media profile</Text><Text style={styles.copy}>This is how people will find and message you. Your email stays private.</Text><Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Display name" autoComplete="name" maxLength={80} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textTertiary} style={styles.input} /><Text style={styles.label}>Handle</Text><View style={styles.handleRow}><Text style={styles.at}>@</Text><TextInput accessibilityLabel="Handle" autoCapitalize="none" maxLength={24} value={handle} onChangeText={(value) => setHandle(value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="yourhandle" placeholderTextColor={colors.textTertiary} style={styles.handleInput} /></View><Text style={styles.hint}>3–24 lowercase letters, numbers, or underscores.</Text><Pressable accessibilityRole="button" disabled={busy || !displayName.trim() || handle.length < 3} onPress={submit} style={[styles.primary, (busy || !displayName.trim() || handle.length < 3) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>Finish setup</Text>}</Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={onSignOut} style={styles.secondary}><Text style={styles.secondaryText}>Use a different email</Text></Pressable>{error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}</View></EntryShell>;
}

function ConfigurationRequired({ onMatrixDemo }: { onMatrixDemo?: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Open Media needs its backend configuration.</Text><Text style={styles.copy}>Add the Supabase URL and publishable key to the build environment before inviting testers.</Text>{onMatrixDemo ? <Pressable accessibilityRole="button" onPress={onMatrixDemo} style={styles.secondary}><Text style={styles.secondaryText}>Try the local Matrix sandbox</Text></Pressable> : null}</View></EntryShell>;
}

function CenteredStatus({ label }: { label: string }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <EntryShell><ActivityIndicator color={colors.text} /><Text accessibilityLiveRegion="polite" style={styles.loading}>{label}</Text></EntryShell>;
}

function RetryStatus({ error, onRetry, onSignOut }: { error: string; onRetry: () => void; onSignOut?: () => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Open Media couldn’t finish loading.</Text><Text accessibilityLiveRegion="assertive" style={styles.copy}>{error || 'Check your connection and try again.'}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.primary}><Text style={styles.primaryText}>Try again</Text></Pressable>{onSignOut ? <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.secondary}><Text style={styles.secondaryText}>Sign out</Text></Pressable> : null}</View></EntryShell>;
}

function EntryShell({ children }: React.PropsWithChildren) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.shell}>{children}</ScrollView></KeyboardAvoidingView>;
}

function messageFor(reason: unknown) { return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.'; }

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, shell: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 22, backgroundColor: colors.surface }, card: { width: '100%', maxWidth: 430, padding: 28, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 34 }, brandIcon: { width: 30, height: 30, borderRadius: 8 }, wordmark: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 }, hero: { color: colors.text, fontSize: 31, lineHeight: 35, fontWeight: '800', letterSpacing: -1.1 }, copy: { marginTop: 12, marginBottom: 20, color: colors.textSecondary, fontSize: 14, lineHeight: 21 }, label: { marginTop: 12, marginBottom: 6, color: colors.textSecondary, fontSize: 12, fontWeight: '700' }, input: { minHeight: 48, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface, fontSize: 15, outlineStyle: 'none' } as object, handleRow: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, at: { color: colors.textSecondary, fontSize: 15 }, handleInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object, hint: { marginTop: 6, color: colors.textTertiary, fontSize: 12 }, autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, codeInput: { fontSize: 22, letterSpacing: 6, fontVariant: ['tabular-nums'] }, inlineActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }, primary: { minHeight: 50, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: colors.text }, disabled: { opacity: 0.38 }, primaryText: { color: colors.surface, fontSize: 14, fontWeight: '800' }, divider: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }, dividerLine: { flex: 1, height: 1, backgroundColor: colors.border }, dividerText: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' }, secondary: { minHeight: 48, marginTop: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, secondaryText: { color: colors.text, fontSize: 13, fontWeight: '800' }, textButton: { marginTop: 12, color: colors.text, fontSize: 12, fontWeight: '700' }, error: { marginTop: 14, color: colors.danger, fontSize: 12, lineHeight: 18 }, privacy: { marginTop: 19, color: colors.textTertiary, fontSize: 12, lineHeight: 15 }, success: { padding: 16, borderRadius: 14, backgroundColor: colors.chrome }, successTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, successCopy: { marginTop: 5, color: colors.textSecondary, fontSize: 12, lineHeight: 18 }, loading: { marginTop: 12, color: colors.textSecondary, fontSize: 13 }, brandCompact: { marginBottom: 0 }, publicBar: { minHeight: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, publicActions: { flexDirection: 'row', alignItems: 'center', gap: 6 }, publicSearch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, signInButton: { minHeight: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.text }, signInText: { color: colors.surface, fontSize: 13, fontWeight: '800' }, apiLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.border }, apiLinkText: { color: colors.textSecondary, fontSize: 12 },
}); }

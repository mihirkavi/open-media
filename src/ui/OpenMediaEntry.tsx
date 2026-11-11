import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { completePasskeyStep, confirmSignUp, forgetPendingPasswordReset, passwordResetWaitingForPasskey, passkeyStepNeeded, passkeysSupportedHere, resetPasswordWithCode, sendPasswordResetCode, signInWithPassword, signUpWithPassword } from '../auth/accountSecurity';
import { passwordProblem } from '../domain/passwordRules';
import { completeHandedOffSignIn, completeSignInURL, getSupabaseClient, localAutoSignInAvailable, sendSignInLink, signInEmailHasCode, SignInHandedOff, signOut, verifySignInCode, waitForLocalSignIn } from '../auth/supabase';
import { getCurrentProfile, OpenMediaProfile, saveCurrentProfile } from '../data/openMediaService';
import { profileHandleFromPath } from '../domain/profileFields';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { BrandMark } from './BrandMark';
import { LandingPage, PublicPage } from './LandingPage';
import { PeopleProvider, PersonTarget, usePeople } from './people';
import { PersonProfile } from './PersonProfile';
import { MobileTabs, OpenMediaApp } from './OpenMediaApp';
import { ClipsView } from './ClipsView';
import { AskMark } from './AiMark';
import { SocialPost } from '../domain/posts';
import { FeedView } from './OpenMediaFeed';
import { SearchView } from './SearchView';
import { useFeedLenses } from './useFeedLenses';
import { useMixedFeed } from './useMixedFeed';
import { Loader } from './Loader';
import { lazyComponent } from './lazyComponent';

// Reached from links on the landing page, so their code loads only when opened.
const MissionPage = lazyComponent(() => import('./MissionPage').then((module) => module.MissionPage));
const DevelopersPage = lazyComponent(() => import('./DevelopersPage').then((module) => module.DevelopersPage));

export function OpenMediaEntry() {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session>();
  const [profile, setProfile] = useState<OpenMediaProfile>();
  const [loading, setLoading] = useState(Boolean(client));
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  // Signed in with a password or code, but this account also has a passkey that hasn't been used yet.
  const [passkeyNeeded, setPasskeyNeeded] = useState(false);
  const passkeyPending = useRef(false);
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
      if (nextSession && nextSession.user.id === loadedUserId.current && !passkeyPending.current) {
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
      if (!nextSession) { passkeyPending.current = false; setPasskeyNeeded(false); }
      try {
        if (nextSession) {
          // The database refuses this session until the passkey step (ADR 0034), so ask for it first.
          const needsPasskey = await passkeyStepNeeded();
          if (!active || currentRequest !== request) return;
          passkeyPending.current = needsPasskey;
          setPasskeyNeeded(needsPasskey);
          if (needsPasskey) return;
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
      completeSignInURL(url).catch((reason) => {
        if (reason instanceof SignInHandedOff) { setHandedOff(true); return; }
        setError(messageFor(reason)); setSigningIn(true);
      });
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
  if (handedOff && !session) return <HandedOff />;
  if (!session && !signingIn) return <PublicSite onSignIn={() => { setError(''); setSigningIn(true); }} />;
  if (session && passkeyNeeded) return <PasskeyStep onSignOut={async () => { forgetPendingPasswordReset(); await signOut(); passkeyPending.current = false; setPasskeyNeeded(false); setSession(undefined); }} />;
  if (!session) return <SignInScreen error={error} onError={setError} onBack={() => setSigningIn(false)} onMatrixDemo={matrixAvailable ? () => setMatrixDemo(true) : undefined} />;
  if (!profile) return <ProfileSetup session={session} error={error} onError={setError} onComplete={(nextProfile) => { loadedUserId.current = session.user.id; setProfile(nextProfile); }} onSignOut={async () => { await signOut(); setSession(undefined); }} />;
  return <OpenMediaApp currentUserId={session.user.id} profile={profile} onSignOut={async () => { await signOut(); setSession(undefined); setProfile(undefined); }} onAccountDeleted={() => { setSession(undefined); setProfile(undefined); }} onProfileChange={setProfile} />;
}

const publicPages: PublicPage[] = ['landing', 'feed', 'clips', 'mission', 'developers'];

/** Shows /@handle in the address bar while an Open Media profile is open, so it can be copied and shared. */
export function showProfileAddress(target: PersonTarget) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || target.ref.kind !== 'open_media') return;
  window.history.pushState({ person: true }, '', `/@${target.ref.handle.replace(/^@/, '').toLowerCase()}`);
}

/** Leaves a profile address for the app's own page when the profile closes. */
export function leaveProfileAddress() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !profileHandleFromPath(window.location.pathname)) return;
  window.history.replaceState(null, '', `/${window.location.hash}`);
}

function pageFromHash(): PublicPage {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'feed';
  const hash = window.location.hash.replace('#', '') as PublicPage;
  return publicPages.includes(hash) && hash !== 'landing' ? hash : 'landing';
}

/**
 * Signed out. On the web this is the website: the landing page at /, then #feed, #clips, #mission
 * and #developers, each a real link that survives reloads. The phone apps open straight to the feed.
 */
function PublicSite({ onSignIn }: { onSignIn: () => void }) {
  const [page, setPage] = useState<PublicPage>(pageFromHash);
  // Guests can open anyone's public profile; private details need an account.
  // openmedia.site/@handle opens that profile (ADR 0019).
  const [person, setPerson] = useState<PersonTarget | undefined>(() => {
    const handle = Platform.OS === 'web' && typeof window !== 'undefined' ? profileHandleFromPath(window.location.pathname) : undefined;
    return handle ? { ref: { kind: 'open_media', handle } } : undefined;
  });
  const people = useMemo(() => ({ open: (target: PersonTarget) => { setPerson(target); showProfileAddress(target); } }), []);
  const closePerson = () => { setPerson(undefined); leaveProfileAddress(); };
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
  if (person) return <PeopleProvider value={people}><View style={{ flex: 1 }}><PersonProfile target={person} onBack={closePerson} /></View></PeopleProvider>;
  if (page === 'landing') return <LandingPage onNavigate={navigate} onSignIn={onSignIn} />;
  if (page === 'mission') return <MissionPage chrome={Platform.OS === 'web' ? 'public' : 'app'} onNavigate={navigate} onSignIn={onSignIn} onBack={() => navigate('feed')} />;
  if (page === 'developers') return <DevelopersPage chrome={Platform.OS === 'web' ? 'public' : 'app'} onNavigate={navigate} onSignIn={onSignIn} onBack={() => navigate('feed')} />;
  return <PeopleProvider value={people}><PublicHome kind={page === 'clips' ? 'clips' : 'feed'} onSignIn={onSignIn} onNavigate={navigate} /></PeopleProvider>;
}

/**
 * Signed out: Feed and Clips are public posts, readable by anyone without an account, under the
 * same tabs the app has. Messages needs an account, so that tab asks to sign in.
 */
function PublicHome({ kind, onSignIn, onNavigate }: { kind: 'feed' | 'clips'; onSignIn: () => void; onNavigate: (page: PublicPage) => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const [searching, setSearching] = useState<string | false>(false);
  const [feedPosts, setFeedPosts] = useState<SocialPost[]>([]);
  const lenses = useFeedLenses(undefined, 'raw');
  // Hashtags in signed-out posts open this screen's Search too.
  const parent = usePeople();
  const people = useMemo(() => parent ? { ...parent, search: (query: string) => setSearching(query) } : null, [parent]);
  if (searching !== false) return <View style={styles.screen}><SearchView posts={kind === 'feed' ? feedPosts : []} conversations={[]} lenses={lenses} initialQuery={searching} onClose={() => setSearching(false)} /></View>;
  const page = <View style={styles.screen}>
    <View style={styles.publicBar}><Pressable accessibilityRole="link" accessibilityLabel={Platform.OS === 'web' ? 'Open Media home' : 'About Open Media'} onPress={() => onNavigate(Platform.OS === 'web' ? 'landing' : 'mission')}><BrandMark compact /></Pressable><View style={styles.publicActions}>{Platform.OS !== 'web' ? <Pressable accessibilityRole="button" accessibilityLabel="Our mission" onPress={() => onNavigate('mission')} style={styles.publicSearch}><Ionicons name="information-circle-outline" size={22} color={colors.text} /></Pressable> : null}<Pressable accessibilityRole="search" accessibilityLabel="Search everything" onPress={() => setSearching("")} style={styles.publicSearch}><AskMark size={20} color={colors.text} /></Pressable><Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signInButton}><Text style={styles.signInText}>Sign in</Text></Pressable></View></View>
    {kind === 'clips' ? <ClipsView /> : <PublicFeed lenses={lenses} onPosts={setFeedPosts} onDevelopers={() => onNavigate('developers')} />}
    <MobileTabs destination={kind} onNavigate={(next) => next === 'feed' || next === 'clips' ? onNavigate(next) : onSignIn()} />
  </View>;
  return people ? <PeopleProvider value={people}>{page}</PeopleProvider> : page;
}

function PublicFeed({ lenses, onPosts, onDevelopers }: { lenses: ReturnType<typeof useFeedLenses>; onPosts: (posts: SocialPost[]) => void; onDevelopers: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = useThemedStyles(createStyles);
  const feed = useMixedFeed();
  useEffect(() => { onPosts(feed.posts); }, [feed.posts, onPosts]);
  return <>
    <FeedView lens={lenses.lens} lenses={lenses.lenses} onLensChange={lenses.choose} lensContext={lenses.context} posts={feed.posts} loading={feed.loading} error={feed.error} hasMore={feed.hasMore} onRetry={feed.refresh} onLoadMore={feed.loadMore} sources={feed.sources} loadingMore={feed.loadingMore} pendingCount={feed.pendingCount} onShowPending={feed.showPending} />
    <Pressable accessibilityRole="link" onPress={onDevelopers} style={styles.apiLink}><Ionicons name="code-slash-outline" size={14} color={colors.textSecondary} /><Text style={styles.apiLinkText}>Open data · APIs and MCP for developers and agents</Text></Pressable>
  </>;
}

type SignInMode = 'password' | 'code';

/** Sign in with a password (default) or an email code, or create an account (ADR 0034). */
function SignInScreen(props: { error: string; onError: (value: string) => void; onBack: () => void; onMatrixDemo?: () => void }) {
  const [mode, setMode] = useState<SignInMode>('password');
  const [email, setEmail] = useState('');
  const switchTo = (next: SignInMode) => { props.onError(''); setMode(next); };
  return mode === 'password'
    ? <PasswordSignIn {...props} email={email} onEmail={setEmail} onUseCode={() => switchTo('code')} />
    : <EmailCodeSignIn {...props} initialEmail={email} onUsePassword={() => switchTo('password')} />;
}

function EmailCodeSignIn({ error, onError, onBack, onMatrixDemo, initialEmail, onUsePassword }: { error: string; onError: (value: string) => void; onBack: () => void; onMatrixDemo?: () => void; initialEmail: string; onUsePassword: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  const [email, setEmail] = useState(initialEmail); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const validCode = /^\d{6,10}$/.test(code.replace(/\s+/g, ''));
  const hasCode = signInEmailHasCode();
  const here = Platform.OS === 'web' ? 'in this browser' : 'on this device';
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onError('');
    try { await action(); }
    catch (reason) { onError(messageFor(reason)); }
    finally { setBusy(false); }
  };
  const [autoSigningIn, setAutoSigningIn] = useState(false);
  // Each new request (or leaving this screen) stops the previous request's background wait.
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current += 1; }, []);
  const sendLink = () => run(async () => {
    const requestedAt = new Date();
    const thisAttempt = ++attempt.current;
    await sendSignInLink(email.trim());
    setSent(true);
    setCode('');
    if (!localAutoSignInAvailable()) return;
    // Local Mac setup: the code lands in the local inbox, so finish signing in automatically. Show
    // "Signing you in…" briefly, then keep listening in the background while the code form shows,
    // so a link opened in any other browser still signs in this window.
    setAutoSigningIn(true);
    void autoSignIn(requestedAt, thisAttempt);
  });
  const autoSignIn = async (requestedAt: Date, thisAttempt: number) => {
    const tried = new Set<string>();
    const cancelled = () => attempt.current !== thisAttempt;
    const startedAt = Date.now();
    try {
      while (!cancelled() && Date.now() - startedAt < 10 * 60_000) {
        const result = await waitForLocalSignIn(email, requestedAt, { timeoutMs: 20_000, skip: tried, cancelled });
        if (cancelled()) return;
        if (!result) { setAutoSigningIn(false); continue; }
        try {
          if ('linkCode' in result) await completeHandedOffSignIn(result.linkCode);
          else { tried.add(result.code); await verifySignInCode(email, result.code); }
          return;
        } catch (reason) {
          // An older email's code, or a link from an earlier request: keep waiting for the right one.
          if ('linkCode' in result) onError(messageFor(reason));
        }
      }
    } finally {
      if (!cancelled()) setAutoSigningIn(false);
    }
  };
  const submitCode = () => run(() => verifySignInCode(email, code));
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Your social world, together.</Text><Text style={styles.copy}>Sign in to post, report, and message people on Open Media. Reading public posts never needs an account.</Text>
    {sent && autoSigningIn
      ? <View style={styles.success} accessibilityLiveRegion="polite"><View style={styles.autoRow}><Loader color={colors.text} /><Text style={styles.successTitle}>Signing you in…</Text></View><Text style={styles.successCopy}>Open Media is running on this Mac, so it fills in your sign-in code for you.</Text></View>
      : sent
      ? <><View style={styles.success} accessibilityLiveRegion="polite"><Text style={styles.successTitle}>Check your email</Text><Text style={styles.successCopy}>{hasCode ? `We sent a sign-in link and code to ${email.trim()}. ${localAutoSignInAvailable() ? 'This window signs in by itself as soon as it arrives, even if you open the link in another browser. You can also type the code below.' : `Open the link ${here}, or type the code below. The code works on any device.`}` : `We sent a sign-in link to ${email.trim()}. Open it ${here} to sign in.`}</Text></View>
        {hasCode ? <><Text style={styles.label}>Code from the email</Text><TextInput accessibilityLabel="Sign-in code" autoComplete="one-time-code" textContentType="oneTimeCode" keyboardType="number-pad" inputMode="numeric" maxLength={12} returnKeyType="go" onSubmitEditing={validCode && !busy ? submitCode : undefined} value={code} onChangeText={(value) => setCode(value.replace(/[^\d\s]/g, ''))} placeholder="123456" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.codeInput]} />
        <Pressable accessibilityRole="button" disabled={busy || !validCode} onPress={submitCode} style={[styles.primary, (busy || !validCode) && styles.disabled]}>{busy ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>Sign in with code</Text>}</Pressable></> : null}
        <View style={styles.inlineActions}><Pressable accessibilityRole="button" disabled={busy} onPress={sendLink}><Text style={styles.textButton}>{hasCode ? 'Send a new code' : 'Send a new link'}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setSent(false); setCode(''); onError(''); }}><Text style={styles.textButton}>Use a different email</Text></Pressable></View></>
      : <><Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="send" onSubmitEditing={validEmail && !busy ? sendLink : undefined} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.textTertiary} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy || !validEmail} onPress={sendLink} style={[styles.primary, (busy || !validEmail) && styles.disabled]}>{busy ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>Continue with email</Text>}</Pressable>
        <View style={styles.inlineActions}>{hasCode ? <Pressable accessibilityRole="button" disabled={!validEmail} onPress={() => { onError(''); setSent(true); }}><Text style={[styles.textButton, !validEmail && styles.disabled]}>I already have a code</Text></Pressable> : <View />}<Pressable accessibilityRole="button" onPress={onUsePassword}><Text style={styles.textButton}>Use a password instead</Text></Pressable></View></>}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {onMatrixDemo ? <><View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View><Pressable accessibilityRole="button" onPress={onMatrixDemo} style={styles.secondary}><Text style={styles.secondaryText}>Try the local Matrix sandbox</Text></Pressable></> : null}
    <Pressable accessibilityRole="button" onPress={() => { onError(''); onBack(); }} style={styles.secondary}><Text style={styles.secondaryText}>Keep browsing without an account</Text></Pressable><Text style={styles.privacy}>Posts and profiles on Open Media are public. Messages stay private. No social passwords are stored in the app, and connections appear only when an official API or open protocol supports them.</Text></View></EntryShell>;
}

/**
 * Local Mac setup only: watches the local test inbox for the code sent at `since` and hands it to
 * `use`, which returns true once the code worked. Older codes that fail are skipped.
 */
function useLocalCodeFill(email: string, since: Date | undefined, use: (code: string) => Promise<boolean>) {
  const useRef_ = useRef(use); useRef_.current = use;
  useEffect(() => {
    if (!since || !localAutoSignInAvailable()) return;
    let stopped = false;
    const tried = new Set<string>();
    (async () => {
      const startedAt = Date.now();
      while (!stopped && Date.now() - startedAt < 10 * 60_000) {
        const result = await waitForLocalSignIn(email, since, { timeoutMs: 20_000, skip: tried, cancelled: () => stopped });
        if (stopped || !result || !('code' in result)) continue;
        tried.add(result.code);
        if (await useRef_.current(result.code).catch(() => false)) return;
      }
    })();
    return () => { stopped = true; };
  }, [email, since]);
}

type PasswordStep = 'sign-in' | 'sign-up' | 'confirm' | 'forgot' | 'reset';

function PasswordSignIn({ error, onError, onBack, onMatrixDemo, email, onEmail, onUseCode }: { error: string; onError: (value: string) => void; onBack: () => void; onMatrixDemo?: () => void; email: string; onEmail: (value: string) => void; onUseCode: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  const [step, setStep] = useState<PasswordStep>('sign-in');
  const [password, setPasswordValue] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeSentAt, setCodeSentAt] = useState<Date>();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const validCode = /^\d{6,10}$/.test(code.replace(/\s+/g, ''));
  const problem = step === 'sign-up' || step === 'reset' ? passwordProblem(password, email) : undefined;
  const local = localAutoSignInAvailable();
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onError('');
    try { await action(); }
    catch (reason) { onError(messageFor(reason)); }
    finally { setBusy(false); }
  };
  const go = (next: PasswordStep) => { onError(''); setCode(''); setCodeSentAt(undefined); if (next === 'sign-up' || next === 'forgot') setPasswordValue(''); setStep(next); };

  // Local setup: confirm a new account, or fill in the reset code, straight from the local inbox.
  useLocalCodeFill(email, step === 'confirm' || step === 'reset' ? codeSentAt : undefined, async (localCode) => {
    if (step === 'reset') { setCode(localCode); return true; }
    await confirmSignUp(email, localCode);
    return true;
  });

  const signIn = () => run(() => signInWithPassword(email, password));
  const signUp = () => run(async () => {
    const sentAt = new Date();
    await signUpWithPassword(email, password);
    setCode(''); setCodeSentAt(sentAt); setStep('confirm');
  });
  const confirm = () => run(() => confirmSignUp(email, code));
  const requestReset = () => run(async () => {
    const sentAt = new Date();
    await sendPasswordResetCode(email);
    setCode(''); setPasswordValue(''); setCodeSentAt(sentAt); setStep('reset');
  });
  const reset = () => run(() => resetPasswordWithCode(email, code, password));

  const emailField = <><Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={onEmail} placeholder="you@example.com" placeholderTextColor={colors.textTertiary} style={styles.input} /></>;
  const passwordField = (label: string, onSubmit: (() => void) | undefined, isNew: boolean) => <><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} secureTextEntry autoCapitalize="none" autoComplete={isNew ? 'new-password' : 'current-password'} textContentType={isNew ? 'newPassword' : 'password'} returnKeyType="go" onSubmitEditing={onSubmit} value={password} onChangeText={setPasswordValue} placeholder={isNew ? 'At least 8 characters' : ''} placeholderTextColor={colors.textTertiary} style={styles.input} />{isNew && password && problem ? <Text style={styles.fieldHint}>{problem}</Text> : null}</>;
  const codeField = (onSubmit: (() => void) | undefined) => <><Text style={styles.label}>Code from the email</Text><TextInput accessibilityLabel="Code from the email" autoComplete="one-time-code" textContentType="oneTimeCode" keyboardType="number-pad" inputMode="numeric" maxLength={12} returnKeyType="go" onSubmitEditing={onSubmit} value={code} onChangeText={(value) => setCode(value.replace(/[^\d\s]/g, ''))} placeholder="123456" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.codeInput]} /></>;
  const primary = (label: string, onPress: () => void, enabled: boolean) => <Pressable accessibilityRole="button" disabled={busy || !enabled} onPress={onPress} style={[styles.primary, (busy || !enabled) && styles.disabled]}>{busy ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>;
  const link = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" disabled={busy} onPress={onPress}><Text style={styles.textButton}>{label}</Text></Pressable>;

  const title = step === 'sign-up' ? 'Create your account' : step === 'confirm' ? 'Confirm your email' : step === 'forgot' || step === 'reset' ? 'Reset your password' : 'Your social world, together.';
  const copy = step === 'sign-up' ? 'Choose a password. We’ll email you a code to confirm the address is yours.'
    : step === 'confirm' ? `We sent a 6-digit code to ${email.trim()}. ${local ? 'This window confirms it by itself as soon as it arrives.' : 'Type it below. It works on any device.'}`
    : step === 'forgot' ? 'We’ll email you a code. Type it here with your new password. It works on any device.'
    : step === 'reset' ? `We sent a code to ${email.trim()}${local ? ', and filled it in for you' : ''}. Choose your new password.`
    : 'Sign in to post, report, and message people on Open Media. Reading public posts never needs an account.';

  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>{title}</Text><Text style={styles.copy}>{copy}</Text>
    {step === 'sign-in' ? <>
      {emailField}
      {passwordField('Password', validEmail && password && !busy ? signIn : undefined, false)}
      {primary('Sign in', signIn, validEmail && Boolean(password))}
      <View style={styles.inlineActions}>{link('Forgot password?', () => go('forgot'))}{link('Email me a code instead', onUseCode)}</View>
      <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>NEW HERE?</Text><View style={styles.dividerLine} /></View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => go('sign-up')} style={styles.secondary}><Text style={styles.secondaryText}>Create an account</Text></Pressable>
    </> : step === 'sign-up' ? <>
      {emailField}
      {passwordField('New password', validEmail && !problem && !busy ? signUp : undefined, true)}
      {primary('Create account', signUp, validEmail && !problem)}
      <View style={styles.inlineActions}>{link('I already have an account', () => go('sign-in'))}</View>
    </> : step === 'confirm' ? <>
      {codeField(validCode && !busy ? confirm : undefined)}
      {primary('Confirm and sign in', confirm, validCode)}
      <Text style={styles.fieldHint}>No code? If this address already has an account, no code is sent. Sign in, or reset your password.</Text>
      <View style={styles.inlineActions}>{link('Send a new code', signUp)}{link('Back to sign in', () => go('sign-in'))}</View>
    </> : step === 'forgot' ? <>
      {emailField}
      {primary('Email me a reset code', requestReset, validEmail)}
      <View style={styles.inlineActions}>{link('Back to sign in', () => go('sign-in'))}</View>
    </> : <>
      {codeField(undefined)}
      {passwordField('New password', validCode && !problem && !busy ? reset : undefined, true)}
      {primary('Save password and sign in', reset, validCode && !problem)}
      <View style={styles.inlineActions}>{link('Send a new code', requestReset)}{link('Back to sign in', () => go('sign-in'))}</View>
    </>}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {onMatrixDemo && step === 'sign-in' ? <><View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View><Pressable accessibilityRole="button" onPress={onMatrixDemo} style={styles.secondary}><Text style={styles.secondaryText}>Try the local Matrix sandbox</Text></Pressable></> : null}
    <Pressable accessibilityRole="button" onPress={() => { onError(''); onBack(); }} style={styles.secondary}><Text style={styles.secondaryText}>Keep browsing without an account</Text></Pressable><Text style={styles.privacy}>Posts and profiles on Open Media are public. Messages stay private. No social passwords are stored in the app, and connections appear only when an official API or open protocol supports them.</Text></View></EntryShell>;
}

/** After the password or email code, people who added a passkey confirm with it (ADR 0034). */
function PasskeyStep({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const supported = passkeysSupportedHere();
  const confirm = async () => {
    setBusy(true); setMessage('');
    try { await completePasskeyStep(); }
    catch (reason) { setMessage(messageFor(reason)); }
    finally { setBusy(false); }
  };
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Confirm it’s you</Text>
    <Text style={styles.copy}>{supported ? `Your account is protected with a passkey. Use it to ${passwordResetWaitingForPasskey() ? 'save your new password and finish signing in' : 'finish signing in'}: Touch ID, Face ID, Windows Hello, your phone or a security key.` : 'Your account is protected with a passkey. Passkeys in the phone app are coming next; for now, finish signing in at openmedia.site in a browser.'}</Text>
    {supported ? <Pressable accessibilityRole="button" disabled={busy} onPress={confirm} style={[styles.primary, busy && styles.disabled]}>{busy ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>Use my passkey</Text>}</Pressable> : null}
    {message ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { onSignOut().catch(() => undefined); }} style={styles.secondary}><Text style={styles.secondaryText}>Sign out</Text></Pressable>
  </View></EntryShell>;
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
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Create your Open Media profile</Text><Text style={styles.copy}>This is how people will find and message you. Your email stays private.</Text><Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Display name" autoComplete="name" maxLength={80} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textTertiary} style={styles.input} /><Text style={styles.label}>Handle</Text><View style={styles.handleRow}><Text style={styles.at}>@</Text><TextInput accessibilityLabel="Handle" autoCapitalize="none" maxLength={24} value={handle} onChangeText={(value) => setHandle(value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="yourhandle" placeholderTextColor={colors.textTertiary} style={styles.handleInput} /></View><Text style={styles.hint}>3–24 lowercase letters, numbers, or underscores.</Text><Pressable accessibilityRole="button" disabled={busy || !displayName.trim() || handle.length < 3} onPress={submit} style={[styles.primary, (busy || !displayName.trim() || handle.length < 3) && styles.disabled]}>{busy ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>Finish setup</Text>}</Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={onSignOut} style={styles.secondary}><Text style={styles.secondaryText}>Use a different email</Text></Pressable>{error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}</View></EntryShell>;
}

/** Shown in the other browser after it passed a sign-in link to the Open Media window (local Mac setup). */
function HandedOff() {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>You’re signed in</Text><Text accessibilityLiveRegion="polite" style={styles.copy}>This link was opened in a different browser, so it signed in the Open Media window that asked for it. Switch back to that window. You can close this tab.</Text></View></EntryShell>;
}

function ConfigurationRequired({ onMatrixDemo }: { onMatrixDemo?: () => void }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <EntryShell><View style={styles.card}><BrandMark /><Text style={styles.hero}>Open Media needs its backend configuration.</Text><Text style={styles.copy}>Add the Supabase URL and publishable key to the build environment before inviting testers.</Text>{onMatrixDemo ? <Pressable accessibilityRole="button" onPress={onMatrixDemo} style={styles.secondary}><Text style={styles.secondaryText}>Try the local Matrix sandbox</Text></Pressable> : null}</View></EntryShell>;
}

function CenteredStatus({ label }: { label: string }) {
  const { colors } = useOpenMediaTheme(); const styles = createStyles(colors);
  return <EntryShell><Loader color={colors.text} /><Text accessibilityLiveRegion="polite" style={styles.loading}>{label}</Text></EntryShell>;
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
  screen: { flex: 1, backgroundColor: colors.surface }, shell: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 22, backgroundColor: colors.surface }, card: { width: '100%', maxWidth: 430, padding: 28, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 34 }, brandIcon: { width: 30, height: 30, borderRadius: 8 }, wordmark: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 }, hero: { color: colors.text, fontSize: 31, lineHeight: 35, fontWeight: '800', letterSpacing: -1.1 }, copy: { marginTop: 12, marginBottom: 20, color: colors.textSecondary, fontSize: 14, lineHeight: 21 }, label: { marginTop: 12, marginBottom: 6, color: colors.textSecondary, fontSize: 12, fontWeight: '700' }, input: { minHeight: 48, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface, fontSize: 15, outlineStyle: 'none' } as object, handleRow: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, at: { color: colors.textSecondary, fontSize: 15 }, handleInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object, hint: { marginTop: 6, color: colors.textTertiary, fontSize: 12 }, fieldHint: { marginTop: 6, color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, codeInput: { fontSize: 22, letterSpacing: 6, fontVariant: ['tabular-nums'] }, inlineActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }, primary: { minHeight: 50, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: colors.text }, disabled: { opacity: 0.38 }, primaryText: { color: colors.surface, fontSize: 14, fontWeight: '800' }, divider: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }, dividerLine: { flex: 1, height: 1, backgroundColor: colors.border }, dividerText: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' }, secondary: { minHeight: 48, marginTop: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, secondaryText: { color: colors.text, fontSize: 13, fontWeight: '800' }, textButton: { marginTop: 12, color: colors.text, fontSize: 12, fontWeight: '700' }, error: { marginTop: 14, color: colors.danger, fontSize: 12, lineHeight: 18 }, privacy: { marginTop: 19, color: colors.textTertiary, fontSize: 12, lineHeight: 15 }, success: { padding: 16, borderRadius: 14, backgroundColor: colors.chrome }, successTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, successCopy: { marginTop: 5, color: colors.textSecondary, fontSize: 12, lineHeight: 18 }, loading: { marginTop: 12, color: colors.textSecondary, fontSize: 13 }, brandCompact: { marginBottom: 0 }, publicBar: { minHeight: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, publicActions: { flexDirection: 'row', alignItems: 'center', gap: 6 }, publicSearch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, signInButton: { minHeight: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.text }, signInText: { color: colors.surface, fontSize: 13, fontWeight: '800' }, apiLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.border }, apiLinkText: { color: colors.textSecondary, fontSize: 12 },
}); }

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { credentialToJSON, encodeBridge, passkeyBridgeReturn, publicKeyFromJSON, readBridgeRequest, type PasskeyBridgeResponse } from '../domain/passkeyBridge';
import { useOpenMediaTheme } from '../themeContext';
import { Loader } from './Loader';
import { Text } from './Text';

/**
 * openmedia.site/passkey: the page the phone app opens in a secure browser sheet to use or add a
 * passkey (ADR 0034, "Phones"). It runs only the browser's passkey prompt for the challenge the app
 * put in the fragment, then hands the signed response back to `openmedia://passkey`. It never
 * signs in, reads a session or talks to the server. Safari wants the prompt to start from a tap,
 * so the page asks for one.
 */
export function PasskeyBridge() {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const request = useMemo(() => readBridgeRequest(typeof window === 'undefined' ? '' : window.location.hash), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const answer = (response: PasskeyBridgeResponse) => { window.location.href = `${passkeyBridgeReturn}#${encodeBridge(response)}`; };

  const run = async () => {
    if (!request) return;
    setBusy(true); setMessage('');
    try {
      const publicKey = publicKeyFromJSON(request.kind, request.publicKey) as unknown as PublicKeyCredentialCreationOptions & PublicKeyCredentialRequestOptions;
      const credential = request.kind === 'create'
        ? await navigator.credentials.create({ publicKey })
        : await navigator.credentials.get({ publicKey });
      if (!credential) throw Object.assign(new Error('No passkey was returned.'), { name: 'UnknownError' });
      answer({ v: 1, ok: true, credential: credentialToJSON(credential as unknown as Parameters<typeof credentialToJSON>[0]) });
    } catch (error) {
      const name = (error as { name?: string })?.name || 'UnknownError';
      // A closed prompt goes straight back to the app; anything else is explained here first.
      if (name === 'NotAllowedError' || name === 'AbortError') { answer({ v: 1, ok: false, error: name }); return; }
      setMessage(name === 'InvalidStateError' ? 'This device already has a passkey for your account.' : 'The passkey didn’t work here. Go back to the app and try again.');
      setBusy(false);
    }
  };

  const supported = typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && window.isSecureContext;
  const adding = request?.kind === 'create';
  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>{!request ? 'Nothing to confirm' : adding ? 'Add a passkey' : 'Use your passkey'}</Text>
        <Text style={styles.copy}>{!request
          ? 'Open this page from the Open Media app on your phone.'
          : !supported
            ? 'This browser can’t use passkeys. Update your phone, then try again from the app.'
            : adding
              ? 'Save a passkey for Open Media with Face ID, Touch ID or your phone’s passcode. You’ll go straight back to the app.'
              : 'Confirm it’s you with Face ID, Touch ID or your phone’s passcode. You’ll go straight back to the app.'}</Text>
        {request && supported ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void run(); }} style={[styles.primary, busy && styles.disabled]}>{busy ? <Loader color={colors.surface} /> : <Text style={styles.primaryText}>{adding ? 'Add passkey' : 'Use passkey'}</Text>}</Pressable> : null}
        {message ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{message}</Text> : null}
        {request ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => answer({ v: 1, ok: false, error: 'NotAllowedError' })} style={styles.secondary}><Text style={styles.secondaryText}>Back to the app</Text></Pressable> : null}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useOpenMediaTheme>['colors']) {
  return StyleSheet.create({
    page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.chrome },
    card: { width: '100%', maxWidth: 420, gap: 14, padding: 24, borderRadius: 20, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    title: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: colors.text },
    copy: { fontSize: 15, lineHeight: 21, color: colors.textSecondary },
    primary: { minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    primaryText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
    disabled: { opacity: 0.5 },
    secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '500' },
    error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  });
}

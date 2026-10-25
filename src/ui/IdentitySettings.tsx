import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { apiConfigured } from '../connectors/mailApiConnector';
import { answerFollowRequest, loadMyFollows, loadMyIdentity, MyFollows, MyIdentity, removeFollower, saveMyIdentity, startIdentityVerification } from '../data/peopleService';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { usePeople } from './people';
import { Text } from './Text';
import { VerifiedTick } from './VerifiedTick';

const tierCopy: Record<MyIdentity['tier'], string> = {
  2: 'Others see your handle only.',
  3: 'Others see the name you chose. It isn’t verified.',
  4: 'Verified. Others see your handle or chosen name with the blue tick, never your legal name.',
  5: 'Verified. Others see your legal name with the blue tick.',
};

/**
 * Privacy and identity on your own profile (ADR 0013, phase 2): who can see your posts, which name
 * others see, verification, and follow requests. The server computes the tier and the tick.
 */
export function IdentitySettings({ handle }: { handle: string }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const people = usePeople();
  const [identity, setIdentity] = useState<MyIdentity>();
  const [follows, setFollows] = useState<MyFollows>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const [nextIdentity, nextFollows] = await Promise.allSettled([apiConfigured() ? loadMyIdentity() : Promise.reject(new Error('offline')), loadMyFollows()]);
    if (nextIdentity.status === 'fulfilled') setIdentity(nextIdentity.value);
    if (nextFollows.status === 'fulfilled') setFollows(nextFollows.value);
    if (nextIdentity.status === 'rejected' && nextFollows.status === 'rejected') setMessage('Privacy settings are unavailable right now.');
  }, []);
  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label); setMessage('');
    try { await action(); await refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'That didn’t work. Try again.'); }
    finally { setBusy(''); }
  };
  const verify = () => run('verify', async () => {
    const { url } = await startIdentityVerification();
    if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
    else await Linking.openURL(url);
  });

  const option = (label: string, selected: boolean, onPress: () => void, disabled = false) => (
    <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled || Boolean(busy)} onPress={onPress} style={[styles.option, selected && styles.optionOn, disabled && styles.disabled]}>
      <Text style={[styles.optionText, selected && styles.optionTextOn]}>{label}</Text>
    </Pressable>
  );

  const status = identity?.verification?.status;
  return <>
    <Text style={styles.title}>Privacy and identity</Text>
    <View style={styles.card}>
      {identity ? <>
        <View style={styles.block}>
          <Text style={styles.label}>Who can see your posts</Text>
          <View style={styles.options}>
            {option('Everyone', identity.visibility === 'public', () => run('visibility', () => saveMyIdentity({ visibility: 'public' })))}
            {option('Followers you approve', identity.visibility === 'private', () => run('visibility', () => saveMyIdentity({ visibility: 'private' })))}
          </View>
          <Text style={styles.hint}>{identity.visibility === 'private' ? 'Your posts are hidden from everyone else, including the public API and AI agents. Your handle, shown name and photo stay visible so people can find you.' : 'Anyone can read your posts, with or without an account.'}</Text>
        </View>
        <View style={[styles.block, styles.divider]}>
          <Text style={styles.label}>Name others see</Text>
          <View style={styles.options}>
            {option(`@${handle}`, identity.nameDisclosure === 'handle_only', () => run('name', () => saveMyIdentity({ nameDisclosure: 'handle_only' })))}
            {option('Your name', identity.nameDisclosure === 'declared', () => run('name', () => saveMyIdentity({ nameDisclosure: 'declared' })))}
            {option('Legal name', identity.nameDisclosure === 'verified_legal', () => run('name', () => saveMyIdentity({ nameDisclosure: 'verified_legal' })), !identity.verified)}
          </View>
          <View style={styles.shownRow}><Text style={styles.hint}>Shown as <Text style={styles.strong}>{identity.shownName}</Text></Text>{identity.verified ? <VerifiedTick size={14} /> : null}</View>
          <Text style={styles.hint}>{tierCopy[identity.tier]}</Text>
        </View>
        <View style={[styles.row, styles.divider]}>
          <Ionicons name={identity.verified ? 'shield-checkmark' : 'shield-outline'} size={20} color={colors.text} />
          <View style={styles.grow}>
            <Text style={styles.rowTitle}>{identity.verified ? 'Identity verified' : status === 'pending' ? 'Verification in progress' : 'Verify your identity'}</Text>
            <Text style={styles.hint}>{identity.verified ? 'Your legal name stays private unless you choose to show it.' : identity.verificationAvailable ? 'With Stripe Identity: a photo ID and a selfie. Stripe keeps them; Open Media keeps only the result.' : 'Not available yet. No one has a blue tick until it is.'}</Text>
          </View>
          {!identity.verified && identity.verificationAvailable ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={verify} style={styles.small}>
            {busy === 'verify' ? <ActivityIndicator color={colors.text} /> : <Text style={styles.smallText}>{status === 'pending' || status === 'failed' ? 'Try again' : 'Verify'}</Text>}
          </Pressable> : null}
        </View>
      </> : message ? null : <ActivityIndicator style={styles.loading} color={colors.text} />}
    </View>

    {follows ? <>
      <Text style={styles.title}>Followers</Text>
      <Text style={styles.copy}>{`${follows.followers.length} ${follows.followers.length === 1 ? 'follower' : 'followers'} · following ${follows.following.filter((item) => item.status === 'accepted').length}`}</Text>
      {follows.requests.length || follows.followers.length ? <View style={styles.card}>
        {follows.requests.map((person, index) => <View key={`r-${person.id}`} style={[styles.row, index > 0 && styles.divider]}>
          <Pressable accessibilityRole="link" onPress={() => people?.open({ ref: { kind: 'open_media', handle: person.handle } })} style={styles.grow}>
            <View style={styles.shownRow}><Text style={styles.rowTitle}>{person.displayName}</Text>{person.verified ? <VerifiedTick size={14} /> : null}</View>
            <Text style={styles.hint}>@{person.handle} wants to follow you</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run(`a-${person.id}`, () => answerFollowRequest(person.id, true))} style={[styles.small, styles.smallOn]}><Text style={styles.smallTextOn}>Accept</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run(`d-${person.id}`, () => answerFollowRequest(person.id, false))} style={styles.small}><Text style={styles.smallText}>Decline</Text></Pressable>
        </View>)}
        {follows.followers.map((person, index) => <View key={`f-${person.id}`} style={[styles.row, (index > 0 || follows.requests.length > 0) && styles.divider]}>
          <Pressable accessibilityRole="link" onPress={() => people?.open({ ref: { kind: 'open_media', handle: person.handle } })} style={styles.grow}>
            <View style={styles.shownRow}><Text style={styles.rowTitle}>{person.displayName}</Text>{person.verified ? <VerifiedTick size={14} /> : null}</View>
            <Text style={styles.hint}>@{person.handle}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove @${person.handle} from your followers`} disabled={Boolean(busy)} onPress={() => run(`x-${person.id}`, () => removeFollower(person.id))} style={styles.small}><Text style={styles.smallText}>Remove</Text></Pressable>
        </View>)}
      </View> : null}
    </> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
  </>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    title: { marginTop: 28, marginBottom: 10, color: colors.text, fontSize: 16, fontWeight: '700' },
    copy: { marginTop: -6, marginBottom: 10, color: colors.textSecondary, fontSize: 13 },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    loading: { padding: 16 },
    block: { padding: 16, gap: 8 },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    label: { color: colors.text, fontSize: 14, fontWeight: '600' },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    option: { minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 17, backgroundColor: colors.chrome },
    optionOn: { backgroundColor: colors.text },
    optionText: { color: colors.text, fontSize: 13, fontWeight: '500' },
    optionTextOn: { color: colors.surface },
    disabled: { opacity: 0.4 },
    hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    strong: { color: colors.text, fontWeight: '600' },
    shownRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    row: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
    grow: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    small: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border },
    smallOn: { backgroundColor: colors.text, borderColor: colors.text },
    smallText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    smallTextOn: { color: colors.surface, fontSize: 13, fontWeight: '600' },
    error: { marginTop: 8, color: colors.danger, fontSize: 12, lineHeight: 18 },
  });
}

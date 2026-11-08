import Ionicons from './Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';

import { loadProfessionalProfile, OpenMediaProfile as OpenMediaProfileData } from '../data/openMediaService';
import { isEmptyProfessional } from '../domain/professionalProfile';
import { publicProfileUrl } from '../domain/profileFields';
import { initialsFor } from '../domain/publicPosts';
import { settingForSection } from '../domain/settings';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { lazyComponent } from './lazyComponent';
import { Destination } from './OpenMediaApp';
import { PeopleSettings } from './PeopleSettings';
import { ProfessionalLines } from './ProfessionalLines';
import { SettingAnchor, SettingAnchorScope, SettingFocus } from './SettingAnchor';

// Settings moved to SettingsHome.tsx; this re-export keeps older imports working.
export { OpenMediaSettings } from './SettingsHome';

// Opened from a row on Profile, so its code loads only then.
const EditProfile = lazyComponent(() => import('./EditProfile').then((module) => module.EditProfile));

/**
 * Profile: you as others see you, with Edit profile and the people you know. Account, privacy,
 * payments and every other setting live in Settings, so nothing is in two places.
 */
export function OpenMediaProfile({ profile, onNavigate, onProfileChange, focus }: { profile: OpenMediaProfileData; onNavigate: (destination: Destination) => void; onProfileChange?: (profile: OpenMediaProfileData) => void; /** A setting on Profile to show, from Search or Open Media AI. */ focus?: SettingFocus }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const initials = initialsFor(profile.displayName);
  // Read fresh each time Profile opens, so a change made in Search or by an agent shows at once.
  const [professional, setProfessional] = useState(profile.professional);
  const [editing, setEditing] = useState(false);
  // A search for a profile setting opens the editor, or scrolls to its section and outlines it.
  const focused = focus ? settingForSection(focus.id) : undefined;
  const scroller = useRef<ScrollView>(null);
  useEffect(() => { if (focused?.page === 'edit-profile') setEditing(true); }, [focus?.at]);
  // Wide screens already have Settings in the sidebar; phones reach it only from here.
  const sidebar = useWindowDimensions().width >= 760;
  const address = publicProfileUrl(profile.handle);
  useEffect(() => { let active = true; loadProfessionalProfile().then((value) => { if (active && value) setProfessional(value); }).catch(() => undefined); return () => { active = false; }; }, [profile.id]);
  if (editing) return <EditProfile profile={{ ...profile, professional }} onClose={() => setEditing(false)} onSaved={(next) => { setProfessional(next.professional); onProfileChange?.(next); }} />;
  return <ScrollView ref={scroller} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <SettingAnchorScope scroller={scroller} anchor={focused?.page === 'profile' ? focused.anchor : undefined} at={focus?.at}>
      <View style={styles.profile}>
        {profile.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} accessibilityIgnoresInvertColors /> : <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>}
        <Text style={styles.profileName}>{profile.displayName}</Text>
        <Text style={styles.profileHandle}>@{profile.handle}</Text>
        <ProfessionalLines profile={professional} />
        {profile.bio ? <Text style={styles.profileBio}>{profile.bio}</Text> : null}
        <Text style={styles.profileAddress}><Text accessibilityRole="link" onPress={() => { Linking.openURL(address).catch(() => undefined); }} style={styles.profileAddressLink}>{address.replace('https://', '')}</Text>{professional && !isEmptyProfessional(professional) ? <> · <Text accessibilityRole="link" onPress={() => { Linking.openURL(`${address}/resume`).catch(() => undefined); }} style={styles.profileAddressLink}>Resume</Text></> : null}</Text>
        <Text style={styles.profileNote}>Your profile and posts are public unless you make your account private in Settings › Privacy and identity. Messages stay private. Your contacts and how you link people stay private to you.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={({ pressed }) => [styles.profileAction, pressed && styles.pressed]}><Ionicons name="create-outline" size={20} color={colors.text} /><Text style={styles.profileActionText}>Edit profile</Text><Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /></Pressable>
        {sidebar ? null : <Pressable accessibilityRole="button" onPress={() => onNavigate('settings')} style={({ pressed }) => [styles.profileAction, pressed && styles.pressed]}><Ionicons name="settings-outline" size={20} color={colors.text} /><Text style={styles.profileActionText}>Settings</Text><Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /></Pressable>}
      </View>
      <SettingAnchor id="people"><PeopleSettings handle={profile.handle} /></SettingAnchor>
    </SettingAnchorScope>
  </ScrollView>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24, paddingBottom: 70 }, title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }, subtitle: { marginTop: 6, color: colors.textSecondary, fontSize: 14, lineHeight: 20 }, search: { minHeight: 46, marginTop: 18, marginBottom: 8, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: colors.chrome, borderWidth: 1, borderColor: colors.border }, searchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object, empty: { marginTop: 32, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }, result: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border }, resultIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome }, resultCopy: { flex: 1 }, kind: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 }, resultTitle: { marginTop: 2, color: colors.text, fontSize: 14, fontWeight: '700' }, resultSubtitle: { marginTop: 3, color: colors.textSecondary, fontSize: 13, lineHeight: 18 }, section: { marginTop: 28 }, sectionTitle: { marginBottom: 9, color: colors.text, fontSize: 16, fontWeight: '700' }, card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface }, choices: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 7 }, choice: { minHeight: 42, flex: 1, minWidth: 100, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11 }, choiceActive: { backgroundColor: colors.chrome }, choiceText: { color: colors.text, fontSize: 14, fontWeight: '600' }, row: { minHeight: 64, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, rowDivider: { borderTopWidth: 1, borderTopColor: colors.border }, rowCopy: { flex: 1 }, rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' }, rowDescription: { marginTop: 3, color: colors.textSecondary, fontSize: 13, lineHeight: 18 }, unavailable: { marginTop: 6, color: colors.textTertiary, fontSize: 9, fontWeight: '700' }, capability: { minHeight: 50, paddingHorizontal: 16, justifyContent: 'space-between', flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.border }, capabilityName: { color: colors.text, fontSize: 14, fontWeight: '500' }, capabilityDescription: { marginTop: 3, color: colors.textTertiary, fontSize: 9 }, status: { color: colors.textTertiary, fontSize: 13, fontWeight: '500' }, available: { color: colors.success }, profile: { alignItems: 'center', paddingVertical: 34 }, avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }, avatarText: { color: colors.surface, fontSize: 22, fontWeight: '800' }, profileName: { marginTop: 14, color: colors.text, fontSize: 22, fontWeight: '800' }, profileHandle: { marginTop: 5, color: colors.textSecondary, fontSize: 14 }, profileBio: { maxWidth: 520, marginTop: 10, color: colors.text, fontSize: 15, lineHeight: 22, textAlign: 'center' }, profileAddress: { marginTop: 10, color: colors.textSecondary, fontSize: 13 }, profileAddressLink: { color: colors.text, textDecorationLine: 'underline' }, profileNote: { maxWidth: 460, marginTop: 16, color: colors.textTertiary, fontSize: 13, lineHeight: 19, textAlign: 'center' }, actions: { gap: 10 }, pressed: { backgroundColor: colors.chrome }, profileAction: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border }, profileActionText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' }, deleteAction: { marginTop: 24 }, deleteActionText: { flex: 1, color: colors.danger, fontSize: 15, fontWeight: '600' }, modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.5)' }, confirmCard: { width: '100%', maxWidth: 440, padding: 24, borderRadius: 20, backgroundColor: colors.surface }, confirmTitle: { color: colors.text, fontSize: 20, fontWeight: '800' }, confirmCopy: { marginTop: 10, color: colors.textSecondary, fontSize: 13, lineHeight: 20 }, deleteError: { marginTop: 12, color: colors.danger, fontSize: 12, lineHeight: 18 }, confirmDelete: { minHeight: 48, marginTop: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.danger }, confirmDeleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, confirmCancel: { minHeight: 46, marginTop: 8, alignItems: 'center', justifyContent: 'center' }, confirmCancelText: { color: colors.text, fontSize: 13, fontWeight: '700' },
}); }

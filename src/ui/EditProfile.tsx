import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { loadMyProfileFields, loadProfessionalProfile, OpenMediaProfile, saveMyProfileFields, saveProfessionalProfile, saveProfileBasics } from '../data/openMediaService';
import { loadPublicPerson, saveLinkedAccounts } from '../data/peopleService';
import { NetworkId } from '../domain/networkPosts';
import { editableFields, FieldGroup, fieldDefinition, FieldVisibility, fieldVisibilities, ProfileFieldValue, publicProfileUrl, visibilityLabels } from '../domain/profileFields';
import { EducationEntry, emptyProfessional, OpenTo, parseProfessional, ProfessionalProfile, WorkEntry } from '../domain/professionalProfile';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text, TextInput } from './Text';

const openNetworks: { id: NetworkId; label: string; placeholder: string }[] = [
  { id: 'farcaster', label: 'Farcaster', placeholder: 'yourname' },
  { id: 'lens', label: 'Lens', placeholder: 'yourname' },
  { id: 'hive', label: 'Hive', placeholder: 'yourname' },
  { id: 'deso', label: 'DeSo', placeholder: 'yourname' },
];

const groupTitles: Record<FieldGroup, string> = { about: 'About', contact: 'Contact', social: 'Social accounts' };
const groupNotes: Record<FieldGroup, string> = {
  about: 'Shown under your name.',
  contact: 'Only you see these unless you choose otherwise. “Connections” means people you follow who follow you back, or people you have a conversation with.',
  social: 'Your accounts elsewhere, as links on your profile. Paste a handle or the profile link.',
};

/**
 * Edit profile (ADR 0019): every field in one place, each with who may see it. The owner asked
 * for this screen on 2026-10-28; Search sentences and agents still change the same data.
 */
export function EditProfile({ profile, onClose, onSaved }: { profile: OpenMediaProfile; onClose: () => void; onSaved: (profile: OpenMediaProfile) => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [fields, setFields] = useState<ProfileFieldValue[]>(editableFields([]));
  const [professional, setProfessional] = useState<ProfessionalProfile>(profile.professional ?? emptyProfessional);
  const [skills, setSkills] = useState((profile.professional?.skills ?? []).join(', '));
  const [languages, setLanguages] = useState((profile.professional?.languages ?? []).join(', '));
  const [networks, setNetworks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    Promise.allSettled([loadMyProfileFields(), loadProfessionalProfile(), loadPublicPerson(profile.handle)]).then(([saved, work, person]) => {
      if (!active) return;
      if (saved.status === 'fulfilled') setFields(editableFields(saved.value));
      if (work.status === 'fulfilled' && work.value) { setProfessional(work.value); setSkills(work.value.skills.join(', ')); setLanguages(work.value.languages.join(', ')); }
      if (person.status === 'fulfilled' && person.value) setNetworks(Object.fromEntries(person.value.linkedAccounts.map((account) => [account.network, account.handle])));
      setLoading(false);
    });
    return () => { active = false; };
  }, [profile.handle]);

  const setField = (id: string, change: Partial<ProfileFieldValue>) => setFields((current) => current.map((item) => item.field === id ? { ...item, ...change } : item));
  const setWork = (index: number, change: Partial<WorkEntry>) => setProfessional((current) => ({ ...current, work: current.work.map((item, at) => at === index ? { ...item, ...change } : item) }));
  const setSchool = (index: number, change: Partial<EducationEntry>) => setProfessional((current) => ({ ...current, education: current.education.map((item, at) => at === index ? { ...item, ...change } : item) }));
  const list = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean);

  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const location = fields.find((item) => item.field === 'location');
      // The resume is public, so it carries the location only when the profile shows it to everyone.
      const work = parseProfessional({
        ...professional,
        location: location?.value && location.visibility === 'everyone' ? location.value : undefined,
        work: professional.work.filter((item) => item.name.trim() || item.position.trim()).map((item) => ({ ...item, startDate: item.startDate || undefined, endDate: item.endDate || undefined, summary: item.summary || undefined, location: item.location || undefined })),
        education: professional.education.filter((item) => item.institution.trim()).map((item) => ({ ...item, area: item.area || undefined, studyType: item.studyType || undefined, startDate: item.startDate || undefined, endDate: item.endDate || undefined })),
        skills: list(skills), languages: list(languages),
      });
      const linked = openNetworks.flatMap((network) => networks[network.id]?.trim() ? [{ network: network.id, handle: networks[network.id].trim().replace(/^@/, '') }] : []);
      const [basics] = await Promise.all([
        saveProfileBasics({ displayName: name, bio }),
        saveMyProfileFields(fields.filter((item) => item.value.trim())),
        saveProfessionalProfile(work),
        saveLinkedAccounts(linked),
      ]);
      onSaved({ ...basics, professional: work });
      setMessage('Saved. Your profile is up to date.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'That didn’t save. Check the fields and try again.');
    } finally { setSaving(false); }
  };

  const address = publicProfileUrl(profile.handle);
  const open = (url: string) => { Linking.openURL(url).catch(() => undefined); };
  const groups: FieldGroup[] = ['about', 'contact', 'social'];

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Edit profile</Text>
    </View>
    <Text style={styles.note}>Your public address: <Text accessibilityRole="link" onPress={() => open(address)} style={styles.link}>{address.replace('https://', '')}</Text> · Resume: <Text accessibilityRole="link" onPress={() => open(`${address}/resume`)} style={styles.link}>{`${address.replace('https://', '')}/resume`}</Text></Text>
    {loading ? <ActivityIndicator style={styles.loading} color={colors.text} /> : null}

    <Section title="Basics" styles={styles}>
      <Field label="Name" value={name} onChange={setName} max={80} styles={styles} colors={colors} />
      <Field label="Bio" value={bio} onChange={setBio} max={240} multiline styles={styles} colors={colors} hint={`${bio.length}/240`} />
    </Section>

    <Section title="Work" note="Public, and used for your resume and the Work feed." styles={styles}>
      <Field label="Headline" value={professional.headline ?? ''} onChange={(headline) => setProfessional((current) => ({ ...current, headline }))} max={120} placeholder="Product designer and design-system lead" styles={styles} colors={colors} />
      <Text style={styles.label}>Status</Text>
      <View style={styles.choices}>
        {([undefined, 'work', 'hiring'] as (OpenTo | undefined)[]).map((choice) => <Pressable key={choice ?? 'none'} accessibilityRole="radio" accessibilityState={{ checked: professional.openTo === choice }} onPress={() => setProfessional((current) => ({ ...current, openTo: choice }))} style={[styles.choice, professional.openTo === choice && styles.choiceOn]}><Text style={[styles.choiceText, professional.openTo === choice && styles.choiceTextOn]}>{choice === 'work' ? 'Open to work' : choice === 'hiring' ? 'Hiring' : 'Not shown'}</Text></Pressable>)}
      </View>
      <Field label="Summary" value={professional.summary ?? ''} onChange={(summary) => setProfessional((current) => ({ ...current, summary }))} max={1200} multiline styles={styles} colors={colors} />
      <Field label="Skills" value={skills} onChange={setSkills} max={2000} placeholder="Figma, user research, prototyping" hint="Separate with commas" styles={styles} colors={colors} />
      <Field label="Languages" value={languages} onChange={setLanguages} max={400} placeholder="English, Hindi, Marathi" hint="Separate with commas" styles={styles} colors={colors} />
    </Section>

    <Section title="Experience" styles={styles}>
      {professional.work.map((item, index) => <View key={index} style={styles.entry}>
        <Field label="Role" value={item.position} onChange={(position) => setWork(index, { position })} max={120} styles={styles} colors={colors} />
        <Field label="Company" value={item.name} onChange={(company) => setWork(index, { name: company })} max={120} styles={styles} colors={colors} />
        <View style={styles.row}>
          <Field label="From" value={item.startDate ?? ''} onChange={(startDate) => setWork(index, { startDate })} max={7} placeholder="2022-03" styles={styles} colors={colors} grow />
          <Field label="To" value={item.endDate ?? ''} onChange={(endDate) => setWork(index, { endDate })} max={7} placeholder="Empty if current" styles={styles} colors={colors} grow />
        </View>
        <Field label="Location" value={item.location ?? ''} onChange={(place) => setWork(index, { location: place })} max={120} styles={styles} colors={colors} />
        <Field label="What you did" value={item.summary ?? ''} onChange={(summary) => setWork(index, { summary })} max={600} multiline styles={styles} colors={colors} />
        <Text accessibilityRole="button" onPress={() => setProfessional((current) => ({ ...current, work: current.work.filter((_, at) => at !== index) }))} style={styles.remove}>Remove this role</Text>
      </View>)}
      {professional.work.length < 20 ? <Text accessibilityRole="button" onPress={() => setProfessional((current) => ({ ...current, work: [...current.work, { name: '', position: '', highlights: [] }] }))} style={styles.add}>+ Add a role</Text> : null}
    </Section>

    <Section title="Education" styles={styles}>
      {professional.education.map((item, index) => <View key={index} style={styles.entry}>
        <Field label="School" value={item.institution} onChange={(institution) => setSchool(index, { institution })} max={120} styles={styles} colors={colors} />
        <View style={styles.row}>
          <Field label="Degree" value={item.studyType ?? ''} onChange={(studyType) => setSchool(index, { studyType })} max={120} placeholder="B.Tech" styles={styles} colors={colors} grow />
          <Field label="Field" value={item.area ?? ''} onChange={(area) => setSchool(index, { area })} max={120} placeholder="Computer science" styles={styles} colors={colors} grow />
        </View>
        <View style={styles.row}>
          <Field label="From" value={item.startDate ?? ''} onChange={(startDate) => setSchool(index, { startDate })} max={7} placeholder="2016" styles={styles} colors={colors} grow />
          <Field label="To" value={item.endDate ?? ''} onChange={(endDate) => setSchool(index, { endDate })} max={7} placeholder="2020" styles={styles} colors={colors} grow />
        </View>
        <Text accessibilityRole="button" onPress={() => setProfessional((current) => ({ ...current, education: current.education.filter((_, at) => at !== index) }))} style={styles.remove}>Remove this school</Text>
      </View>)}
      {professional.education.length < 10 ? <Text accessibilityRole="button" onPress={() => setProfessional((current) => ({ ...current, education: [...current.education, { institution: '' }] }))} style={styles.add}>+ Add a school</Text> : null}
    </Section>

    {groups.map((group) => <Section key={group} title={groupTitles[group]} note={groupNotes[group]} styles={styles}>
      {fields.filter((item) => fieldDefinition(item.field)?.group === group).map((item) => {
        const definition = fieldDefinition(item.field)!;
        return <View key={item.field} style={styles.fieldBlock}>
          <Field label={definition.label} value={item.value} onChange={(value) => setField(item.field, { value })} max={definition.max} placeholder={definition.placeholder} keyboard={definition.kind === 'email' ? 'email-address' : definition.kind === 'phone' ? 'phone-pad' : definition.kind === 'url' ? 'url' : 'default'} styles={styles} colors={colors} />
          <Visibility value={item.visibility} onChange={(visibility) => setField(item.field, { visibility })} label={definition.label} styles={styles} />
        </View>;
      })}
    </Section>)}

    <Section title="Open networks" note="Public. Your posts there also appear on your Open Media profile." styles={styles}>
      {openNetworks.map((network) => <Field key={network.id} label={network.label} value={networks[network.id] ?? ''} onChange={(value) => setNetworks((current) => ({ ...current, [network.id]: value }))} max={64} placeholder={network.placeholder} styles={styles} colors={colors} />)}
    </Section>

    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={saving || loading} onPress={save} style={[styles.save, (saving || loading) && styles.disabled]}>{saving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.saveText}>Save profile</Text>}</Pressable>
    <View style={{ height: Platform.OS === 'web' ? 24 : 60 }} />
  </ScrollView>;
}

type Styles = ReturnType<typeof createStyles>;

function Section({ title, note, styles, children }: React.PropsWithChildren<{ title: string; note?: string; styles: Styles }>) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{note ? <Text style={styles.note}>{note}</Text> : null}<View style={styles.card}>{children}</View></View>;
}

function Field({ label, value, onChange, max, placeholder, hint, multiline, keyboard, grow, styles, colors }: { label: string; value: string; onChange: (value: string) => void; max: number; placeholder?: string; hint?: string; multiline?: boolean; keyboard?: 'default' | 'email-address' | 'phone-pad' | 'url'; grow?: boolean; styles: Styles; colors: ThemeColors }) {
  return <View style={[styles.field, grow && styles.grow]}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} maxLength={max} placeholder={placeholder} placeholderTextColor={colors.textTertiary} multiline={multiline} keyboardType={keyboard} autoCapitalize={keyboard && keyboard !== 'default' ? 'none' : 'sentences'} style={[styles.input, multiline && styles.multiline]} />
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}

function Visibility({ value, onChange, label, styles }: { value: FieldVisibility; onChange: (value: FieldVisibility) => void; label: string; styles: Styles }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={`Who can see your ${label}`} style={styles.visibility}>
    {fieldVisibilities.map((choice) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: value === choice }} onPress={() => onChange(choice)} style={[styles.visibilityChoice, value === choice && styles.choiceOn]}><Text style={[styles.visibilityText, value === choice && styles.choiceTextOn]}>{visibilityLabels[choice]}</Text></Pressable>)}
  </View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingBottom: 40 },
    bar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
    title: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.6 },
    note: { marginTop: 4, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    link: { color: colors.text, textDecorationLine: 'underline' },
    loading: { marginTop: 16 },
    section: { marginTop: 26 },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    card: { marginTop: 10, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
    entry: { gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    row: { flexDirection: 'row', gap: 10 },
    grow: { flex: 1 },
    field: { gap: 5 },
    fieldBlock: { gap: 7 },
    label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    input: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.chrome, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object,
    multiline: { minHeight: 84, textAlignVertical: 'top' },
    hint: { color: colors.textTertiary, fontSize: 11 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choice: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    choiceOn: { backgroundColor: colors.text, borderColor: colors.text },
    choiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    choiceTextOn: { color: colors.surface },
    visibility: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    visibilityChoice: { minHeight: 28, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    visibilityText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    add: { color: colors.text, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
    remove: { color: colors.danger, fontSize: 13, fontWeight: '600', paddingVertical: 2 },
    message: { marginTop: 18, color: colors.text, fontSize: 13, lineHeight: 19 },
    save: { minHeight: 50, marginTop: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: colors.text },
    saveText: { color: colors.surface, fontSize: 15, fontWeight: '700' },
    disabled: { opacity: 0.5 },
  });
}

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { loadMyProfileFields, loadProfessionalProfile, OpenMediaProfile, saveMyProfileFields, saveProfessionalProfile, saveProfileBasics } from '../data/openMediaService';
import { loadPublicPerson, saveLinkedAccounts } from '../data/peopleService';
import { importFromLinkedInFiles, importFromWebsite, ImportResult } from '../data/profileImportService';
import { applyProposals, ProfileProposal } from '../domain/profileImport';
import { NetworkId } from '../domain/networkPosts';
import { editableFields, FieldGroup, fieldDefinition, FieldVisibility, fieldVisibilities, ProfileFieldValue, publicProfileUrl, visibilityLabels } from '../domain/profileFields';
import { EducationEntry, emptyProfessional, OpenTo, parseProfessional, ProfessionalProfile, ProjectEntry, WorkEntry } from '../domain/professionalProfile';
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
  // Proposals from LinkedIn or the person's site (ADR 0020), waiting for them to choose.
  const [review, setReview] = useState<{ from: string; result: ImportResult; chosen: Set<string> }>();
  const [importing, setImporting] = useState<'linkedin' | 'website'>();
  const [importNote, setImportNote] = useState('');
  const scroll = useRef<ScrollView>(null);

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
  const setProject = (index: number, change: Partial<ProjectEntry>) => setProfessional((current) => ({ ...current, projects: (current.projects ?? []).map((item, at) => at === index ? { ...item, ...change } : item) }));
  const list = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean);
  const website = fields.find((item) => item.field === 'website')?.value.trim() ?? '';

  /** The form as a profile: blank rows dropped, so it can be checked and merged. */
  const formProfessional = (): ProfessionalProfile => parseProfessional({
    ...professional,
    work: professional.work.filter((item) => item.name.trim() && item.position.trim()).map((item) => ({ ...item, startDate: item.startDate || undefined, endDate: item.endDate || undefined, summary: item.summary || undefined, location: item.location || undefined })),
    education: professional.education.filter((item) => item.institution.trim()).map((item) => ({ ...item, area: item.area || undefined, studyType: item.studyType || undefined, startDate: item.startDate || undefined, endDate: item.endDate || undefined })),
    projects: (professional.projects ?? []).filter((item) => item.name.trim()).map((item) => ({ name: item.name, url: item.url?.trim() || undefined, description: item.description || undefined })),
    skills: list(skills), languages: list(languages),
  });

  const startImport = async (kind: 'linkedin' | 'website') => {
    setImportNote(''); setMessage('');
    if (kind === 'website' && !website) { setImportNote('Add your website under About first, then choose “Fill my profile from this site”.'); return; }
    // The LinkedIn spinner starts once a file is chosen, not while the picker is open.
    if (kind === 'website') setImporting(kind);
    try {
      const result = kind === 'linkedin' ? await importFromLinkedInFiles(() => setImporting('linkedin')) : await importFromWebsite(website);
      if (!result) return;
      const from = kind === 'linkedin' ? 'your LinkedIn file' : website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      setReview({ from, result, chosen: new Set(result.proposals.map((item) => item.id)) });
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (reason) {
      setImportNote(reason instanceof Error ? reason.message : 'That couldn’t be read. Try again.');
    } finally { setImporting(undefined); }
  };

  const useChosen = () => {
    if (!review) return;
    const chosen = review.result.proposals.filter((item) => review.chosen.has(item.id));
    try {
      const next = applyProposals({ displayName: name, bio, professional: formProfessional(), fields: fields.filter((item) => item.value.trim()) }, chosen);
      setName(next.displayName); setBio(next.bio);
      setProfessional(next.professional); setSkills(next.professional.skills.join(', ')); setLanguages(next.professional.languages.join(', '));
      setFields(editableFields(next.fields));
      setReview(undefined);
      setImportNote(`Filled in ${chosen.length} ${chosen.length === 1 ? 'field' : 'fields'} from ${review.from}. Check them below, then Save profile.`);
    } catch (reason) {
      setImportNote(reason instanceof Error ? reason.message : 'Those values don’t fit the profile.');
    }
  };

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
        projects: (professional.projects ?? []).filter((item) => item.name.trim() || item.url?.trim()).map((item) => ({ name: item.name, url: item.url?.trim() || undefined, description: item.description || undefined })),
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

  return <ScrollView ref={scroll} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Edit profile</Text>
    </View>
    <Text style={styles.note}>Your public address: <Text accessibilityRole="link" onPress={() => open(address)} style={styles.link}>{address.replace('https://', '')}</Text> · Resume: <Text accessibilityRole="link" onPress={() => open(`${address}/resume`)} style={styles.link}>{`${address.replace('https://', '')}/resume`}</Text></Text>
    <Text style={styles.note}>Fill this in from <Text accessibilityRole="link" onPress={() => startImport('linkedin')} style={styles.link}>your LinkedIn PDF or data export</Text> or <Text accessibilityRole="link" onPress={() => startImport('website')} style={styles.link}>your website</Text>. You choose what to keep.</Text>
    {importing ? <View style={styles.importing}><ActivityIndicator color={colors.text} /><Text style={styles.note}>{importing === 'linkedin' ? 'Reading your LinkedIn file…' : `Reading ${website.replace(/^https?:\/\//, '')}…`}</Text></View> : null}
    {importNote ? <Text accessibilityLiveRegion="polite" style={styles.message}>{importNote}</Text> : null}
    {review ? <Review review={review} current={{ name, bio, professional, fields }} onToggle={(id) => setReview((current) => { if (!current) return current; const chosen = new Set(current.chosen); if (chosen.has(id)) chosen.delete(id); else chosen.add(id); return { ...current, chosen }; })} onUse={useChosen} onCancel={() => setReview(undefined)} styles={styles} colors={colors} /> : null}
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

    <Section title="Projects" note="Things you made, with a link to each. Public." styles={styles}>
      {(professional.projects ?? []).map((item, index) => <View key={index} style={styles.entry}>
        <Field label="Project" value={item.name} onChange={(projectName) => setProject(index, { name: projectName })} max={120} styles={styles} colors={colors} />
        <Field label="Link" value={item.url ?? ''} onChange={(url) => setProject(index, { url })} max={300} placeholder="https://…" keyboard="url" styles={styles} colors={colors} />
        <Field label="About it" value={item.description ?? ''} onChange={(description) => setProject(index, { description })} max={600} multiline styles={styles} colors={colors} />
        <Text accessibilityRole="button" onPress={() => setProfessional((current) => ({ ...current, projects: (current.projects ?? []).filter((_, at) => at !== index) }))} style={styles.remove}>Remove this project</Text>
      </View>)}
      {(professional.projects ?? []).length < 10 ? <Text accessibilityRole="button" onPress={() => setProfessional((current) => ({ ...current, projects: [...(current.projects ?? []), { name: '' }] }))} style={styles.add}>+ Add a project</Text> : null}
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
          {item.field === 'website' && /\./.test(item.value) ? <Text accessibilityRole="link" onPress={() => startImport('website')} style={styles.add}>Fill my profile from this site</Text> : null}
          {item.field === 'linkedin' ? <Text accessibilityRole="link" onPress={() => startImport('linkedin')} style={styles.hintLink}>Fill my profile from my LinkedIn PDF or data export</Text> : null}
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

/** What a proposal would replace in the form, if anything; lists are added to, so they replace nothing. */
function replaces(proposal: ProfileProposal, current: { name: string; bio: string; professional: ProfessionalProfile; fields: ProfileFieldValue[] }): string | undefined {
  const old = proposal.id === 'displayName' ? current.name : proposal.id === 'bio' ? current.bio
    : proposal.id === 'headline' || proposal.id === 'summary' || proposal.id === 'location' ? current.professional[proposal.id] ?? ''
    : proposal.id.startsWith('field:') ? current.fields.find((item) => item.field === proposal.id.slice(6))?.value ?? '' : '';
  return old.trim() && old.trim() !== String(proposal.value).trim() ? old.trim() : undefined;
}

/** The review step: each proposed value with where it came from; nothing is saved until Save profile. */
function Review({ review, current, onToggle, onUse, onCancel, styles, colors }: { review: { from: string; result: ImportResult; chosen: Set<string> }; current: Parameters<typeof replaces>[1]; onToggle: (id: string) => void; onUse: () => void; onCancel: () => void; styles: Styles; colors: ThemeColors }) {
  const { proposals, skipped } = review.result;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>From {review.from}</Text>
    <Text style={styles.note}>Choose what to use. It fills the fields below; nothing is saved until you tap Save profile.{skipped?.length ? ` Skipped because the site asked: ${skipped.length} ${skipped.length === 1 ? 'page' : 'pages'}.` : ''}</Text>
    <View style={styles.card}>
      {proposals.map((proposal) => {
        const on = review.chosen.has(proposal.id);
        const old = replaces(proposal, current);
        return <Pressable key={proposal.id} accessibilityRole="checkbox" aria-checked={on} accessibilityLabel={`${proposal.label}: ${proposal.preview}`} onPress={() => onToggle(proposal.id)} style={styles.proposal}>
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.text : colors.textTertiary} />
          <View style={styles.grow}>
            <Text style={styles.label}>{proposal.label}</Text>
            <Text style={styles.proposalValue} numberOfLines={6}>{proposal.preview}</Text>
            {old ? <Text style={styles.hint} numberOfLines={2}>Replaces: {old}</Text> : null}
            <Text style={styles.hint}>From {proposal.source}</Text>
          </View>
        </Pressable>;
      })}
      <View style={styles.reviewActions}>
        <Text accessibilityRole="button" onPress={onUse} style={styles.add}>{`Use ${review.chosen.size} of ${proposals.length}`}</Text>
        <Text accessibilityRole="button" onPress={onCancel} style={styles.cancel}>Not now</Text>
      </View>
    </View>
  </View>;
}

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
    hintLink: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
    cancel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
    importing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    proposal: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    proposalValue: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
    reviewActions: { flexDirection: 'row', gap: 20, alignItems: 'center' },
    remove: { color: colors.danger, fontSize: 13, fontWeight: '600', paddingVertical: 2 },
    message: { marginTop: 18, color: colors.text, fontSize: 13, lineHeight: 19 },
    save: { minHeight: 50, marginTop: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: colors.text },
    saveText: { color: colors.surface, fontSize: 15, fontWeight: '700' },
    disabled: { opacity: 0.5 },
  });
}

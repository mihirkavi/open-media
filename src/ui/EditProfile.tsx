import Ionicons from './Icon';
import { useThemedStyles } from './useThemedStyles';
import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { loadMyProfileFields, loadProfessionalProfile, OpenMediaProfile, saveMyProfileFields, saveProfessionalProfile, saveProfileBasics } from '../data/openMediaService';
import { loadPublicPerson, resumeUrl, saveLinkedAccounts } from '../data/peopleService';
import { AvatarChoice, findGravatar, pickAvatar, uploadAvatar } from '../data/avatarUpload';
import { importFromLinkedInFiles, importFromWebsite, ImportResult } from '../data/profileImportService';
import { applyProposals, ProfileProposal } from '../domain/profileImport';
import { NetworkId } from '../domain/networkPosts';
import { editableFields, FieldGroup, fieldDefinition, FieldVisibility, fieldVisibilities, ProfileFieldValue, publicProfileUrl, visibilityLabels } from '../domain/profileFields';
import { EducationEntry, emptyProfessional, OpenTo, parseProfessional, ProfessionalProfile, ProjectEntry, WorkEntry } from '../domain/professionalProfile';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text, TextInput } from './Text';
import { Loader } from './Loader';

type IconName = keyof typeof Ionicons.glyphMap;

const openNetworks: { id: NetworkId; label: string; placeholder: string; icon: IconName }[] = [
  { id: 'farcaster', label: 'Farcaster', placeholder: 'yourname', icon: 'radio-outline' },
  { id: 'lens', label: 'Lens', placeholder: 'yourname', icon: 'leaf-outline' },
  { id: 'hive', label: 'Hive', placeholder: 'yourname', icon: 'cube-outline' },
  { id: 'deso', label: 'DeSo', placeholder: 'yourname', icon: 'diamond-outline' },
];

/** Each field's icon; social networks use their own logo where Ionicons has one. */
const fieldIcons: Record<string, IconName> = {
  pronouns: 'person-outline', location: 'location-outline', website: 'globe-outline', email: 'mail-outline', phone: 'call-outline',
  linkedin: 'logo-linkedin', x: 'logo-x', instagram: 'logo-instagram', facebook: 'logo-facebook', threads: 'logo-threads', bluesky: 'cloud-outline',
  mastodon: 'logo-mastodon', tiktok: 'logo-tiktok', youtube: 'logo-youtube', github: 'logo-github', reddit: 'logo-reddit', medium: 'logo-medium',
  substack: 'newspaper-outline', dribbble: 'logo-dribbble', behance: 'logo-behance', twitch: 'logo-twitch', pinterest: 'logo-pinterest',
  snapchat: 'logo-snapchat', telegram: 'paper-plane-outline', discord: 'logo-discord',
};

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
  const styles = useThemedStyles(createStyles);
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
  // A picture chosen here, or the person's public Gravatar while they have no picture; uploaded on Save.
  const [avatar, setAvatar] = useState<AvatarChoice>();
  const [gravatar, setGravatar] = useState<AvatarChoice>();
  useEffect(() => {
    if (profile.avatarUrl) return;
    let active = true;
    findGravatar().then((found) => { if (active) setGravatar(found); }).catch(() => undefined);
    return () => { active = false; };
  }, [profile.avatarUrl]);
  const chooseAvatar = async () => {
    setMessage('');
    try { const picked = await pickAvatar(); if (picked) setAvatar(picked); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'That picture couldn’t be used. Try another one.'); }
  };
  const newAvatar = avatar ?? (profile.avatarUrl ? undefined : gravatar);
  const shownAvatar = avatar?.previewUrl ?? profile.avatarUrl ?? gravatar?.previewUrl;

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
      setImportNote(`Filled in ${chosen.length} ${chosen.length === 1 ? 'field' : 'fields'} from ${review.from}. Check them below, then tap Save.`);
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
      const avatarUrl = newAvatar ? await uploadAvatar(newAvatar) : undefined;
      const [basics] = await Promise.all([
        saveProfileBasics({ displayName: name, bio, avatarUrl }),
        saveMyProfileFields(fields.filter((item) => item.value.trim())),
        saveProfessionalProfile(work),
        saveLinkedAccounts(linked),
      ]);
      onSaved({ ...basics, professional: work });
      if (avatarUrl) { setAvatar(undefined); setGravatar(undefined); }
      setMessage('Saved. Your profile is up to date.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'That didn’t save. Check the fields and try again.');
    } finally { setSaving(false); }
  };

  const address = publicProfileUrl(profile.handle);
  const open = (url: string) => { Linking.openURL(url).catch(() => undefined); };
  const groups: FieldGroup[] = ['about', 'contact', 'social'];
  const shownName = name.trim() || profile.handle;
  // Wide screens put short fields on one line: label, value, then who may see it.
  const wide = useWindowDimensions().width >= 760;
  const remove = (label: string, onPress: () => void) => <Text accessibilityRole="button" onPress={onPress} style={styles.remove}>{label}</Text>;

  return <View style={styles.screen}>
    <View style={styles.bar}><View style={styles.barInner}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Edit profile</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Save profile" disabled={saving || loading} onPress={save} style={[styles.save, (saving || loading) && styles.disabled]}>{saving ? <Loader size="small" color={colors.surface} /> : <Text style={styles.saveText}>Save</Text>}</Pressable>
    </View></View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.banner}>{message}</Text> : null}
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={styles.identity}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change your picture" onPress={chooseAvatar} style={({ pressed }) => pressed && styles.pressed}>
          {shownAvatar ? <Image source={{ uri: shownAvatar }} style={styles.avatar} accessibilityIgnoresInvertColors /> : <View style={styles.avatar}><Text style={styles.avatarText}>{shownName.charAt(0).toUpperCase()}</Text></View>}
          <View style={styles.avatarBadge}><Ionicons name="camera" size={14} color={colors.text} /></View>
        </Pressable>
        <Text style={styles.identityName} numberOfLines={1}>{shownName}</Text>
        <Text style={styles.identityLine} numberOfLines={1}>{professional.headline?.trim() || `@${profile.handle}`}</Text>
        <Text style={styles.identityLinks}><Text accessibilityRole="link" onPress={() => open(address)} style={styles.link}>{address.replace('https://', '')}</Text>{'   ·   '}<Text accessibilityRole="link" onPress={() => open(resumeUrl(profile.handle))} style={styles.link}>Resume</Text></Text>
        {newAvatar ? <Text style={styles.avatarNote}>{newAvatar.from === 'gravatar' ? 'Your Gravatar, used when you save. Tap it to choose a photo instead.' : 'New picture, used when you save.'}</Text> : null}
      </View>

      <View style={styles.importCard}>
        <View style={styles.importIcon}><Ionicons name="document-text-outline" size={17} color={colors.text} /></View>
        <View style={styles.grow}>
          <Text style={styles.importTitle}>Fill this in for you</Text>
          <Text style={styles.footnote}>From your LinkedIn PDF or data export, or from your website. You choose what to keep.</Text>
          <View style={styles.importActions}>
            <Pressable accessibilityRole="link" accessibilityLabel="Fill from your LinkedIn PDF or data export" onPress={() => startImport('linkedin')} style={styles.pill}><Ionicons name="logo-linkedin" size={14} color={colors.text} /><Text style={styles.pillText}>LinkedIn</Text></Pressable>
            <Pressable accessibilityRole="link" accessibilityLabel="Fill from your website" onPress={() => startImport('website')} style={styles.pill}><Ionicons name="globe-outline" size={14} color={colors.text} /><Text style={styles.pillText}>Website</Text></Pressable>
          </View>
        </View>
      </View>
      {importing ? <View style={styles.importing}><Loader color={colors.text} /><Text style={styles.footnote}>{importing === 'linkedin' ? 'Reading your LinkedIn file…' : `Reading ${website.replace(/^https?:\/\//, '')}…`}</Text></View> : null}
      {importNote ? <Text accessibilityLiveRegion="polite" style={styles.message}>{importNote}</Text> : null}
      {review ? <Review review={review} current={{ name, bio, professional, fields }} onToggle={(id) => setReview((current) => { if (!current) return current; const chosen = new Set(current.chosen); if (chosen.has(id)) chosen.delete(id); else chosen.add(id); return { ...current, chosen }; })} onUse={useChosen} onCancel={() => setReview(undefined)} styles={styles} colors={colors} /> : null}
      {loading ? <Loader style={styles.loading} color={colors.text} /> : null}

      <Section title="Basics" styles={styles}>
        <Field label="Name" value={name} onChange={setName} max={80} styles={styles} colors={colors} />
        <Field label="Bio" value={bio} onChange={setBio} max={240} multiline placeholder="A line or two about you" styles={styles} colors={colors} accessory={<Text style={styles.count}>{`${bio.length}/240`}</Text>} />
      </Section>

      <Section title="Work" note="Public, and used for your resume and the Work feed." styles={styles}>
        <Field label="Headline" value={professional.headline ?? ''} onChange={(headline) => setProfessional((current) => ({ ...current, headline }))} max={120} placeholder="Product designer and design-system lead" styles={styles} colors={colors} />
        <View style={styles.rowInline}>
          <Text style={styles.label}>Status</Text>
          <Segmented label="Work status" value={professional.openTo ?? 'none'} options={[['none', 'Not shown'], ['work', 'Open to work'], ['hiring', 'Hiring']]} onChange={(choice) => setProfessional((current) => ({ ...current, openTo: choice === 'none' ? undefined : choice as OpenTo }))} styles={styles} />
        </View>
        <Field label="Summary" value={professional.summary ?? ''} onChange={(summary) => setProfessional((current) => ({ ...current, summary }))} max={1200} multiline placeholder="What you do and what you’re looking for" styles={styles} colors={colors} />
        <Field label="Skills" value={skills} onChange={setSkills} max={2000} placeholder="Figma, user research, prototyping" accessory={<Text style={styles.count}>Separate with commas</Text>} styles={styles} colors={colors} />
        <Field label="Languages" value={languages} onChange={setLanguages} max={400} placeholder="English, Hindi, Marathi" accessory={<Text style={styles.count}>Separate with commas</Text>} styles={styles} colors={colors} />
      </Section>

      <Section title="Experience" styles={styles}>
        {professional.work.map((item, index) => <Entry key={index} styles={styles}>
          <Field label="Role" value={item.position} onChange={(position) => setWork(index, { position })} max={120} placeholder="Senior designer" styles={styles} colors={colors} />
          <Field label="Company" value={item.name} onChange={(company) => setWork(index, { name: company })} max={120} styles={styles} colors={colors} />
          <View style={styles.pair}>
            <Field label="From" value={item.startDate ?? ''} onChange={(startDate) => setWork(index, { startDate })} max={7} placeholder="2022-03" styles={styles} colors={colors} grow />
            <View style={styles.pairDivider} />
            <Field label="To" value={item.endDate ?? ''} onChange={(endDate) => setWork(index, { endDate })} max={7} placeholder="Now" styles={styles} colors={colors} grow />
          </View>
          <Field label="Location" value={item.location ?? ''} onChange={(place) => setWork(index, { location: place })} max={120} styles={styles} colors={colors} />
          <Field label="What you did" value={item.summary ?? ''} onChange={(summary) => setWork(index, { summary })} max={600} multiline styles={styles} colors={colors} />
          {remove('Remove this role', () => setProfessional((current) => ({ ...current, work: current.work.filter((_, at) => at !== index) })))}
        </Entry>)}
        {professional.work.length < 20 ? <AddRow label={professional.work.length ? 'Add another role' : 'Add a role'} onPress={() => setProfessional((current) => ({ ...current, work: [...current.work, { name: '', position: '', highlights: [] }] }))} styles={styles} colors={colors} /> : null}
      </Section>

      <Section title="Projects" note="Things you made, with a link to each. Public." styles={styles}>
        {(professional.projects ?? []).map((item, index) => <Entry key={index} styles={styles}>
          <Field label="Project" value={item.name} onChange={(projectName) => setProject(index, { name: projectName })} max={120} styles={styles} colors={colors} />
          <Field label="Link" value={item.url ?? ''} onChange={(url) => setProject(index, { url })} max={300} placeholder="https://…" keyboard="url" styles={styles} colors={colors} />
          <Field label="About it" value={item.description ?? ''} onChange={(description) => setProject(index, { description })} max={600} multiline styles={styles} colors={colors} />
          {remove('Remove this project', () => setProfessional((current) => ({ ...current, projects: (current.projects ?? []).filter((_, at) => at !== index) })))}
        </Entry>)}
        {(professional.projects ?? []).length < 10 ? <AddRow label={(professional.projects ?? []).length ? 'Add another project' : 'Add a project'} onPress={() => setProfessional((current) => ({ ...current, projects: [...(current.projects ?? []), { name: '' }] }))} styles={styles} colors={colors} /> : null}
      </Section>

      <Section title="Education" styles={styles}>
        {professional.education.map((item, index) => <Entry key={index} styles={styles}>
          <Field label="School" value={item.institution} onChange={(institution) => setSchool(index, { institution })} max={120} styles={styles} colors={colors} />
          <View style={styles.pair}>
            <Field label="Degree" value={item.studyType ?? ''} onChange={(studyType) => setSchool(index, { studyType })} max={120} placeholder="B.Tech" styles={styles} colors={colors} grow />
            <View style={styles.pairDivider} />
            <Field label="Field" value={item.area ?? ''} onChange={(area) => setSchool(index, { area })} max={120} placeholder="Computer science" styles={styles} colors={colors} grow />
          </View>
          <View style={styles.pair}>
            <Field label="From" value={item.startDate ?? ''} onChange={(startDate) => setSchool(index, { startDate })} max={7} placeholder="2016" styles={styles} colors={colors} grow />
            <View style={styles.pairDivider} />
            <Field label="To" value={item.endDate ?? ''} onChange={(endDate) => setSchool(index, { endDate })} max={7} placeholder="2020" styles={styles} colors={colors} grow />
          </View>
          {remove('Remove this school', () => setProfessional((current) => ({ ...current, education: current.education.filter((_, at) => at !== index) })))}
        </Entry>)}
        {professional.education.length < 10 ? <AddRow label={professional.education.length ? 'Add another school' : 'Add a school'} onPress={() => setProfessional((current) => ({ ...current, education: [...current.education, { institution: '' }] }))} styles={styles} colors={colors} /> : null}
      </Section>

      {groups.map((group) => <Section key={group} title={groupTitles[group]} note={groupNotes[group]} styles={styles}>
        {fields.filter((item) => fieldDefinition(item.field)?.group === group).map((item) => {
          const definition = fieldDefinition(item.field)!;
          return <View key={item.field}>
            <Field icon={fieldIcons[item.field] ?? 'at-outline'} label={definition.label} value={item.value} onChange={(value) => setField(item.field, { value })} max={definition.max} placeholder={definition.placeholder} keyboard={definition.kind === 'email' ? 'email-address' : definition.kind === 'phone' ? 'phone-pad' : definition.kind === 'url' ? 'url' : 'default'} styles={styles} colors={colors} inline={wide}
              accessory={<Segmented label={`Who can see your ${definition.label}`} value={item.visibility} options={fieldVisibilities.map((choice) => [choice, visibilityLabels[choice]])} onChange={(visibility) => setField(item.field, { visibility: visibility as FieldVisibility })} styles={styles} small />} />
            {item.field === 'website' && /\./.test(item.value) ? <Text accessibilityRole="link" onPress={() => startImport('website')} style={[styles.inlineAction, wide && styles.inlineActionWide]}>Fill my profile from this site</Text> : null}
            {item.field === 'linkedin' ? <Text accessibilityRole="link" onPress={() => startImport('linkedin')} style={[styles.inlineAction, wide && styles.inlineActionWide]}>Fill my profile from my LinkedIn PDF or data export</Text> : null}
          </View>;
        })}
      </Section>)}

      <Section title="Open networks" note="Public. Your posts there also appear on your Open Media profile." styles={styles}>
        {openNetworks.map((network) => <Field key={network.id} icon={network.icon} label={network.label} value={networks[network.id] ?? ''} onChange={(value) => setNetworks((current) => ({ ...current, [network.id]: value }))} max={64} placeholder={network.placeholder} styles={styles} colors={colors} inline={wide} />)}
      </Section>
      <View style={{ height: Platform.OS === 'web' ? 32 : 72 }} />
    </ScrollView>
  </View>;
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
    <View style={styles.card}><Rows styles={styles}>
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
    </Rows></View>
    <Text style={styles.sectionNote}>Choose what to use. It fills the fields below; nothing is saved until you tap Save.{skipped?.length ? ` Skipped because the site asked: ${skipped.length} ${skipped.length === 1 ? 'page' : 'pages'}.` : ''}</Text>
  </View>;
}

/** Rows in a grouped card, with a hairline between each (iOS's inset grouped style). */
function Rows({ children, styles }: React.PropsWithChildren<{ styles: Styles }>) {
  const rows = Children.toArray(children).filter(isValidElement);
  return <>{rows.map((row, index) => <Fragment key={row.key ?? index}>{index ? <View style={styles.separator} /> : null}{row}</Fragment>)}</>;
}

function Section({ title, note, styles, children }: React.PropsWithChildren<{ title: string; note?: string; styles: Styles }>) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    <View style={styles.card}><Rows styles={styles}>{children}</Rows></View>
    {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
  </View>;
}

/** One role, project or school; its Remove line closes it off from the next. */
function Entry({ styles, children }: React.PropsWithChildren<{ styles: Styles }>) {
  return <View><Rows styles={styles}>{children}</Rows></View>;
}

function AddRow({ label, onPress, styles, colors }: { label: string; onPress: () => void; styles: Styles; colors: ThemeColors }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}>
    <Ionicons name="add-circle" size={20} color={colors.text} />
    <Text style={styles.addText}>{label}</Text>
  </Pressable>;
}

function Field({ label, icon, accessory, value, onChange, max, placeholder, multiline, keyboard, grow, inline, styles, colors }: { label: string; icon?: IconName; accessory?: React.ReactNode; inline?: boolean; value: string; onChange: (value: string) => void; max: number; placeholder?: string; multiline?: boolean; keyboard?: 'default' | 'email-address' | 'phone-pad' | 'url'; grow?: boolean; styles: Styles; colors: ThemeColors }) {
  const [focused, setFocused] = useState(false);
  const input = <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} maxLength={max} placeholder={placeholder} placeholderTextColor={colors.textTertiary} multiline={multiline} keyboardType={keyboard} autoCapitalize={keyboard && keyboard !== 'default' ? 'none' : 'sentences'} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.input, multiline && styles.multiline, inline && styles.grow]} />;
  if (inline) return <View style={[styles.fieldInline, focused && styles.fieldFocused]}>
    <View style={styles.inlineLabel}>{icon ? <Ionicons name={icon} size={16} color={colors.textSecondary} /> : null}<Text style={styles.inlineLabelText} numberOfLines={1}>{label}</Text></View>
    {input}
    {accessory}
  </View>;
  return <View style={[styles.field, grow && styles.grow, focused && styles.fieldFocused]}>
    <View style={styles.labelRow}>
      {icon ? <Ionicons name={icon} size={15} color={colors.textSecondary} /> : null}
      <Text style={[styles.label, styles.grow]} numberOfLines={1}>{label}</Text>
      {accessory}
    </View>
    {input}
  </View>;
}

/** A segmented control: the work status, and who may see each field. */
function Segmented({ label, value, options, onChange, small, styles }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void; small?: boolean; styles: Styles }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
    {options.map(([choice, text]) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: value === choice }} onPress={() => onChange(choice)} style={[styles.segment, small && styles.segmentSmall, value === choice && styles.segmentOn]}><Text style={[styles.segmentText, small && styles.segmentTextSmall, value === choice && styles.segmentTextOn]}>{text}</Text></Pressable>)}
  </View>;
}

function createStyles(colors: ThemeColors) {
  const hairline = StyleSheet.hairlineWidth;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    scroll: { flex: 1 },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
    bar: { borderBottomWidth: hairline, borderBottomColor: colors.border, backgroundColor: colors.surface },
    barInner: { width: '100%', maxWidth: 640, minHeight: 56, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
    back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
    save: { minWidth: 72, height: 36, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.text },
    saveText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
    disabled: { opacity: 0.45 },
    banner: { paddingHorizontal: 20, paddingVertical: 10, color: colors.text, fontSize: 13, textAlign: 'center', backgroundColor: colors.chrome },
    identity: { alignItems: 'center', paddingTop: 24, paddingBottom: 8 },
    avatar: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
    avatarText: { color: colors.surface, fontSize: 28, fontWeight: '700' },
    avatarBadge: { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.chrome },
    avatarNote: { marginTop: 8, color: colors.textTertiary, fontSize: 12 },
    identityName: { marginTop: 12, color: colors.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
    identityLine: { marginTop: 3, color: colors.textSecondary, fontSize: 14 },
    identityLinks: { marginTop: 8, color: colors.textTertiary, fontSize: 13 },
    link: { color: colors.textSecondary, textDecorationLine: 'underline' },
    importCard: { marginTop: 20, flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, borderWidth: hairline, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    importIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
    importTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    importActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    pill: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    pillText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    footnote: { marginTop: 3, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    note: { marginTop: 4, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    loading: { marginTop: 16 },
    section: { marginTop: 28 },
    sectionTitle: { marginBottom: 8, marginLeft: 4, color: colors.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
    sectionNote: { marginTop: 7, marginHorizontal: 4, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    card: { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.chrome },
    separator: { height: hairline, marginLeft: 14, backgroundColor: colors.border },
    pair: { flexDirection: 'row' },
    pairDivider: { width: hairline, backgroundColor: colors.border },
    grow: { flex: 1 },
    field: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
    fieldInline: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
    inlineLabel: { width: 132, flexDirection: 'row', alignItems: 'center', gap: 8 },
    inlineLabelText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '500' },
    fieldFocused: { backgroundColor: colors.surface },
    labelRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7 },
    label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    count: { color: colors.textTertiary, fontSize: 11 },
    input: { minHeight: 32, paddingVertical: 5, paddingHorizontal: 0, color: colors.text, fontSize: 16, outlineStyle: 'none' } as object,
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    rowInline: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
    segmented: { flexDirection: 'row', padding: 2, borderRadius: 9, backgroundColor: colors.surface },
    segment: { minHeight: 30, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
    segmentSmall: { minHeight: 24, paddingHorizontal: 8, borderRadius: 6 },
    segmentOn: { backgroundColor: colors.text },
    segmentText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    segmentTextSmall: { fontSize: 11 },
    segmentTextOn: { color: colors.surface },
    addRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
    addText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    pressed: { opacity: 0.6 },
    remove: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, color: colors.danger, fontSize: 14, fontWeight: '600' },
    inlineAction: { paddingHorizontal: 14, paddingBottom: 10, color: colors.textSecondary, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
    inlineActionWide: { paddingLeft: 156 },
    add: { color: colors.text, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
    hint: { color: colors.textTertiary, fontSize: 11 },
    cancel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
    importing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    proposal: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14 },
    proposalValue: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
    reviewActions: { flexDirection: 'row', gap: 20, alignItems: 'center', padding: 14 },
    message: { marginTop: 14, color: colors.text, fontSize: 13, lineHeight: 19 },
  });
}

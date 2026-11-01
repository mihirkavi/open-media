/**
 * Filling a profile from something the person already has (ADR 0020): their LinkedIn PDF or data
 * export, or their own portfolio website. Nothing here saves anything. Every reader returns
 * proposals, one per field, each saying where its value came from, and the person (or their agent,
 * with the person's approval) chooses which to use. `applyProposals` then merges the chosen ones
 * into what the person already has.
 */
import { cleanFieldValue, fieldDefinition, ProfileFieldError, ProfileFieldValue } from './profileFields';
import { EducationEntry, emptyProfessional, parseProfessional, ProfessionalProfile, ProjectEntry, unique, WorkEntry } from './professionalProfile';

/** What a proposal fills: the name or bio, a part of the professional profile, or a profile field (`field:website`). */
export type ProposalTarget = 'displayName' | 'bio' | 'headline' | 'summary' | 'location' | 'work' | 'education' | 'skills' | 'languages' | 'links' | 'projects' | `field:${string}`;

export interface ProfileProposal {
  /** Stable within one import, e.g. "headline" or "field:github"; pass these back to choose. */
  id: ProposalTarget;
  label: string;
  /** Text for scalars, a list of strings for skills and languages, entries for work, education, links and projects. */
  value: string | string[] | WorkEntry[] | EducationEntry[] | ProjectEntry[] | { label: string; url: string }[];
  /** The value in one or two plain lines, for review. */
  preview: string;
  /** Where it was read, e.g. "LinkedIn PDF · Experience" or "JSON-LD Person on https://asha.example/". */
  source: string;
}

export interface ProfileDraft {
  displayName: string;
  bio: string;
  professional: ProfessionalProfile;
  fields: ProfileFieldValue[];
}

const labels: Record<string, string> = {
  displayName: 'Name', bio: 'Bio', headline: 'Headline', summary: 'Summary', location: 'Location', work: 'Experience',
  education: 'Education', skills: 'Skills', languages: 'Languages', links: 'Links', projects: 'Projects',
};

export function proposalLabel(id: ProposalTarget): string {
  return id.startsWith('field:') ? fieldDefinition(id.slice(6))?.label ?? id.slice(6) : labels[id] ?? id;
}

/** Turns a read profile into one proposal per non-empty part, all with the same source unless `sources` says otherwise. */
export function proposalsFromProfessional(profile: ProfessionalProfile, source: string, sources: Partial<Record<ProposalTarget, string>> = {}): ProfileProposal[] {
  const out: ProfileProposal[] = [];
  const add = (id: ProposalTarget, value: ProfileProposal['value'], preview: string) => out.push({ id, label: proposalLabel(id), value, preview, source: sources[id] ?? source });
  if (profile.headline) add('headline', profile.headline, profile.headline);
  if (profile.summary) add('summary', profile.summary, short(profile.summary, 160));
  if (profile.location) add('location', profile.location, profile.location);
  if (profile.work.length) add('work', profile.work, profile.work.map((item) => `${item.position} at ${item.name}${item.startDate ? ` (${item.startDate}–${item.endDate ?? 'now'})` : ''}`).join('\n'));
  if (profile.education.length) add('education', profile.education, profile.education.map((item) => [item.institution, [item.studyType, item.area].filter(Boolean).join(', ')].filter(Boolean).join(' · ')).join('\n'));
  if (profile.skills.length) add('skills', profile.skills, profile.skills.join(', '));
  if (profile.languages.length) add('languages', profile.languages, profile.languages.join(', '));
  if (profile.links.length) add('links', profile.links, profile.links.map((item) => `${item.label}: ${item.url}`).join('\n'));
  if (profile.projects?.length) add('projects', profile.projects, profile.projects.map((item) => item.url ? `${item.name} · ${item.url}` : item.name).join('\n'));
  return out;
}

/** A proposal for one profile field (website, linkedin, github…), cleaned the way the editor cleans it; none if the value is not valid. */
export function fieldProposal(field: string, raw: string, source: string): ProfileProposal | undefined {
  try {
    const value = cleanFieldValue(field, raw);
    return value ? { id: `field:${field}`, label: proposalLabel(`field:${field}`), value, preview: value, source } : undefined;
  } catch (error) {
    if (error instanceof ProfileFieldError) return undefined;
    throw error;
  }
}

/** Social sites whose profile links become profile fields rather than plain links. */
const socialHosts: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'linkedin'], [/(^|\.)github\.com$/, 'github'], [/(^|\.)(x|twitter)\.com$/, 'x'], [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$/, 'facebook'], [/(^|\.)threads\.net$/, 'threads'], [/^bsky\.app$/, 'bluesky'], [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$/, 'youtube'], [/(^|\.)reddit\.com$/, 'reddit'], [/(^|\.)medium\.com$/, 'medium'], [/\.substack\.com$/, 'substack'],
  [/(^|\.)dribbble\.com$/, 'dribbble'], [/(^|\.)behance\.net$/, 'behance'], [/(^|\.)twitch\.tv$/, 'twitch'], [/(^|\.)pinterest\.com$/, 'pinterest'], [/^t\.me$/, 'telegram'],
];

/** The profile field a link belongs in (github.com/asha → github), or undefined for other sites. */
export function socialFieldFor(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return socialHosts.find(([pattern]) => pattern.test(host))?.[1];
  } catch { return undefined; }
}

/**
 * Keeps one proposal per target: the first one wins, so callers list their sources best first.
 * Lists from later sources are not mixed in; the person sees one clear source per field.
 */
export function firstPerTarget(proposals: ProfileProposal[]): ProfileProposal[] {
  const seen = new Set<string>();
  return proposals.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

/**
 * Merges the chosen proposals into the person's current profile. Text fields are replaced; skills,
 * languages and links are added to; work, education and projects add the entries not already
 * there. The result is checked like any other profile, so a bad value fails here, not later.
 */
export function applyProposals(draft: ProfileDraft, chosen: ProfileProposal[]): ProfileDraft {
  const next: ProfileDraft = { ...draft, professional: { ...emptyProfessional, ...draft.professional }, fields: [...draft.fields] };
  const pro = next.professional;
  const key = (...parts: (string | undefined)[]) => parts.map((part) => (part ?? '').trim().toLocaleLowerCase()).join('|');
  for (const proposal of chosen) {
    const value = proposal.value;
    switch (proposal.id) {
      case 'displayName': next.displayName = String(value).slice(0, 80); break;
      case 'bio': next.bio = String(value).slice(0, 240); break;
      case 'headline': pro.headline = String(value); break;
      case 'summary': pro.summary = String(value); break;
      case 'location': {
        pro.location = String(value);
        // The profile's Location field is where the app shows it; fill it when it is empty.
        const field = next.fields.find((item) => item.field === 'location');
        if (!field?.value.trim()) next.fields = [...next.fields.filter((item) => item.field !== 'location'), { field: 'location', value: String(value).slice(0, 120), visibility: field?.visibility ?? 'everyone' }];
        break;
      }
      case 'skills': pro.skills = unique([...pro.skills, ...(value as string[])]).slice(0, 50); break;
      case 'languages': pro.languages = unique([...pro.languages, ...(value as string[])]).slice(0, 10); break;
      case 'links': {
        const have = new Set(pro.links.map((item) => item.url));
        pro.links = [...pro.links, ...(value as { label: string; url: string }[]).filter((item) => !have.has(item.url))].slice(0, 8);
        break;
      }
      case 'work': {
        const have = new Set(pro.work.map((item) => key(item.name, item.position)));
        pro.work = [...pro.work, ...(value as WorkEntry[]).filter((item) => !have.has(key(item.name, item.position)))].slice(0, 20);
        break;
      }
      case 'education': {
        // One school and start year is one entry, however the degree is written ("BDes" or "Bachelor of Design - BDes").
        const schoolKey = (item: EducationEntry) => key(item.institution, item.startDate ?? item.studyType);
        const have = new Set(pro.education.map(schoolKey));
        pro.education = [...pro.education, ...(value as EducationEntry[]).filter((item) => !have.has(schoolKey(item)))].slice(0, 10);
        break;
      }
      case 'projects': {
        const have = new Set((pro.projects ?? []).map((item) => key(item.name)));
        pro.projects = [...(pro.projects ?? []), ...(value as ProjectEntry[]).filter((item) => !have.has(key(item.name)))].slice(0, 10);
        break;
      }
      default: {
        if (!proposal.id.startsWith('field:')) break;
        const field = proposal.id.slice(6);
        const definition = fieldDefinition(field);
        if (!definition) break;
        const existing = next.fields.find((item) => item.field === field);
        if (existing) next.fields = next.fields.map((item) => item.field === field ? { ...item, value: String(value) } : item);
        else next.fields.push({ field, value: String(value), visibility: definition.defaultVisibility });
      }
    }
  }
  next.professional = parseProfessional(pro);
  return next;
}

/** Picks proposals by id; with no ids, all of them. Unknown ids are an error, so an agent can't save something it didn't show. */
export function chooseProposals(proposals: ProfileProposal[], ids?: unknown): ProfileProposal[] {
  if (ids === undefined || ids === null) return proposals;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('accept must be a list of proposal ids.');
  const unknown = ids.filter((id) => !proposals.some((item) => item.id === id));
  if (unknown.length) throw new Error(`No proposal with id ${unknown.join(', ')}. Use the ids from the preview.`);
  return proposals.filter((item) => ids.includes(item.id));
}

export function short(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

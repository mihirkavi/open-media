/**
 * Professional profiles (ADR 0018): the work side of a person's Open Media profile, stored as a
 * subset of JSON Resume (https://jsonresume.org/schema) so it leaves Open Media in a format other
 * tools read: Reactive Resume, RenderCV and most resume builders import it directly.
 *
 * It is public, like the rest of a profile, so it holds only what people put on a CV: never a
 * birth date, home address, ID number or contact details. Importing a LinkedIn data export keeps
 * the same rule and drops those columns.
 */

export type OpenTo = 'work' | 'hiring';

export interface WorkEntry {
  /** Employer. */
  name: string;
  position: string;
  location?: string;
  /** "2021" or "2021-04". */
  startDate?: string;
  endDate?: string;
  summary?: string;
  highlights: string[];
}

export interface EducationEntry {
  institution: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
}

export interface ProfessionalProfile {
  headline?: string;
  summary?: string;
  openTo?: OpenTo;
  location?: string;
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  languages: string[];
  links: { label: string; url: string }[];
}

export const emptyProfessional: ProfessionalProfile = { work: [], education: [], skills: [], languages: [], links: [] };

const limits = { headline: 120, summary: 1200, line: 120, entrySummary: 600, highlight: 240, highlights: 6, work: 20, education: 10, skills: 50, skill: 40, languages: 10, links: 8, url: 300 };

export class ProfessionalError extends Error {}

/** Checks a professional profile from anywhere (the app, an agent, the database) and returns a clean copy. */
export function parseProfessional(value: unknown): ProfessionalProfile {
  if (value === null || value === undefined) return { ...emptyProfessional };
  const input = object(value, 'The professional profile must be an object.');
  allowOnly(input, ['headline', 'summary', 'openTo', 'location', 'work', 'education', 'skills', 'languages', 'links'], 'profile');
  const profile: ProfessionalProfile = {
    work: entries(input.work, limits.work, 'work').map((item, index) => {
      allowOnly(item, ['name', 'position', 'location', 'startDate', 'endDate', 'summary', 'highlights'], `work[${index}]`);
      const name = line(item.name, limits.line, `work[${index}].name`);
      const position = line(item.position, limits.line, `work[${index}].position`);
      if (!name || !position) throw new ProfessionalError('Each job needs an employer (name) and a position.');
      return dropEmpty({
        name, position,
        location: line(item.location, limits.line, `work[${index}].location`),
        startDate: date(item.startDate, `work[${index}].startDate`),
        endDate: date(item.endDate, `work[${index}].endDate`),
        summary: line(item.summary, limits.entrySummary, `work[${index}].summary`),
        highlights: strings(item.highlights, limits.highlights, limits.highlight, `work[${index}].highlights`),
      }) as WorkEntry;
    }),
    education: entries(input.education, limits.education, 'education').map((item, index) => {
      allowOnly(item, ['institution', 'area', 'studyType', 'startDate', 'endDate'], `education[${index}]`);
      const institution = line(item.institution, limits.line, `education[${index}].institution`);
      if (!institution) throw new ProfessionalError('Each education entry needs an institution.');
      return dropEmpty({
        institution,
        area: line(item.area, limits.line, `education[${index}].area`),
        studyType: line(item.studyType, limits.line, `education[${index}].studyType`),
        startDate: date(item.startDate, `education[${index}].startDate`),
        endDate: date(item.endDate, `education[${index}].endDate`),
      }) as EducationEntry;
    }),
    skills: unique(strings(input.skills, limits.skills, limits.skill, 'skills')),
    languages: unique(strings(input.languages, limits.languages, limits.skill, 'languages')),
    links: entries(input.links, limits.links, 'links').map((item, index) => {
      allowOnly(item, ['label', 'url'], `links[${index}]`);
      const url = httpsUrl(item.url);
      if (!url) throw new ProfessionalError(`links[${index}].url must be an https:// address.`);
      return { label: line(item.label, 40, `links[${index}].label`) || hostOf(url), url };
    }),
  };
  const headline = line(input.headline, limits.headline, 'headline'); if (headline) profile.headline = headline;
  const summary = line(input.summary, limits.summary, 'summary', true); if (summary) profile.summary = summary;
  const location = line(input.location, limits.line, 'location'); if (location) profile.location = location;
  if (input.openTo !== undefined && input.openTo !== null && input.openTo !== 'none') {
    if (input.openTo !== 'work' && input.openTo !== 'hiring') throw new ProfessionalError('openTo must be work, hiring or none.');
    profile.openTo = input.openTo;
  }
  return profile;
}

export function isEmptyProfessional(profile: ProfessionalProfile): boolean {
  return !profile.headline && !profile.summary && !profile.openTo && !profile.location && !profile.work.length && !profile.education.length && !profile.skills.length && !profile.languages.length && !profile.links.length;
}

/** The short lines a profile shows under the bio: headline, what they're open to, current role, skills. */
export function professionalLines(profile: ProfessionalProfile): { headline?: string; lines: string[] } {
  const current = profile.work.find((item) => !item.endDate) ?? profile.work[0];
  const school = profile.education[0];
  const lines = [
    profile.openTo === 'work' ? 'Open to work' : profile.openTo === 'hiring' ? 'Hiring' : undefined,
    current ? `${current.position} at ${current.name}${current.endDate ? ` (until ${current.endDate})` : ''}` : undefined,
    profile.work.length > 1 ? `Before: ${profile.work.filter((item) => item !== current).slice(0, 2).map((item) => `${item.position}, ${item.name}`).join(' · ')}` : undefined,
    school ? [school.studyType, school.area].filter(Boolean).join(', ') ? `${[school.studyType, school.area].filter(Boolean).join(', ')} · ${school.institution}` : school.institution : undefined,
    profile.skills.length ? `Skills: ${profile.skills.slice(0, 8).join(', ')}${profile.skills.length > 8 ? ` and ${profile.skills.length - 8} more` : ''}` : undefined,
  ].filter(Boolean) as string[];
  return { headline: profile.headline, lines };
}

// ---------- JSON Resume ----------

/** A JSON Resume document (schema v1) for the person, ready for Reactive Resume, RenderCV and others. */
export function toJsonResume(profile: ProfessionalProfile, person: { name: string; handle: string; url?: string }): Record<string, unknown> {
  return {
    $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics: dropEmpty({
      name: person.name,
      label: profile.headline,
      url: person.url,
      summary: profile.summary,
      location: profile.location ? { city: profile.location } : undefined,
      profiles: [{ network: 'Open Media', username: person.handle, ...(person.url ? { url: person.url } : {}) }, ...profile.links.map((link) => ({ network: link.label, url: link.url }))],
    }),
    work: profile.work.map((item) => dropEmpty({ name: item.name, position: item.position, location: item.location, startDate: item.startDate, endDate: item.endDate, summary: item.summary, highlights: item.highlights.length ? item.highlights : undefined })),
    education: profile.education.map((item) => dropEmpty({ institution: item.institution, area: item.area, studyType: item.studyType, startDate: item.startDate, endDate: item.endDate })),
    skills: profile.skills.map((name) => ({ name })),
    languages: profile.languages.map((language) => ({ language })),
    meta: { canonical: person.url, version: 'open-media.professional/1' },
  };
}

/** Reads a JSON Resume document. Contact details (email, phone, address) are left out on purpose. */
export function fromJsonResume(value: unknown): ProfessionalProfile {
  const resume = object(typeof value === 'string' ? safeJson(value) : value, 'That isn’t a JSON Resume document.');
  const basics = (resume.basics && typeof resume.basics === 'object' ? resume.basics : {}) as Record<string, unknown>;
  const location = basics.location && typeof basics.location === 'object' ? [(basics.location as Record<string, unknown>).city, (basics.location as Record<string, unknown>).region].filter((part) => typeof part === 'string' && part).join(', ') : undefined;
  const list = (key: string) => (Array.isArray(resume[key]) ? resume[key] as Record<string, unknown>[] : []).filter((item) => item && typeof item === 'object');
  return parseProfessional({
    headline: clip(basics.label, limits.headline),
    summary: clip(basics.summary, limits.summary),
    location: location || undefined,
    work: list('work').slice(0, limits.work).filter((item) => (item.name || item.company) && item.position).map((item) => dropEmpty({
      name: clip(item.name ?? item.company, limits.line), position: clip(item.position, limits.line), location: clip(item.location, limits.line),
      startDate: monthOf(item.startDate), endDate: monthOf(item.endDate), summary: clip(item.summary, limits.entrySummary),
      highlights: (Array.isArray(item.highlights) ? item.highlights : []).filter((entry): entry is string => typeof entry === 'string').slice(0, limits.highlights).map((entry) => entry.slice(0, limits.highlight)),
    })),
    education: list('education').slice(0, limits.education).filter((item) => item.institution).map((item) => dropEmpty({
      institution: clip(item.institution, limits.line), area: clip(item.area, limits.line), studyType: clip(item.studyType, limits.line), startDate: monthOf(item.startDate), endDate: monthOf(item.endDate),
    })),
    skills: list('skills').map((item) => clip(item.name, limits.skill)).filter(Boolean).slice(0, limits.skills),
    languages: list('languages').map((item) => clip(item.language, limits.skill)).filter(Boolean).slice(0, limits.languages),
    links: (Array.isArray(basics.profiles) ? basics.profiles as Record<string, unknown>[] : []).filter((item) => item && httpsUrl(item.url) && item.network !== 'Open Media').slice(0, limits.links).map((item) => ({ label: clip(item.network, 40) || hostOf(String(item.url)), url: httpsUrl(item.url) })),
  });
}

// ---------- LinkedIn data export ----------

/**
 * Reads the CSV files from LinkedIn's own “Download your data” export (Settings → Data privacy):
 * Profile.csv, Positions.csv, Education.csv, Skills.csv and Languages.csv. LinkedIn offers no API
 * for this, so the person downloads the files and gives them to Open Media or their agent. Birth
 * dates, addresses, phone numbers and the rest of the export are never read.
 */
export function fromLinkedInExport(files: Record<string, string>): { profile: ProfessionalProfile; used: string[] } {
  const byName = new Map(Object.entries(files).map(([name, text]) => [name.split('/').pop()!.toLocaleLowerCase(), text]));
  const used: string[] = [];
  const read = (name: string, required: string) => {
    const text = byName.get(name);
    if (!text) return [];
    const rows = csvRows(text, required);
    if (rows.length) used.push(name);
    return rows;
  };
  const profileRow = read('profile.csv', 'Headline')[0] ?? {};
  const websites = (profileRow['Websites'] ?? '').split(/[,\s]+/).map((part) => part.replace(/^\[?[A-Z_]+:/, '').replace(/[\[\]]/g, '')).map(httpsUrl).filter(Boolean) as string[];
  const profile = parseProfessional({
    headline: clip(profileRow['Headline'], limits.headline),
    summary: clip(profileRow['Summary'], limits.summary),
    location: clip(profileRow['Geo Location'], limits.line),
    work: read('positions.csv', 'Company Name').filter((row) => row['Company Name'] && row['Title']).slice(0, limits.work).map((row) => dropEmpty({
      name: clip(row['Company Name'], limits.line), position: clip(row['Title'], limits.line), location: clip(row['Location'], limits.line),
      startDate: monthOf(row['Started On']), endDate: monthOf(row['Finished On']), summary: clip(row['Description'], limits.entrySummary), highlights: [],
    })),
    education: read('education.csv', 'School Name').filter((row) => row['School Name']).slice(0, limits.education).map((row) => dropEmpty({
      institution: clip(row['School Name'], limits.line), studyType: clip(row['Degree Name'], limits.line), startDate: monthOf(row['Start Date']), endDate: monthOf(row['End Date']),
    })),
    skills: unique(read('skills.csv', 'Name').map((row) => clip(row['Name'], limits.skill)).filter(Boolean)).slice(0, limits.skills),
    languages: unique(read('languages.csv', 'Name').map((row) => clip(row['Name'], limits.skill)).filter(Boolean)).slice(0, limits.languages),
    links: unique(websites).slice(0, limits.links).map((url) => ({ label: hostOf(url), url })),
  });
  return { profile, used };
}

/** Parses CSV text (quoted fields, commas and newlines inside quotes) from the header row that contains `required`. */
export function csvRows(text: string, required: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = ''; let row: string[] = []; let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  // LinkedIn puts notes above the header in some files; start at the row that names the columns.
  const start = rows.findIndex((cells) => cells.some((cell) => cell.trim() === required));
  if (start < 0) return [];
  const header = rows[start].map((cell) => cell.trim());
  return rows.slice(start + 1).filter((cells) => cells.some((cell) => cell.trim())).map((cells) => Object.fromEntries(header.map((name, index) => [name, (cells[index] ?? '').trim()])));
}

// ---------- Plain words in Search ----------

export interface ProfessionalIntent {
  /** The row's title, e.g. “Set your headline to “Product designer””. */
  title: string;
  /** Fields to merge into the profile. */
  change: Partial<Pick<ProfessionalProfile, 'headline' | 'openTo' | 'skills'>> & { clearOpenTo?: true };
}

/**
 * Reads plain sentences typed in Search into one profile change: “my headline is Product designer”,
 * “I’m open to work”, “I’m hiring”, “not open to work”, “add skills Figma, user research”.
 */
export function professionalIntent(input: string): ProfessionalIntent | undefined {
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 6 || value.length > 200) return undefined;
  const headline = value.match(/^(?:set |change |update )?my (?:headline|title|professional headline) (?:is|to|=|:)\s*["“']?(.{2,120}?)["”']?$/i);
  if (headline) return { title: `Set your headline to “${headline[1]}”`, change: { headline: headline[1] } };
  if (/^(?:i'?m|i am) (?:no longer|not) (?:open to work|looking(?: for (?:a )?(?:job|work))?|hiring)$|^(?:not|stop being) open to work$|^(?:stop|done) hiring$/i.test(value)) return { title: 'Stop showing “Open to work” or “Hiring” on your profile', change: { clearOpenTo: true } };
  if (/^(?:i'?m|i am) (?:now )?(?:open to work|looking for (?:a )?(?:job|work|new role|role)|job hunting)$|^open to work$/i.test(value)) return { title: 'Show “Open to work” on your profile', change: { openTo: 'work' } };
  if (/^(?:i'?m|i am|we'?re|we are) (?:now )?hiring$/i.test(value)) return { title: 'Show “Hiring” on your profile', change: { openTo: 'hiring' } };
  const skills = value.match(/^(?:add )?(?:my )?skills?(?: are| is|:)?\s+(.{2,200})$/i);
  if (skills && /^add |^my skills|^skills:/i.test(value)) {
    const list = skills[1].split(/,|\band\b/).map((item) => item.trim()).filter((item) => item.length > 1).slice(0, 20);
    if (list.length) return { title: `Add ${list.join(', ')} to your skills`, change: { skills: list } };
  }
  return undefined;
}

/** Applies a Search change to a profile; skills are added, never replaced. */
export function applyProfessionalIntent(profile: ProfessionalProfile, intent: ProfessionalIntent): ProfessionalProfile {
  const { clearOpenTo, ...change } = intent.change;
  const next: ProfessionalProfile = { ...profile, ...change, skills: change.skills ? unique([...profile.skills, ...change.skills]) : profile.skills };
  if (clearOpenTo) delete next.openTo;
  return parseProfessional(next);
}

// ---------- helpers ----------

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfessionalError(message);
  return value as Record<string, unknown>;
}

function allowOnly(value: Record<string, unknown>, keys: string[], where: string) {
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) throw new ProfessionalError(`Unknown ${where} field${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}.`);
}

function line(value: unknown, max: number, where: string, multiline = false): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ProfessionalError(`${where} must be text.`);
  const clean = (multiline ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ')).trim();
  if (clean.length > max) throw new ProfessionalError(`${where} can be up to ${max} characters.`);
  return clean || undefined;
}

function strings(value: unknown, count: number, max: number, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ProfessionalError(`${where} must be a list.`);
  if (value.length > count) throw new ProfessionalError(`${where} can have up to ${count} items.`);
  return value.map((item, index) => line(item, max, `${where}[${index}]`)).filter(Boolean) as string[];
}

function entries(value: unknown, count: number, where: string): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ProfessionalError(`${where} must be a list.`);
  if (value.length > count) throw new ProfessionalError(`${where} can have up to ${count} entries.`);
  return value.map((item) => object(item, `Each ${where} entry must be an object.`));
}

function date(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(value)) throw new ProfessionalError(`${where} must look like 2021 or 2021-04.`);
  return value;
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Jan 2020", "2020-01-15", "2020" → "2020-01" or "2020"; anything else is dropped. */
function monthOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLocaleLowerCase();
  const iso = text.match(/^(\d{4})(?:-(\d{2}))?/);
  if (iso && (!iso[2] || (Number(iso[2]) >= 1 && Number(iso[2]) <= 12))) return iso[2] ? `${iso[1]}-${iso[2]}` : iso[1];
  const named = text.match(/^([a-z]{3})[a-z]*\.? (\d{4})$/);
  if (named && months.includes(named[1])) return `${named[2]}-${String(months.indexOf(named[1]) + 1).padStart(2, '0')}`;
  return undefined;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function httpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > limits.url) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new ProfessionalError('That isn’t valid JSON.'); }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => { const key = value.toLocaleLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function dropEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '')) as T;
}

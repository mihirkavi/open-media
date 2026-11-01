/**
 * Reads the PDF LinkedIn makes from a profile (Profile → Resources → Save to PDF) after its text has
 * been taken out of the file (the Worker uses unpdf for that). LinkedIn lays it out the same way
 * every time: a side column (Contact, Top Skills, Languages, Certifications) and then the main
 * column (name, headline, location, Summary, Experience, Education). Email and phone in Contact are
 * never read; the LinkedIn address and the person's own sites become profile fields.
 *
 * The file is the person's own copy of their profile. Nothing here touches linkedin.com.
 */
import { fieldProposal, ProfileProposal, proposalsFromProfessional, socialFieldFor } from './profileImport';
import { clip, EducationEntry, monthOf, parseProfessional, unique, WorkEntry } from './professionalProfile';

/** One line of text, with its font size when the extractor knows it (the name is the largest). */
export interface PdfLine { text: string; size?: number }

const sideHeaders = ['Contact', 'Top Skills', 'Skills', 'Languages', 'Certifications', 'Honors-Awards', 'Publications', 'Patents', 'Projects'];
const mainHeaders = ['Summary', 'Experience', 'Education', 'Volunteer Experience', 'Licenses & Certifications', 'Honors & Awards'];
const monthWords = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const dateRange = new RegExp(`^((?:${monthWords} )?\\d{4})\\s*[-–]\\s*((?:${monthWords} )?\\d{4}|Present)(?:\\s*\\(.*\\))?$`, 'i');
const duration = /^(?:\d+ years?(?: \d+ months?)?|\d+ months?|less than a year)$/i;

export class LinkedInPdfError extends Error {}

/** True when the text looks like LinkedIn's profile PDF, so another resume isn't misread as one. */
export function looksLikeLinkedInPdf(lines: PdfLine[]): boolean {
  const texts = new Set(lines.map((line) => line.text));
  return texts.has('Experience') && (texts.has('Contact') || texts.has('Top Skills')) && lines.some((line) => /linkedin\.com\/in\//i.test(line.text) || /^Page \d+ of \d+$/.test(line.text));
}

/** Text from the extractor (newline-separated) or lines with sizes → proposals, each naming the PDF section it came from. */
export function fromLinkedInPdf(input: string | PdfLine[]): { proposals: ProfileProposal[]; displayName?: string } {
  const lines = (typeof input === 'string' ? input.split(/\r?\n/).map((text) => ({ text })) : input)
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text && !/^Page \d+ of \d+$/i.test(line.text));
  if (!looksLikeLinkedInPdf(lines)) throw new LinkedInPdfError('That PDF doesn’t look like LinkedIn’s profile PDF. On LinkedIn, open your profile, choose Resources → Save to PDF, and use that file.');
  const texts = lines.map((line) => line.text);
  const firstMain = texts.findIndex((text) => mainHeaders.includes(text));
  if (firstMain < 0) throw new LinkedInPdfError('No Experience or Education was found in that PDF.');

  // Side column: everything before the name, split into its sections.
  const side = new Map<string, string[]>();
  let current = '';
  let sideEnd = 0;
  for (let index = 0; index < firstMain; index += 1) {
    if (sideHeaders.includes(texts[index])) { current = texts[index]; side.set(current, []); sideEnd = index + 1; continue; }
    if (current) side.get(current)!.push(texts[index]);
  }
  // Name, headline and location sit between the side column and the first main section.
  const top = headerLines(lines, sideEnd, firstMain, side);
  const sections = mainSections(texts, firstMain);

  const work = experience(sections.get('Experience') ?? []);
  const education = schools(sections.get('Education') ?? []);
  const skills = unique([...(side.get('Top Skills') ?? []), ...(side.get('Skills') ?? [])].map((text) => clip(text, 40)).filter(Boolean)).slice(0, 50);
  const languages = unique((side.get('Languages') ?? []).map((text) => clip(text.replace(/\s*\([^)]*\)\s*$/, ''), 40)).filter(Boolean)).slice(0, 10);
  const profile = parseProfessional({
    headline: clip(top.headline, 120) || undefined,
    summary: clip((sections.get('Summary') ?? []).join(' '), 1200) || undefined,
    location: clip(top.location, 120) || undefined,
    work, education, skills, languages,
  });
  const proposals = proposalsFromProfessional(profile, 'LinkedIn PDF', {
    headline: 'LinkedIn PDF · under your name', location: 'LinkedIn PDF · under your name', summary: 'LinkedIn PDF · Summary',
    work: 'LinkedIn PDF · Experience', education: 'LinkedIn PDF · Education', skills: 'LinkedIn PDF · Top Skills', languages: 'LinkedIn PDF · Languages',
  });
  if (top.name) proposals.unshift({ id: 'displayName', label: 'Name', value: clip(top.name, 80), preview: clip(top.name, 80), source: 'LinkedIn PDF · name' });
  proposals.push(...contactProposals(side.get('Contact') ?? []));
  return { proposals, displayName: top.name };
}

function headerLines(lines: PdfLine[], start: number, end: number, side: Map<string, string[]>) {
  const block = lines.slice(start, end);
  // With font sizes, the name is the largest text on the page.
  const sized = block.filter((line) => line.size);
  let nameAt = -1;
  if (sized.length) {
    const largest = Math.max(...sized.map((line) => line.size!));
    nameAt = block.findIndex((line) => line.size === largest);
  }
  if (nameAt < 0) {
    // Without sizes: name, headline (one or two lines) and a place line, counted back from the first section.
    const tail = block.slice(-4).map((line) => line.text);
    const placeLast = tail.length > 1 && isPlace(tail[tail.length - 1]);
    nameAt = block.length - (placeLast ? 3 : 2);
    if (nameAt > 0 && !looksLikeName(block[nameAt].text) && looksLikeName(block[nameAt - 1].text)) nameAt -= 1;
  }
  const rest = block.slice(nameAt + 1).map((line) => line.text);
  const location = rest.length > 1 && isPlace(rest[rest.length - 1]) ? rest.pop() : undefined;
  // The last side section read on into the name and headline; keep only the lines before the name.
  const last = [...side.values()].pop();
  if (last) last.splice(last.length - (block.length - nameAt));
  return { name: block[nameAt]?.text, headline: rest.join(' '), location };
}

function mainSections(texts: string[], start: number): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = '';
  for (let index = start; index < texts.length; index += 1) {
    if (mainHeaders.includes(texts[index])) { current = texts[index]; sections.set(current, []); continue; }
    sections.get(current)?.push(texts[index]);
  }
  return sections;
}

/**
 * Experience: each role is [company], title, a date range, an optional place, then what they did.
 * Several roles at one company sit under the company name and its total time ("5 years 2 months").
 */
function experience(lines: string[]): WorkEntry[] {
  const dates = lines.map((text, index) => dateRange.test(text) ? index : -1).filter((index) => index >= 0);
  // First pass: where each role's heading starts and which company it belongs to. A role right
  // after a role at a grouped company stays in that group; the review step lets the person fix it.
  let group: string | undefined;
  const heads = dates.map((at) => {
    if (at >= 3 && duration.test(lines[at - 2])) { group = lines[at - 3]; return { start: at - 3, company: group }; }
    if (group) return { start: at - 1, company: group };
    return { start: Math.max(0, at - 2), company: at >= 2 ? lines[at - 2] : undefined };
  });
  const roles: WorkEntry[] = [];
  dates.forEach((at, order) => {
    const position = lines[at - 1];
    const company = heads[order].company;
    if (!position || !company || position === company) return;
    const [, from, to] = lines[at].match(dateRange)!;
    // What they did runs to the line before the next role's heading.
    const body = lines.slice(at + 1, order + 1 < dates.length ? heads[order + 1].start : lines.length);
    const place = body.length && isPlace(body[0]) ? body.shift() : undefined;
    roles.push(dropUndefined({
      name: clip(company, 120), position: clip(position, 120), location: place ? clip(place, 120) : undefined,
      startDate: monthOf(from), endDate: /present/i.test(to) ? undefined : monthOf(to),
      summary: clip(body.join(' '), 600) || undefined, highlights: [],
    }));
  });
  return roles.slice(0, 20);
}

/** Education: a school line, then "Degree, Field · (2013 - 2017)". */
function schools(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  for (const text of lines) {
    const years = text.match(/\(([^)]*\d{4}[^)]*)\)\s*$/);
    if (years && out.length) {
      const entry = out[out.length - 1];
      const degree = text.slice(0, years.index).replace(/\s*·\s*$/, '').trim();
      if (degree) {
        const [studyType, ...area] = degree.split(/,\s*/);
        entry.studyType = clip(studyType, 120) || undefined;
        if (area.length) entry.area = clip(area.join(', '), 120);
      }
      const [from, to] = years[1].split(/\s*[-–]\s*/);
      entry.startDate = monthOf(from); entry.endDate = monthOf(to);
    } else if (!years) out.push({ institution: clip(text, 120) });
  }
  return out.slice(0, 10).map(dropUndefined);
}

/** Contact: the LinkedIn address and the person's own sites. Email addresses and phone numbers are skipped. */
function contactProposals(lines: string[]): ProfileProposal[] {
  // LinkedIn wraps long addresses; join a line that ends without a label to the next.
  const joined: string[] = [];
  for (const text of lines) {
    if (joined.length && !/\)$/.test(joined[joined.length - 1]) && /^\(?[A-Za-z]+\)$|^[\w./-]+(\s\([A-Za-z]+\))?$/.test(text) && /[\w/-]$/.test(joined[joined.length - 1]) && !/@/.test(joined[joined.length - 1])) joined[joined.length - 1] = `${joined[joined.length - 1]}${text.startsWith('(') ? ' ' : ''}${text}`;
    else joined.push(text);
  }
  const out: ProfileProposal[] = [];
  for (const text of joined) {
    if (/@/.test(text) || /^\+?[\d\s().-]{6,}(\s\(\w+\))?$/.test(text)) continue;
    const match = text.match(/^(\S+)\s*\((LinkedIn|Portfolio|Personal|Company|Blog|Other|RSS Feed)\)$/i);
    if (!match) continue;
    const url = /^https?:\/\//i.test(match[1]) ? match[1] : `https://${match[1]}`;
    const kind = match[2].toLowerCase();
    const field = kind === 'linkedin' ? 'linkedin' : socialFieldFor(url) ?? 'website';
    if (out.some((item) => item.id === `field:${field}`)) continue;
    const proposal = fieldProposal(field, url, `LinkedIn PDF · Contact (${match[2]})`);
    if (proposal) out.push(proposal);
  }
  return out;
}

function isPlace(text: string): boolean {
  return text.length <= 80 && !/[.!?|@]$|\d{4}/.test(text) && (/^[\p{L} .'-]+(, [\p{L} .'-]+){1,3}$/u.test(text) || /\b(Area|Remote|Metropolitan|Region)\b/.test(text));
}

function looksLikeName(text: string): boolean {
  return text.length <= 60 && !/[|@,]/.test(text) && /^[\p{Lu}][\p{L}.'-]*(\s[\p{L}.'-]+){0,4}$/u.test(text);
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

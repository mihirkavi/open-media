/**
 * Resume formats through the JSON Resume project's own packages (ADR 0018), rather than our own
 * copies: the official schema validator, the official JSON Resume → RenderCV converter, and the
 * "even" theme for a readable resume page. A professional profile is turned into JSON Resume
 * once (src/domain/professionalProfile.ts); everything here starts from that document.
 */
import schemaPackage from '@jsonresume/schema';
import { convert as toRenderCv } from '@jsonresume/jsonresume-to-rendercv/convert.js';
import { render as renderEven } from 'jsonresume-theme-even';

type JsonResume = Record<string, unknown>;

/** Checks a document against the official JSON Resume schema. */
export function validateJsonResume(resume: unknown): { valid: boolean; errors: string[] } {
  let result: { valid: boolean; errors: string[] } = { valid: false, errors: ['Not checked.'] };
  schemaPackage.validate(resume, (errors, valid) => {
    result = { valid, errors: (errors ?? []).slice(0, 10).map((error) => error.stack ?? error.message ?? 'Invalid') };
  });
  return result;
}

/** The social networks the converter (and RenderCV) knows, by the lower-case name JSON Resume uses. */
const renderCvNetworks = ['facebook', 'github', 'gitlab', 'instagram', 'linkedin', 'medium', 'stackoverflow', 'twitter', 'youtube'];

/**
 * RenderCV's YAML input (rendercv render resume.yaml), made by the JSON Resume project's converter.
 * The converter reads skills grouped as "Software" and "Languages", work highlights rather than
 * summaries, and a fixed list of networks, so the document is shaped to that first.
 */
export async function renderCvYaml(resume: JsonResume): Promise<string> {
  const basics = (resume.basics ?? {}) as { location?: { city?: string; countryCode?: string }; profiles?: { network?: string; username?: string; url?: string }[] };
  const work = (Array.isArray(resume.work) ? resume.work : []) as { summary?: string; highlights?: string[] }[];
  const skills = (Array.isArray(resume.skills) ? resume.skills : []) as { name?: string }[];
  const languages = (Array.isArray(resume.languages) ? resume.languages : []) as { language?: string }[];
  const shaped = {
    ...resume,
    basics: {
      ...basics,
      // The converter joins city and country code; give it only what is there.
      location: basics.location?.city ? { ...basics.location, countryCode: basics.location.countryCode ?? '' } : undefined,
      profiles: (basics.profiles ?? []).filter((profile) => renderCvNetworks.includes(String(profile.network ?? '').toLowerCase()) && profile.username).map((profile) => ({ ...profile, network: String(profile.network).toLowerCase() })),
    },
    work: work.map((entry) => ({ ...entry, highlights: entry.highlights?.length ? entry.highlights : entry.summary ? [entry.summary] : [] })),
    skills: [
      { name: 'Software', keywords: skills.map((skill) => skill.name).filter(Boolean) },
      { name: 'Languages', keywords: languages.map((item) => item.language).filter(Boolean) },
    ],
  };
  const yaml = String(await toRenderCv(shaped));
  // Drop what the converter writes for empty fields, so RenderCV doesn't reject the file.
  return yaml.replace(/^(\s*location: .*?), (["']?)$/m, '$1$2')
    .replace(/^ {4}(publications|projects|additional_experience_and_awards): \[\]\n/gm, '')
    .replace(/^ {6}- label: "(?:Languages|Software)"\n {8}details: ""\n/gm, '')
    .replace(/^ {4}technologies:\n(?! {6}-)/m, '')
    .replace(/^ {2}social_networks:\n(?! {4}-)/m, '');
}

/** A resume page rendered by jsonresume-theme-even, for links in applications and for recruiters. */
export function resumeHtml(resume: JsonResume): string {
  return renderEven(resume as never);
}

/** The page's security headers: the theme's own styles only, no scripts, no outside requests except https images. */
export const resumePageHeaders: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'public, max-age=300',
};

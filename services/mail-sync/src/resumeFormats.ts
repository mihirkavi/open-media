/**
 * Resume formats through the JSON Resume project's own packages (ADR 0018), rather than our own
 * copies: the official schema validator, the official JSON Resume → RenderCV converter, and the
 * "even" theme for a readable resume page. A professional profile is turned into JSON Resume
 * once (src/domain/professionalProfile.ts); everything here starts from that document.
 */
import schemaPackage from '@jsonresume/schema';
import { convert as toRenderCv } from '@jsonresume/jsonresume-to-rendercv/convert.js';
import { render as renderEven } from 'jsonresume-theme-even';

import { darkColors, lightColors } from '../../../src/theme';

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

/**
 * The theme's own colour variables, set to Open Media's palette (src/theme.ts) so the page looks
 * like the app: black and white, warm grays, emphasis from weight rather than hue, Inter type,
 * and the reader's light or dark setting.
 */
const openMediaTheme = `<meta name="color-scheme" content="light dark">
<style>
:root{
  --color-background-light:${lightColors.surface};--color-dimmed-light:${lightColors.chrome};--color-primary-light:${lightColors.text};--color-secondary-light:${lightColors.textSecondary};--color-accent-light:${lightColors.accent};
  --color-background-dark:${darkColors.surface};--color-dimmed-dark:${darkColors.chrome};--color-primary-dark:${darkColors.text};--color-secondary-dark:${darkColors.textSecondary};--color-accent-dark:${darkColors.accent};
}
html,body{font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
body{letter-spacing:-0.005em}
h1{font-weight:700;letter-spacing:-0.03em}
h2,h3,h4{font-weight:600;letter-spacing:-0.015em}
a{color:var(--color-accent);text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--color-secondary)}
a:hover{text-decoration-color:currentColor}
svg{color:var(--color-secondary)}
time-duration{display:none}
hr,section{border-color:${lightColors.border}}
@media (prefers-color-scheme: dark){hr,section{border-color:${darkColors.border}}}
</style>`;

/** A resume page rendered by jsonresume-theme-even, for links in applications and for recruiters, in Open Media's look. */
export function resumeHtml(resume: JsonResume): string {
  return renderEven(resume as never)
    // The theme loads Lato from Google Fonts; the page uses Open Media's type and makes no outside requests.
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, '')
    // Its scripts only add "2 years"-style durations; the page runs no scripts at all.
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    // A year on its own stays a year, rather than the theme's "Jan 2016".
    .replace(/<time datetime="(\d{4})">[^<]*<\/time>/g, '<time datetime="$1">$1</time>')
    .replace('</head>', `${openMediaTheme}\n</head>`);
}

/** What /@handle/resume shows before the person has filled in their work profile, in the same look. */
export function noResumeHtml(name: string, profileUrl: string): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(name)} · Resume</title>${openMediaTheme}
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--color-background-light);color:var(--color-primary-light);font-size:16px;line-height:1.6;padding:24px;box-sizing:border-box}
@media (prefers-color-scheme: dark){body{background:var(--color-background-dark);color:var(--color-primary-dark)}}
main{max-width:460px;text-align:center}h1{font-size:28px;margin:0 0 8px}p{margin:8px 0;color:var(--color-secondary-light)}@media (prefers-color-scheme: dark){p{color:var(--color-secondary-dark)}}</style></head>
<body><main><h1>${escape(name)} has no resume yet</h1><p>A resume appears here once they add their work, education or skills to their Open Media profile.</p><p><a href="${escape(profileUrl)}">See their profile</a></p></main></body></html>`;
}

/** The page's security headers: the theme's own styles only, no scripts, no outside requests except https images. */
export const resumePageHeaders: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'public, max-age=300',
};

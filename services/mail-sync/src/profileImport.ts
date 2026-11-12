/**
 * The Worker's half of filling a profile from what a person already has (ADR 0020):
 *
 * - LinkedIn's "Save to PDF" file: its text is taken out with unpdf (MIT, the serverless build of
 *   Mozilla's PDF.js) and read by src/domain/linkedInPdf.ts. The file is never stored.
 * - The person's own website: read only after they asked for it, as a polite crawler would. Only
 *   https on port 443, every address the host resolves to must be public (no private, loopback or
 *   link-local networks, also after each redirect), robots.txt is obeyed for our user agent, at
 *   most four pages and /resume.json are read, each with a size and time limit. Pages are read as
 *   data (src/domain/portfolioExtract.ts) and nothing on them is followed as an instruction.
 */
import type { getDocumentProxy } from 'unpdf';

import { fromLinkedInPdf, LinkedInPdfError, PdfLine } from '../../../src/domain/linkedInPdf';
import { extractPortfolio, FetchedPage, relatedPageLinks } from '../../../src/domain/portfolioExtract';
import { ProfileProposal } from '../../../src/domain/profileImport';
import { fetchPublicPage, MarketplaceDeps } from './marketplace.js';

export const profileReaderAgent = 'OpenMediaProfileReader/1.0 (+https://openmedia.site/docs/profile-import)';
/** The token robots.txt rules name, e.g. "User-agent: OpenMediaProfileReader". */
export const profileReaderToken = 'OpenMediaProfileReader';

export const pdfLimitBytes = 2_000_000;
const pageLimitBytes = 1_000_000;
const resumeLimitBytes = 200_000;
const maxPages = 4;

export class ProfileImportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// ---------- LinkedIn PDF ----------

/** Lines of text with their font size, in reading order, from up to 10 pages. */
export async function pdfLines(bytes: Uint8Array): Promise<PdfLine[]> {
  if (bytes.byteLength > pdfLimitBytes) throw new ProfileImportError(413, 'That PDF is larger than 2 MB. LinkedIn’s profile PDF is usually under 200 KB.');
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new ProfileImportError(400, 'That file isn’t a PDF.');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  // pdf.js is the largest thing in the Worker; it loads only when someone imports a PDF.
  try { pdf = await (await import('unpdf')).getDocumentProxy(bytes.slice(), { disableFontFace: true }); }
  catch { throw new ProfileImportError(400, 'That PDF couldn’t be opened. Save it from LinkedIn again and retry.'); }
  const lines: PdfLine[] = [];
  try {
    for (let number = 1; number <= Math.min(pdf.numPages, 10); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      // Items on one baseline (same y) make one line; its size is the largest item's height.
      let current: { y: number; text: string; size: number } | undefined;
      for (const item of content.items as { str?: string; transform?: number[]; height?: number; hasEOL?: boolean }[]) {
        if (typeof item.str !== 'string' || !item.transform) continue;
        const y = Math.round(item.transform[5]);
        const size = Math.round((item.height || Math.abs(item.transform[3]) || 0) * 10) / 10;
        if (current && Math.abs(current.y - y) <= 1) { current.text += item.str; current.size = Math.max(current.size, size); }
        else {
          if (current?.text.trim()) lines.push({ text: current.text, size: current.size });
          current = { y, text: item.str, size };
        }
        if (item.hasEOL && current) { if (current.text.trim()) lines.push({ text: current.text, size: current.size }); current = undefined; }
      }
      if (current?.text.trim()) lines.push({ text: current.text, size: current.size });
    }
  } finally { await pdf.cleanup?.().catch?.(() => undefined); }
  return lines;
}

/** Proposals from LinkedIn's profile PDF, given as bytes (base64 from the app) or as text an agent already took out. */
export async function linkedInPdfProposals(input: { base64?: string; text?: string }): Promise<ProfileProposal[]> {
  let lines: PdfLine[] | string;
  if (typeof input.text === 'string' && input.text.trim()) lines = input.text.slice(0, 100_000);
  else if (typeof input.base64 === 'string' && input.base64) {
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(input.base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')), (char) => char.charCodeAt(0)); }
    catch { throw new ProfileImportError(400, 'linkedInPdf must be the PDF file as base64.'); }
    lines = await pdfLines(bytes);
    if (!lines.length) throw new ProfileImportError(400, 'That PDF has no text in it (it may be a scan). Use the PDF LinkedIn makes: your profile → Resources → Save to PDF.');
  } else throw new ProfileImportError(400, 'Give linkedInPdf (base64) or linkedInPdfText.');
  try { return fromLinkedInPdf(lines).proposals; }
  catch (error) { if (error instanceof LinkedInPdfError) throw new ProfileImportError(400, error.message); throw error; }
}

// ---------- robots.txt ----------

/**
 * Whether robots.txt lets `token` read `path` (RFC 9309): the group naming the token, else the "*"
 * group; the longest matching rule wins and Allow wins a tie; * and $ work as wildcards.
 */
export function robotsAllows(robots: string, token: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let open: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    const field = key.toLowerCase();
    if (field === 'user-agent') {
      if (!open || !lastWasAgent) { open = { agents: [], rules: [] }; groups.push(open); }
      open.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && open) {
      lastWasAgent = false;
      if (value || field === 'allow') open.rules.push({ allow: field === 'allow', pattern: value });
    } else lastWasAgent = false;
  }
  const lower = token.toLowerCase();
  const own = groups.filter((group) => group.agents.some((agent) => agent !== '*' && lower.startsWith(agent)));
  const chosen = own.length ? own : groups.filter((group) => group.agents.includes('*'));
  let best: { allow: boolean; length: number } | undefined;
  for (const rule of chosen.flatMap((group) => group.rules)) {
    if (!rule.pattern) continue;
    const regex = new RegExp(`^${rule.pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$')}`);
    if (!regex.test(path)) continue;
    if (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.allow)) best = { allow: rule.allow, length: rule.pattern.length };
  }
  return best ? best.allow : true;
}

// ---------- portfolio ----------

export type PortfolioDeps = MarketplaceDeps & {
  /** Local development only: also read http://localhost and 127.0.0.1 (the sample site). Never set in production. */
  allowLocal?: boolean;
};

/** Checks the address a person typed and returns it as a clean https URL, or explains what is wrong. */
export function portfolioUrl(raw: unknown, allowLocal = false): URL {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text.length > 300) throw new ProfileImportError(400, 'Give the address of your website, like https://yourname.com.');
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); }
  catch { throw new ProfileImportError(400, 'That isn’t a web address. Try something like https://yourname.com.'); }
  const local = allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!local && url.protocol !== 'https:') throw new ProfileImportError(400, 'Only https:// sites can be read.');
  if (url.username || url.password) throw new ProfileImportError(400, 'Leave the user name and password out of the address.');
  if (!local && url.port && url.port !== '443') throw new ProfileImportError(400, 'Only sites on the normal https port can be read.');
  if (/linkedin\.com$/i.test(url.hostname)) throw new ProfileImportError(400, 'Open Media doesn’t read linkedin.com (LinkedIn’s terms forbid it). Use your LinkedIn PDF or data export instead.');
  url.hash = '';
  return url;
}

/**
 * Reads the person's site and proposes profile values. Fetches robots.txt, the page, up to three
 * linked about/resume/projects pages on the same host, and /resume.json, in that order, each only
 * if robots.txt allows it.
 */
export async function readPortfolio(raw: unknown, deps: PortfolioDeps = {}): Promise<{ url: string; pagesRead: string[]; skipped: string[]; proposals: ProfileProposal[] }> {
  const start = portfolioUrl(raw, deps.allowLocal);
  const local = start.protocol === 'http:';
  const get = (url: string, maxBytes: number, accept: string) => local ? fetchLocal(url, maxBytes, deps) : fetchPublicPage(url, deps, maxBytes, { userAgent: profileReaderAgent, accept });
  const robotsPage = await get(new URL('/robots.txt', start).toString(), 100_000, 'text/plain');
  const robots = robotsPage && robotsPage.status === 200 && !/html/i.test(robotsPage.contentType) ? robotsPage.text : '';
  const allowed = (url: string) => { const parsed = new URL(url); return robotsAllows(robots, profileReaderToken, parsed.pathname + parsed.search); };
  const skipped: string[] = [];

  if (!allowed(start.toString())) throw new ProfileImportError(403, `${start.hostname}’s robots.txt asks programs like Open Media’s not to read that page, so it wasn’t read.`);
  const home = await get(start.toString(), pageLimitBytes, 'text/html,application/xhtml+xml');
  if (!home) throw new ProfileImportError(400, `${start.hostname} couldn’t be reached. Check the address; only public https sites can be read.`);
  if (home.status >= 400) throw new ProfileImportError(400, `${start.hostname} answered ${home.status}. Check the address.`);
  if (!/html|xml/i.test(home.contentType) && home.contentType) throw new ProfileImportError(400, 'That address isn’t a web page.');
  const pages: FetchedPage[] = [{ url: home.url, html: home.text }];

  for (const link of relatedPageLinks(home.text, home.url, maxPages - 1)) {
    if (!allowed(link)) { skipped.push(`${link} (robots.txt)`); continue; }
    const page = await get(link, pageLimitBytes, 'text/html,application/xhtml+xml');
    if (page && page.status < 400 && /html|xml/i.test(page.contentType)) pages.push({ url: page.url, html: page.text });
  }
  let jsonResume: { url: string; text: string } | undefined;
  const resumeUrl = new URL('/resume.json', start).toString();
  if (allowed(resumeUrl)) {
    const resume = await get(resumeUrl, resumeLimitBytes, 'application/json');
    if (resume && resume.status === 200 && /json/i.test(resume.contentType)) jsonResume = { url: resume.url, text: resume.text };
  } else skipped.push(`${resumeUrl} (robots.txt)`);

  const proposals = extractPortfolio({ url: home.url, pages, jsonResume });
  return { url: home.url, pagesRead: [...pages.map((page) => page.url), ...(jsonResume ? [jsonResume.url] : [])], skipped, proposals };
}

/** The local sample site in development; still limited in size and time, and only for localhost. */
async function fetchLocal(url: string, maxBytes: number, deps: PortfolioDeps) {
  const response = await (deps.fetch ?? fetch)(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': profileReaderAgent } }).catch(() => undefined);
  if (!response) return undefined;
  const text = (await response.text()).slice(0, maxBytes);
  return { url, status: response.status, text, contentType: response.headers.get('content-type') ?? '' };
}

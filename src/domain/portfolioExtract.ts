/**
 * Reads a person's own website into profile proposals (ADR 0020). The Worker fetches the pages
 * (portfolioFetch.ts); this file only reads HTML text, so it is the same everywhere and easy to
 * test. Sources, best first:
 *
 * 1. JSON Resume at /resume.json (https://jsonresume.org): the person wrote it for this.
 * 2. JSON-LD schema.org Person (https://schema.org/Person), or a ProfilePage's mainEntity.
 * 3. An h-card microformat (https://microformats.org/wiki/h-card).
 * 4. Open Graph and meta tags (og:title, og:description, description), and rel="me" links.
 * 5. Page text: a "Projects" or "Skills" heading and what is under it, the first "About" paragraph.
 *
 * Each field takes its value from the best source that has it, and says which one. Page content is
 * data: nothing in it is followed as an instruction, and only https links are kept.
 */
import { fieldProposal, firstPerTarget, ProfileProposal, proposalsFromProfessional, short, socialFieldFor } from './profileImport';
import { clip, fromJsonResume, hostOf, httpsUrl, parseProfessional, ProfessionalError, ProjectEntry, unique } from './professionalProfile';

export interface FetchedPage { url: string; html: string }

export interface PortfolioInput {
  /** The address the person gave; its canonical form becomes their Website field. */
  url: string;
  pages: FetchedPage[];
  /** /resume.json, when the site has one. */
  jsonResume?: { url: string; text: string };
}

export function extractPortfolio(input: PortfolioInput): ProfileProposal[] {
  const out: ProfileProposal[] = [];
  const site = httpsUrl(input.url);
  if (site) { const website = fieldProposal('website', site, 'The address you gave'); if (website) out.push(website); }

  if (input.jsonResume) {
    try {
      const raw = JSON.parse(input.jsonResume.text) as { basics?: { name?: unknown } };
      const source = `JSON Resume at ${input.jsonResume.url}`;
      if (typeof raw.basics?.name === 'string' && raw.basics.name.trim()) out.push(scalar('displayName', clip(raw.basics.name, 80), source));
      out.push(...proposalsFromProfessional(fromJsonResume(raw), source).flatMap((item) => item.id === 'links' ? splitLinks(item.value as { label: string; url: string }[], source, site) : [item]));
    } catch (error) { if (!(error instanceof ProfessionalError) && !(error instanceof SyntaxError)) throw error; }
  }

  const documents = input.pages.map((page) => ({ url: page.url, root: parseHtml(page.html) }));
  for (const { url, root } of documents) out.push(...fromJsonLd(root, url, site));
  for (const { url, root } of documents) out.push(...fromHCard(root, url, site));
  for (const { url, root } of documents) out.push(...fromMeta(root, url, site));
  for (const { url, root } of documents) out.push(...fromPageText(root, url));
  return firstPerTarget(out);
}

// ---------- sources ----------

type Json = Record<string, unknown>;

function fromJsonLd(root: Element, pageUrl: string, site: string): ProfileProposal[] {
  const nodes: Json[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      const node = value as Json;
      nodes.push(node);
      if (node['@graph']) collect(node['@graph']);
      if (node.mainEntity) collect(node.mainEntity);
    }
  };
  for (const script of findAll(root, (el) => el.tag === 'script' && /ld\+json/i.test(el.attrs.type ?? ''))) {
    try { collect(JSON.parse(textOf(script, true))); } catch { /* a broken block is skipped */ }
  }
  const isType = (node: Json, type: string) => ([] as unknown[]).concat(node['@type'] ?? []).some((item) => String(item).replace(/^https?:\/\/schema\.org\//, '') === type);
  const person = nodes.find((node) => isType(node, 'Person'));
  const source = `JSON-LD Person on ${pageUrl}`;
  const out: ProfileProposal[] = [];
  if (person) {
    const name = str(person.name) || [str(person.givenName), str(person.familyName)].filter(Boolean).join(' ');
    if (name) out.push(scalar('displayName', clip(name, 80), source));
    out.push(...describe(str(person.description), source));
    const employers = ([] as unknown[]).concat(person.worksFor ?? []).map((item) => typeof item === 'string' ? item : str((item as Json)?.name)).filter(Boolean);
    const title = str(person.jobTitle);
    if (title) out.push(scalar('headline', clip(employers[0] ? `${title} at ${employers[0]}` : title, 120), source));
    const address = (person.address ?? person.homeLocation) as Json | string | undefined;
    const place = typeof address === 'string' ? address : address ? [str(address.addressLocality), str(address.addressRegion), str(address.addressCountry)].filter(Boolean).join(', ') || str(address.name) : '';
    const professional = parseProfessional({
      location: clip(place, 120) || undefined,
      work: title && employers[0] ? [{ name: clip(employers[0], 120), position: clip(title, 120), highlights: [] }] : [],
      education: ([] as unknown[]).concat(person.alumniOf ?? []).map((item) => typeof item === 'string' ? item : str((item as Json)?.name)).filter(Boolean).slice(0, 10).map((institution) => ({ institution: clip(institution, 120) })),
      skills: unique(([] as unknown[]).concat(person.knowsAbout ?? []).map((item) => typeof item === 'string' ? item : str((item as Json)?.name)).map((item) => clip(item, 40)).filter(Boolean)).slice(0, 50),
      languages: unique(([] as unknown[]).concat(person.knowsLanguage ?? []).map((item) => typeof item === 'string' ? item : str((item as Json)?.name)).map((item) => clip(item, 40)).filter(Boolean)).slice(0, 10),
    });
    out.push(...proposalsFromProfessional(professional, source));
    out.push(...splitLinks(([] as unknown[]).concat(person.sameAs ?? []).map((item) => ({ label: '', url: absolute(str(item), pageUrl) })).filter((item) => item.url), source, site));
  }
  // Things the site lists as its own work.
  const projects: ProjectEntry[] = nodes.filter((node) => ['CreativeWork', 'SoftwareApplication', 'SoftwareSourceCode', 'VisualArtwork', 'Article', 'Book', 'MusicRecording', 'Movie'].some((type) => isType(node, type)) && str(node.name))
    .slice(0, 10).map((node) => dropEmpty({ name: clip(str(node.name), 120), url: absolute(str(node.url), pageUrl) || undefined, description: clip(str(node.description), 600) || undefined }));
  if (projects.length) out.push(list('projects', projects, `JSON-LD on ${pageUrl}`));
  return out;
}

function fromHCard(root: Element, pageUrl: string, site: string): ProfileProposal[] {
  const cards = findAll(root, (el) => classes(el).includes('h-card'));
  // Prefer the card that is the page's own (u-url or u-uid pointing at the site), else the first.
  const card = cards.find((el) => findAll(el, (child) => hasClass(child, 'u-url') || hasClass(child, 'u-uid')).some((child) => sameSite(absolute(child.attrs.href ?? '', pageUrl), site))) ?? cards[0];
  if (!card) return [];
  const source = `h-card on ${pageUrl}`;
  const prop = (name: string) => { const el = findAll(card, (child) => hasClass(child, name))[0]; return el ? clean(textOf(el)) : ''; };
  const out: ProfileProposal[] = [];
  const name = prop('p-name');
  if (name) out.push(scalar('displayName', clip(name, 80), source));
  out.push(...describe(prop('p-note'), source));
  const title = prop('p-job-title') || prop('p-role');
  const org = prop('p-org');
  if (title) out.push(scalar('headline', clip(org ? `${title} at ${org}` : title, 120), source));
  const place = [prop('p-locality'), prop('p-region'), prop('p-country-name')].filter(Boolean).join(', ');
  const skills = unique(findAll(card, (child) => hasClass(child, 'p-category')).map((el) => clip(clean(textOf(el)), 40)).filter(Boolean)).slice(0, 50);
  out.push(...proposalsFromProfessional(parseProfessional({
    location: clip(place, 120) || undefined,
    work: title && org ? [{ name: clip(org, 120), position: clip(title, 120), highlights: [] }] : [],
    skills,
  }), source));
  const links = findAll(card, (child) => hasClass(child, 'u-url')).map((el) => ({ label: clean(textOf(el)), url: absolute(el.attrs.href ?? '', pageUrl) })).filter((item) => item.url && !sameSite(item.url, site));
  out.push(...splitLinks(links, source, site));
  return out;
}

function fromMeta(root: Element, pageUrl: string, site: string): ProfileProposal[] {
  const meta = new Map<string, string>();
  for (const el of findAll(root, (item) => item.tag === 'meta')) {
    const key = (el.attrs.property ?? el.attrs.name ?? '').toLowerCase();
    if (key && el.attrs.content && !meta.has(key)) meta.set(key, clean(el.attrs.content));
  }
  const out: ProfileProposal[] = [];
  const ogSource = `Open Graph on ${pageUrl}`;
  const first = meta.get('profile:first_name'); const last = meta.get('profile:last_name');
  // og:title is a name only on profile pages; elsewhere it is a page title.
  if (first || last) out.push(scalar('displayName', clip([first, last].filter(Boolean).join(' '), 80), ogSource));
  else if (meta.get('og:type') === 'profile' && meta.get('og:title')) out.push(scalar('displayName', clip(meta.get('og:title')!, 80), ogSource));
  else if (meta.get('author')) out.push(scalar('displayName', clip(meta.get('author')!, 80), `meta author on ${pageUrl}`));
  const description = meta.get('og:description') ?? meta.get('description');
  if (description) out.push(...describe(description, meta.has('og:description') ? ogSource : `meta description on ${pageUrl}`));
  const rel = findAll(root, (el) => (el.tag === 'a' || el.tag === 'link') && /(^|\s)me(\s|$)/i.test(el.attrs.rel ?? ''))
    .map((el) => ({ label: clean(textOf(el)), url: absolute(el.attrs.href ?? '', pageUrl) })).filter((item) => item.url && !sameSite(item.url, site));
  out.push(...splitLinks(rel, `rel="me" links on ${pageUrl}`, site));
  return out;
}

const projectHeading = /^(projects?|selected (?:work|projects)|my work|work|portfolio|case studies|things i(?:'|’)?ve (?:made|built)|what i(?:'|’)?ve (?:made|built))$/i;
const skillsHeading = /^(skills|tools|toolkit|expertise|what i do|technologies|tech stack)$/i;
const aboutHeading = /^(about|about me|bio|hello|hi)$/i;

function fromPageText(root: Element, pageUrl: string): ProfileProposal[] {
  const blocks = flatten(root);
  const out: ProfileProposal[] = [];
  const source = (heading: string) => `“${heading}” on ${pageUrl}`;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block.level) continue;
    const section = sectionAfter(blocks, index);
    if (projectHeading.test(block.text)) {
      const projects = projectsIn(section, pageUrl);
      if (projects.length) out.push(list('projects', projects, source(block.text)));
    } else if (skillsHeading.test(block.text)) {
      const items = section.filter((item) => item.tag === 'li').map((item) => item.text);
      const skills = unique((items.length ? items : section.filter((item) => item.tag === 'p').flatMap((item) => item.text.split(/,|·|•|\|/))).map((item) => clip(item, 40)).filter((item) => item.length > 1)).slice(0, 50);
      if (skills.length) out.push(list('skills', skills, source(block.text)));
    } else if (aboutHeading.test(block.text)) {
      const paragraph = section.find((item) => item.tag === 'p' && item.text.length > 40);
      if (paragraph) out.push(...describe(paragraph.text, source(block.text)));
    }
  }
  return out;
}

function projectsIn(section: Block[], pageUrl: string): ProjectEntry[] {
  const projects: ProjectEntry[] = [];
  const subLevel = Math.min(...section.filter((item) => item.level).map((item) => item.level!));
  if (Number.isFinite(subLevel)) {
    section.forEach((item, index) => {
      if (item.level !== subLevel || !item.text) return;
      const rest = sectionAfter(section, index);
      const url = item.href ?? rest.find((next) => next.href)?.href;
      const description = rest.find((next) => next.tag === 'p')?.text;
      projects.push(dropEmpty({ name: clip(item.text, 120), url: absolute(url ?? '', pageUrl) || undefined, description: description ? clip(description, 600) : undefined }));
    });
  } else {
    for (const item of section.filter((next) => next.tag === 'li' && next.href)) projects.push({ name: clip(item.linkText || item.text, 120), url: absolute(item.href!, pageUrl) || undefined });
  }
  return projects.filter((item) => item.name).slice(0, 10).map((item) => dropEmpty(item as unknown as Record<string, unknown>) as unknown as ProjectEntry);
}

// ---------- helpers for proposals ----------

function scalar(id: 'displayName' | 'bio' | 'headline' | 'summary', value: string, source: string): ProfileProposal {
  return { id, label: id === 'displayName' ? 'Name' : id[0].toUpperCase() + id.slice(1), value, preview: id === 'summary' ? short(value, 160) : value, source };
}

function list(id: 'projects' | 'skills', value: ProjectEntry[] | string[], source: string): ProfileProposal {
  const preview = id === 'skills' ? (value as string[]).join(', ') : (value as ProjectEntry[]).map((item) => item.url ? `${item.name} · ${item.url}` : item.name).join('\n');
  return { id, label: id === 'skills' ? 'Skills' : 'Projects', value, preview, source };
}

/** A description is a bio when it fits (240), and also the summary when it is longer. */
function describe(text: string, source: string): ProfileProposal[] {
  const value = clean(text);
  if (value.length < 2) return [];
  if (value.length <= 240) return [scalar('bio', value, source)];
  const sentence = value.match(/^.{20,240}?[.!?](?=\s|$)/)?.[0];
  return [...(sentence ? [scalar('bio', sentence, source)] : []), scalar('summary', clip(value, 1200), source)];
}

/** Social profiles become their fields (github, x, linkedin…); other https links become profile links. */
function splitLinks(links: { label: string; url: string }[], source: string, site: string): ProfileProposal[] {
  const out: ProfileProposal[] = [];
  const plain: { label: string; url: string }[] = [];
  for (const link of links) {
    const url = httpsUrl(link.url);
    if (!url || sameSite(url, site)) continue;
    const field = socialFieldFor(url);
    const proposal = field ? fieldProposal(field, url, source) : undefined;
    if (proposal) { if (!out.some((item) => item.id === proposal.id)) out.push(proposal); }
    else if (!plain.some((item) => item.url === url)) plain.push({ label: clip(link.label, 40) || hostOf(url), url });
  }
  if (plain.length) out.push({ id: 'links', label: 'Links', value: plain.slice(0, 8), preview: plain.slice(0, 8).map((item) => `${item.label}: ${item.url}`).join('\n'), source });
  return out;
}

function sameSite(url: string, site: string): boolean {
  try { return Boolean(site) && new URL(url).hostname.replace(/^www\./, '') === new URL(site).hostname.replace(/^www\./, ''); } catch { return false; }
}

function absolute(href: string, base: string): string {
  if (!href) return '';
  try { return httpsUrl(new URL(href, base).toString()); } catch { return ''; }
}

function str(value: unknown): string {
  return typeof value === 'string' ? clean(value) : '';
}

function clean(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function dropEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '')) as T;
}

// ---------- a small, forgiving HTML reader ----------

export interface Element { tag: string; attrs: Record<string, string>; children: (Element | string)[] }

const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const rawTags = new Set(['script', 'style', 'textarea', 'title']);
/** Elements a missing end tag closes, as browsers do for p and li. */
const autoClose: Record<string, string[]> = { p: ['p'], li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr'], td: ['td', 'th'], th: ['td', 'th'], option: ['option'] };
const blockTags = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'table', 'form']);

/** Builds a tree from HTML well enough to read headings, links, microformats and JSON-LD. Never runs anything. */
export function parseHtml(html: string): Element {
  const root: Element = { tag: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source))) {
    if (match.index > last) stack[stack.length - 1].children.push(source.slice(last, match.index));
    last = tagPattern.lastIndex;
    const [, closing, rawTag, rawAttrs, selfClosing] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.map((el) => el.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const element: Element = { tag, attrs: attributes(rawAttrs), children: [] };
    const closes = autoClose[tag];
    if (closes || blockTags.has(tag)) {
      // A new block closes an open <p>, and a new <li> closes the open one.
      const open = stack[stack.length - 1];
      if (open.tag === 'p' || (closes && closes.includes(open.tag))) stack.pop();
    }
    stack[stack.length - 1].children.push(element);
    if (rawTags.has(tag)) {
      const end = source.toLowerCase().indexOf(`</${tag}`, last);
      const stop = end < 0 ? source.length : end;
      element.children.push(source.slice(last, stop));
      const after = source.indexOf('>', stop);
      last = tagPattern.lastIndex = after < 0 ? source.length : after + 1;
      continue;
    }
    if (!voidTags.has(tag) && !selfClosing) stack.push(element);
  }
  if (last < source.length) stack[stack.length - 1].children.push(source.slice(last));
  return root;
}

function attributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function findAll(root: Element, test: (el: Element) => boolean): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => { for (const child of el.children) if (typeof child !== 'string') { if (test(child)) out.push(child); walk(child); } };
  walk(root);
  return out;
}

function textOf(el: Element, raw = false): string {
  if (raw) return el.children.map((child) => typeof child === 'string' ? child : textOf(child, true)).join('');
  if (el.tag === 'script' || el.tag === 'style' || el.tag === 'template') return '';
  return el.children.map((child) => typeof child === 'string' ? child : `${blockTags.has(child.tag) || child.tag === 'br' ? ' ' : ''}${textOf(child)}`).join('');
}

function classes(el: Element): string[] {
  return (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
}

function hasClass(el: Element, name: string): boolean {
  return classes(el).includes(name);
}

interface Block { tag: string; level?: number; text: string; href?: string; linkText?: string }

/** The page in reading order as headings, paragraphs and list items, each with its first link. */
function flatten(root: Element): Block[] {
  const blocks: Block[] = [];
  const walk = (el: Element) => {
    for (const child of el.children) {
      if (typeof child === 'string' || ['script', 'style', 'template', 'nav', 'footer', 'head'].includes(child.tag)) continue;
      const heading = child.tag.match(/^h([1-6])$/);
      if (heading || child.tag === 'p' || child.tag === 'li') {
        const link = child.tag === 'a' ? child : findAll(child, (item) => item.tag === 'a' && Boolean(item.attrs.href))[0];
        blocks.push({ tag: child.tag, level: heading ? Number(heading[1]) : undefined, text: clean(textOf(child)), href: link?.attrs.href, linkText: link ? clean(textOf(link)) : undefined });
        if (child.tag === 'li') walk(child);
      } else walk(child);
    }
  };
  walk(root);
  return blocks;
}

/** The blocks under a heading, up to the next heading of the same or a higher level. */
function sectionAfter(blocks: Block[], index: number): Block[] {
  const level = blocks[index].level ?? 7;
  const out: Block[] = [];
  for (let at = index + 1; at < blocks.length; at += 1) {
    if (blocks[at].level && blocks[at].level! <= level) break;
    out.push(blocks[at]);
  }
  return out;
}

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', hellip: '…', copy: '©' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

/** Same-site links on a home page that probably say more about the person (about, resume, projects). */
export function relatedPageLinks(html: string, pageUrl: string, max = 3): string[] {
  const root = parseHtml(html);
  const base = new URL(pageUrl);
  const found: string[] = [];
  for (const el of findAll(root, (item) => item.tag === 'a' && Boolean(item.attrs.href))) {
    let url: URL;
    try { url = new URL(el.attrs.href, base); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== base.hostname) continue;
    url.hash = ''; url.search = '';
    if (url.toString() === base.toString() || !/\/(about|about-me|bio|resume|cv|projects?|work|portfolio)\/?$/i.test(url.pathname)) continue;
    if (!found.includes(url.toString())) found.push(url.toString());
    if (found.length >= max) break;
  }
  return found;
}

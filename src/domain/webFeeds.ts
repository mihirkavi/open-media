import { officialPublisher } from './webFeedDirectory';
import type { PostMedia, SocialPost } from './posts';
import { initialsFor } from './publicPosts';

/**
 * Web feeds (ADR 0024): RSS 2.0, RSS 1.0, Atom (RFC 4287) and JSON Feed 1.1 read into one shape,
 * then into the canonical post. Everything here is pure; the Worker fetches (services/mail-sync/src/webFeeds.ts).
 *
 * Feed HTML is never rendered. It becomes a short plain-text excerpt and at most one https image,
 * so nothing a publisher writes can run, track or restyle the app, and full articles stay on the
 * publisher's site.
 */

export type WebFeedFormat = 'rss' | 'rdf' | 'atom' | 'json';

/** A weather or emergency alert, from CAP 1.2 fields (NWS) or a Met Office warning title. */
export interface WebFeedAlert {
  event: string;
  severity: 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
  /** The Met Office's colour level, when the warning names one. */
  level?: 'red' | 'amber' | 'yellow';
  expires?: string;
  area?: string;
}

export interface WebFeedItem {
  id: string;
  url?: string;
  title: string;
  excerpt: string;
  imageUrl?: string;
  imageAlt?: string;
  author?: string;
  publishedAt?: string;
  categories: string[];
  audio?: { url: string; durationSeconds?: number };
  alert?: WebFeedAlert;
}

export interface ParsedWebFeed {
  format: WebFeedFormat;
  title: string;
  siteUrl?: string;
  /** The feed's own address, when it names one (`rel="self"`, `feed_url`). */
  selfUrl?: string;
  description?: string;
  iconUrl?: string;
  language?: string;
  /** The publisher's rights line, e.g. "Copyright 2024 NPR - For Personal Use Only". */
  rights?: string;
  /** RSS `ttl` or the syndication module's period, in minutes. */
  ttlMinutes?: number;
  /** RSS `skipHours` (0–23, GMT) and `skipDays`. */
  skipHours: number[];
  skipDays: string[];
  /** WebSub hub (W3C), recorded for later push support. */
  hubUrl?: string;
  /** The feed's own update time, used for items that carry none (Met Office warnings). */
  updatedAt?: string;
  items: WebFeedItem[];
}

export class WebFeedError extends Error {}

export const maxFeedItems = 25;
export const excerptLength = 280;
export const webFeedMimeTypes = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json', 'application/rdf+xml', 'application/xml', 'text/xml'];

// ---------- a small XML reader ----------

export interface XmlElement { ns: string; local: string; attrs: Record<string, string>; children: XmlNode[] }
export type XmlNode = XmlElement | string;

const xmlEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    // Unknown entities (often HTML's &nbsp; in sloppy feeds) stay as written; the HTML step reads them.
    return xmlEntities[name] ?? match;
  });
}

const maxNodes = 200_000;
const maxDepth = 64;

/**
 * Reads XML forgivingly into elements with resolved namespaces. DOCTYPEs are skipped, never read,
 * so no external or custom entity is ever expanded; unclosed tags are closed by their parent.
 */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { ns: '', local: '#document', attrs: {}, children: [] };
  const stack: { element: XmlElement; name: string; namespaces: Record<string, string> }[] = [{ element: root, name: '#document', namespaces: { xml: 'http://www.w3.org/XML/1998/namespace' } }];
  let index = 0;
  let nodes = 0;
  const text = source.replace(/^﻿/, '');
  const addText = (value: string) => { if (value) stack[stack.length - 1].element.children.push(value); };
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) { addText(decodeXml(text.slice(index))); break; }
    if (open > index) addText(decodeXml(text.slice(index, open)));
    if (++nodes > maxNodes) throw new WebFeedError('That feed is too large to read.');
    if (text.startsWith('<!--', open)) { const end = text.indexOf('-->', open + 4); index = end < 0 ? text.length : end + 3; continue; }
    if (text.startsWith('<![CDATA[', open)) { const end = text.indexOf(']]>', open + 9); addText(text.slice(open + 9, end < 0 ? text.length : end)); index = end < 0 ? text.length : end + 3; continue; }
    if (text.startsWith('<?', open)) { const end = text.indexOf('?>', open + 2); index = end < 0 ? text.length : end + 2; continue; }
    if (text.startsWith('<!', open)) {
      // A DOCTYPE, possibly with an internal subset: skipped whole and never interpreted.
      const bracket = text.indexOf('[', open);
      const close = text.indexOf('>', open);
      const end = bracket >= 0 && bracket < close ? text.indexOf(']>', bracket) : close;
      index = end < 0 ? text.length : end + (bracket >= 0 && bracket < close ? 2 : 1);
      continue;
    }
    // Find the tag's end, ignoring '>' inside quoted attribute values.
    let end = open + 1; let quote = '';
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break;
    }
    const body = text.slice(open + 1, end);
    index = end + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      const at = stack.map((entry) => entry.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const name = inner.match(/^[^\s/>]+/)?.[0];
    if (!name) continue;
    const attrs: Record<string, string> = {};
    for (const match of inner.slice(name.length).matchAll(/([^\s=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? match[4] ?? '');
    const parent = stack[stack.length - 1];
    const namespaces = { ...parent.namespaces };
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'xmlns') namespaces[''] = value;
      else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = value;
    }
    const colon = name.indexOf(':');
    const element: XmlElement = { ns: normalNamespace(namespaces[colon > 0 ? name.slice(0, colon) : ''] ?? ''), local: colon > 0 ? name.slice(colon + 1) : name, attrs, children: [] };
    parent.element.children.push(element);
    if (!selfClosing && stack.length < maxDepth) stack.push({ element, name, namespaces });
  }
  return root;
}

/** Media RSS is written both with and without its trailing slash. */
function normalNamespace(uri: string) {
  return uri === 'http://search.yahoo.com/mrss' ? 'http://search.yahoo.com/mrss/' : uri;
}

export const ns = {
  atom: 'http://www.w3.org/2005/Atom',
  rss1: 'http://purl.org/rss/1.0/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  content: 'http://purl.org/rss/1.0/modules/content/',
  media: 'http://search.yahoo.com/mrss/',
  dc: 'http://purl.org/dc/elements/1.1/',
  sy: 'http://purl.org/rss/1.0/modules/syndication/',
  itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
  cap12: 'urn:oasis:names:tc:emergency:cap:1.2',
  cap11: 'urn:oasis:names:tc:emergency:cap:1.1',
};

function elements(parent: XmlElement | undefined): XmlElement[] {
  return parent ? parent.children.filter((node): node is XmlElement => typeof node !== 'string') : [];
}
function all(parent: XmlElement | undefined, namespace: string | string[], local: string): XmlElement[] {
  const spaces = Array.isArray(namespace) ? namespace : [namespace];
  return elements(parent).filter((element) => element.local === local && spaces.includes(element.ns));
}
function first(parent: XmlElement | undefined, namespace: string | string[], local: string): XmlElement | undefined {
  return all(parent, namespace, local)[0];
}
/** All text inside an element, markup removed (used for plain fields). */
export function textOf(element: XmlElement | undefined): string {
  if (!element) return '';
  return element.children.map((node) => typeof node === 'string' ? node : textOf(node)).join('');
}
function value(parent: XmlElement | undefined, namespace: string | string[], local: string): string {
  return textOf(first(parent, namespace, local)).trim();
}
/** Serializes an element's children back to markup, for Atom's inline XHTML content. */
function innerXml(element: XmlElement): string {
  return element.children.map((node) => typeof node === 'string' ? node.replace(/&/g, '&amp;').replace(/</g, '&lt;') : `<${node.local}${Object.entries(node.attrs).map(([key, attr]) => ` ${key}="${attr.replace(/"/g, '&quot;')}"`).join('')}>${innerXml(node)}</${node.local}>`).join('');
}

// ---------- HTML to text ----------

const htmlEntities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä', ccedil: 'ç', ntilde: 'ñ', iacute: 'í', oacute: 'ó', uacute: 'ú', szlig: 'ß', deg: '°', times: '×', euro: '€', pound: '£', yen: '¥', shy: '' };

export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return htmlEntities[name.toLowerCase()] ?? match;
  });
}

/** Readable text from feed HTML: scripts, styles, embeds and captions removed, whitespace tidied. */
export function htmlToText(html: string): string {
  return decodeHtml(html
    .replace(/<(script|style|noscript|iframe|object|svg|figcaption|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|blockquote|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** WordPress and newsroom boilerplate that says nothing about the article. */
function withoutBoilerplate(text: string): string {
  return text
    .replace(/\s*The post .{1,300}? appeared first on .{1,120}?\.?\s*$/i, '')
    .replace(/\s*(\[(…|\.\.\.|&hellip;)\]|\[…\]|Continue reading.*|Read more.*|Read the full (story|article).*)$/i, '')
    .trim();
}

/** At most `max` characters, cut at a word, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

// ---------- URLs ----------

function resolveUrl(raw: string | undefined, base?: string): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch { return undefined; }
}

/** Images are loaded only over https. */
function httpsImage(raw: string | undefined, base: string | undefined): string | undefined {
  const url = resolveUrl(raw, base);
  if (!url || !url.startsWith('https://')) return undefined;
  return looksLikeTracker(url) ? undefined : url;
}

function looksLikeTracker(url: string) {
  return /(^|[/_.-])(pixel|tracking|tracker|beacon|spacer|1x1|blank)([/_.-]|\.(gif|png)|$)/i.test(url) || /feedburner\.com\/~r\/|feeds\.feedblitz|stats\.wp\.com|\/b\/ss\//i.test(url);
}

/** The first real image in article HTML: no tracking pixels, no 1×1 or tiny icons. */
function firstHtmlImage(html: string, base: string | undefined): { url: string; alt?: string } | undefined {
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const attr = (name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((part) => part !== undefined);
    const width = Number(attr('width')); const height = Number(attr('height'));
    if ((width && width < 48) || (height && height < 48)) continue;
    const url = httpsImage(decodeHtml(attr('src') ?? ''), base);
    if (url) return { url, alt: attr('alt') ? htmlToText(attr('alt')!) : undefined };
  }
  return undefined;
}

// ---------- dates ----------

/** An ISO time from RSS (RFC 822), Atom (RFC 3339) or Dublin Core dates; undefined when unreadable. */
export function feedDate(raw: string | undefined): string | undefined {
  const text = raw?.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  let time = Date.parse(text);
  // Some feeds write "UT" or drop the weekday's comma; one retry with those tidied.
  if (!Number.isFinite(time)) time = Date.parse(text.replace(/\bUT\b/, 'GMT').replace(/^[A-Za-z]{3},?\s*/, ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function durationSeconds(raw: string | undefined): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length > 3) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// ---------- parsing ----------

/** Reads RSS, Atom or JSON Feed text. Throws WebFeedError when it is none of them. */
export function parseWebFeed(source: string, feedUrl?: string): ParsedWebFeed {
  const text = source.trim();
  if (text.startsWith('{')) return parseJsonFeed(text, feedUrl);
  if (!text.startsWith('<')) throw new WebFeedError('That address doesn’t serve a web feed.');
  const document = parseXml(text);
  const top = elements(document)[0];
  if (!top) throw new WebFeedError('That address doesn’t serve a web feed.');
  if (top.local === 'feed' && (top.ns === ns.atom || top.ns === 'http://purl.org/atom/ns#')) return parseAtom(top, feedUrl);
  if (top.local === 'rss' && top.ns === '') return parseRss(top, feedUrl);
  if (top.local === 'RDF' && top.ns === ns.rdf) return parseRdf(top, feedUrl);
  if (top.local === 'html') throw new WebFeedError('That’s a web page, not a feed.');
  throw new WebFeedError('That address doesn’t serve a web feed.');
}

interface ItemParts {
  id?: string; url?: string; title?: string;
  summaryHtml?: string; contentHtml?: string; summaryText?: string;
  images: { url?: string; alt?: string; width?: number }[];
  author?: string; date?: string; categories: string[];
  audio?: { url: string; durationSeconds?: number };
  alert?: WebFeedAlert;
}

function finishItem(parts: ItemParts, base: string | undefined): WebFeedItem | undefined {
  const title = clip(htmlToText(parts.title ?? ''), 300);
  const summary = parts.summaryText ? decodeHtml(parts.summaryText).replace(/\s+/g, ' ').trim() : htmlToText(parts.summaryHtml ?? '');
  const fromContent = summary ? '' : htmlToText(parts.contentHtml ?? '');
  // NWS writes alerts as "* WHAT...Frost. * WHERE...Valley"; they read as "What: Frost. Where: Valley".
  const readable = parts.alert ? (summary || fromContent).replace(/\*\s*([A-Z][A-Z ]{1,30}?)\.\.\./g, (_, label: string) => `${label[0]}${label.slice(1).toLowerCase()}: `).trim() : summary || fromContent;
  let excerpt = clip(withoutBoilerplate(readable), excerptLength);
  if (excerpt && title && excerpt.replace(/…$/, '') === title) excerpt = '';
  const listed = parts.images.filter((image) => image.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    .map((image) => ({ url: httpsImage(image.url, base), alt: image.alt })).find((image) => image.url);
  const inline = listed ? undefined : firstHtmlImage(`${parts.contentHtml ?? ''} ${parts.summaryHtml ?? ''}`, base);
  const image = listed ?? inline;
  const url = resolveUrl(parts.url, base);
  if (!title && !excerpt) return undefined;
  const id = (parts.id?.trim() || url || `${title}|${parts.date ?? ''}`).slice(0, 500);
  return {
    id, ...(url ? { url } : {}), title, excerpt,
    ...(image?.url ? { imageUrl: image.url, ...(image.alt ? { imageAlt: clip(image.alt, 200) } : {}) } : {}),
    ...(parts.author ? { author: clip(htmlToText(parts.author), 80) } : {}),
    ...(feedDate(parts.date) ? { publishedAt: feedDate(parts.date) } : {}),
    categories: [...new Set(parts.categories.map((category) => htmlToText(category)).filter((category) => category && category.length <= 40))].slice(0, 6),
    ...(parts.audio ? { audio: parts.audio } : {}),
    ...(parts.alert ? { alert: parts.alert } : {}),
  };
}

/** Media RSS images: media:content and media:thumbnail, also inside media:group. */
function mediaImages(item: XmlElement): ItemParts['images'] {
  const groups = [item, ...all(item, ns.media, 'group')];
  const images: ItemParts['images'] = [];
  for (const group of groups) {
    const description = value(group, ns.media, 'description') || value(item, ns.media, 'description');
    for (const content of all(group, ns.media, 'content')) {
      const type = content.attrs.type ?? ''; const medium = content.attrs.medium ?? '';
      if (medium === 'image' || type.startsWith('image/') || (!medium && !type && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(content.attrs.url ?? ''))) images.push({ url: content.attrs.url, alt: description || undefined, width: Number(content.attrs.width) || undefined });
      const thumb = first(content, ns.media, 'thumbnail');
      if (thumb) images.push({ url: thumb.attrs.url, alt: description || undefined, width: Number(thumb.attrs.width) || 1 });
    }
    for (const thumb of all(group, ns.media, 'thumbnail')) images.push({ url: thumb.attrs.url, alt: description || undefined, width: Number(thumb.attrs.width) || 1 });
  }
  return images;
}

function capAlert(item: XmlElement): WebFeedAlert | undefined {
  const cap = [ns.cap12, ns.cap11];
  const event = value(item, cap, 'event');
  if (!event) return undefined;
  const severity = value(item, cap, 'severity').toLowerCase();
  return {
    event,
    severity: (['extreme', 'severe', 'moderate', 'minor'].includes(severity) ? severity : 'unknown') as WebFeedAlert['severity'],
    ...(feedDate(value(item, cap, 'expires')) ? { expires: feedDate(value(item, cap, 'expires')) } : {}),
    ...(value(item, cap, 'areaDesc') ? { area: clip(value(item, cap, 'areaDesc'), 200) } : {}),
  };
}

/** The Met Office titles its warnings "Yellow warning of fog affecting Northern Ireland". */
function metOfficeAlert(title: string): WebFeedAlert | undefined {
  const match = title.match(/^(Red|Amber|Yellow) warning of (.+?) affecting (.+)$/i);
  if (!match) return undefined;
  const level = match[1].toLowerCase() as 'red' | 'amber' | 'yellow';
  return { event: `${match[1]} warning: ${match[2][0].toUpperCase()}${match[2].slice(1)}`, level, severity: level === 'red' ? 'extreme' : level === 'amber' ? 'severe' : 'moderate', area: match[3] };
}

function rssAuthor(item: XmlElement): string | undefined {
  const author = first(item, '', 'author');
  // Some feeds put an Atom-style <name> inside <author>.
  const named = value(author, ['', ns.atom], 'name');
  const text = named || textOf(author).trim();
  // RSS 2.0's author is an email address, often "jane@example.com (Jane Doe)".
  const paren = text.match(/\(([^)]+)\)\s*$/)?.[1];
  const clean = paren ?? (/^\S+@\S+$/.test(text) ? '' : text);
  return clean || value(item, ns.dc, 'creator') || value(item, ns.itunes, 'author') || undefined;
}

function rssItem(item: XmlElement, base: string | undefined, isRdf: boolean): WebFeedItem | undefined {
  const plain = isRdf ? [ns.rss1, ''] : [''];
  const title = value(item, plain, 'title');
  const guid = first(item, '', 'guid');
  const link = value(item, plain, 'link') || (guid && guid.attrs.isPermaLink !== 'false' && /^https?:/i.test(textOf(guid).trim()) ? textOf(guid).trim() : undefined) || item.attrs['rdf:about'];
  const enclosures = all(item, '', 'enclosure');
  const audioEnclosure = enclosures.find((enclosure) => /^audio\//.test(enclosure.attrs.type ?? '') || /\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.test(enclosure.attrs.url ?? ''));
  const audioUrl = audioEnclosure ? resolveUrl(audioEnclosure.attrs.url, base) : undefined;
  return finishItem({
    id: textOf(guid).trim() || undefined, url: link, title,
    summaryHtml: value(item, plain, 'description') || value(item, ns.itunes, 'summary'),
    contentHtml: value(item, ns.content, 'encoded'),
    images: [
      ...mediaImages(item),
      ...enclosures.filter((enclosure) => /^image\//.test(enclosure.attrs.type ?? '') || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(enclosure.attrs.url ?? '')).map((enclosure) => ({ url: enclosure.attrs.url, width: 2 })),
      ...(first(item, ns.itunes, 'image')?.attrs.href ? [{ url: first(item, ns.itunes, 'image')!.attrs.href, width: 1 }] : []),
    ],
    author: rssAuthor(item),
    date: value(item, '', 'pubDate') || value(item, ns.dc, 'date') || value(item, ns.atom, 'updated'),
    categories: [...all(item, '', 'category').map(textOf), ...all(item, ns.dc, 'subject').map(textOf)],
    ...(audioUrl ? { audio: { url: audioUrl, durationSeconds: durationSeconds(value(item, ns.itunes, 'duration')) } } : {}),
    alert: capAlert(item) ?? metOfficeAlert(htmlToText(title)),
  }, base);
}

function atomLinks(parent: XmlElement) {
  return all(parent, [ns.atom, 'http://purl.org/atom/ns#'], 'link').map((link) => ({ rel: link.attrs.rel ?? 'alternate', type: link.attrs.type ?? '', href: link.attrs.href, length: Number(link.attrs.length) || undefined }));
}

/** Channel-level fields shared by RSS 2.0 and RSS 1.0. */
function rssChannel(channel: XmlElement, feedUrl: string | undefined, format: 'rss' | 'rdf', itemsParent: XmlElement): ParsedWebFeed {
  const plain = format === 'rdf' ? [ns.rss1, ''] : [''];
  const base = feedUrl;
  const links = atomLinks(channel);
  const skipHours = all(first(channel, '', 'skipHours'), '', 'hour').map((hour) => Number(textOf(hour))).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  const skipDays = all(first(channel, '', 'skipDays'), '', 'day').map((day) => textOf(day).trim()).filter(Boolean);
  const ttl = Number(value(channel, '', 'ttl'));
  const period = value(channel, ns.sy, 'updatePeriod'); const frequency = Number(value(channel, ns.sy, 'updateFrequency')) || 1;
  const periodMinutes = ({ hourly: 60, daily: 1440, weekly: 10080, monthly: 43200, yearly: 525600 } as Record<string, number>)[period];
  const image = first(channel, plain, 'image') ?? first(itemsParent, plain, 'image');
  const siteUrl = resolveUrl(value(channel, plain, 'link'), base);
  const items = all(itemsParent, plain, 'item').map((item) => rssItem(item, base, format === 'rdf')).filter((item): item is WebFeedItem => Boolean(item));
  return {
    format,
    title: clip(htmlToText(value(channel, plain, 'title')), 120) || hostOf(siteUrl ?? feedUrl) || 'Web feed',
    ...(siteUrl ? { siteUrl } : {}),
    ...(resolveUrl(links.find((link) => link.rel === 'self')?.href, base) ? { selfUrl: resolveUrl(links.find((link) => link.rel === 'self')?.href, base) } : {}),
    ...(htmlToText(value(channel, plain, 'description')) ? { description: clip(htmlToText(value(channel, plain, 'description')), 300) } : {}),
    ...(httpsImage(value(image, plain, 'url') || image?.attrs['rdf:resource'], base) || httpsImage(first(channel, ns.itunes, 'image')?.attrs.href, base) ? { iconUrl: httpsImage(value(image, plain, 'url') || image?.attrs['rdf:resource'], base) ?? httpsImage(first(channel, ns.itunes, 'image')?.attrs.href, base) } : {}),
    ...(value(channel, plain, 'language') || value(channel, ns.dc, 'language') ? { language: value(channel, plain, 'language') || value(channel, ns.dc, 'language') } : {}),
    ...(value(channel, '', 'copyright') || value(channel, ns.dc, 'rights') ? { rights: clip(htmlToText(value(channel, '', 'copyright') || value(channel, ns.dc, 'rights')), 200) } : {}),
    ...(Number.isFinite(ttl) && ttl > 0 ? { ttlMinutes: ttl } : periodMinutes ? { ttlMinutes: Math.round(periodMinutes / frequency) } : {}),
    skipHours, skipDays,
    ...(resolveUrl(links.find((link) => link.rel === 'hub')?.href, base) ? { hubUrl: resolveUrl(links.find((link) => link.rel === 'hub')?.href, base) } : {}),
    ...(feedDate(value(channel, '', 'lastBuildDate') || value(channel, '', 'pubDate') || value(channel, ns.dc, 'date')) ? { updatedAt: feedDate(value(channel, '', 'lastBuildDate') || value(channel, '', 'pubDate') || value(channel, ns.dc, 'date')) } : {}),
    items: newestItems(items),
  };
}

function parseRss(rss: XmlElement, feedUrl?: string): ParsedWebFeed {
  const channel = first(rss, '', 'channel');
  if (!channel) throw new WebFeedError('That RSS feed has no channel.');
  return rssChannel(channel, feedUrl, 'rss', channel);
}

function parseRdf(rdf: XmlElement, feedUrl?: string): ParsedWebFeed {
  const channel = first(rdf, [ns.rss1, ''], 'channel');
  if (!channel) throw new WebFeedError('That RSS feed has no channel.');
  return rssChannel(channel, feedUrl, 'rdf', rdf);
}

/** Atom text constructs: type="html" holds escaped HTML, type="xhtml" inline markup, otherwise text. */
function atomText(element: XmlElement | undefined): { html?: string; text?: string } {
  if (!element) return {};
  const type = element.attrs.type ?? 'text';
  if (type === 'xhtml') return { html: innerXml(element) };
  if (type === 'html' || type === 'text/html') return { html: textOf(element) };
  return { text: textOf(element) };
}

function parseAtom(feed: XmlElement, feedUrl?: string): ParsedWebFeed {
  const atom = [feed.ns];
  const base = resolveUrl(feed.attrs['xml:base'], feedUrl) ?? feedUrl;
  const links = atomLinks(feed);
  const siteUrl = resolveUrl(links.find((link) => link.rel === 'alternate' && (!link.type || /html/.test(link.type)))?.href, base);
  const items = all(feed, atom, 'entry').map((entry) => {
    const entryBase = resolveUrl(entry.attrs['xml:base'], base) ?? base;
    const entryLinks = atomLinks(entry);
    const alternate = entryLinks.find((link) => link.rel === 'alternate' && (!link.type || /html/.test(link.type))) ?? entryLinks.find((link) => link.rel === 'alternate');
    const audio = entryLinks.find((link) => link.rel === 'enclosure' && /^audio\//.test(link.type));
    const audioUrl = audio ? resolveUrl(audio.href, entryBase) : undefined;
    const summary = atomText(first(entry, atom, 'summary'));
    const content = atomText(first(entry, atom, 'content'));
    return finishItem({
      id: value(entry, atom, 'id'), url: alternate?.href, title: atomText(first(entry, atom, 'title')).html ?? decodeHtml(atomText(first(entry, atom, 'title')).text ?? '').replace(/</g, '&lt;'),
      summaryHtml: summary.html, summaryText: summary.text,
      contentHtml: content.html ?? (content.text ? content.text.replace(/</g, '&lt;') : undefined),
      images: [...mediaImages(entry), ...entryLinks.filter((link) => link.rel === 'enclosure' && link.type.startsWith('image/')).map((link) => ({ url: link.href, width: 2 }))],
      author: value(first(entry, atom, 'author'), atom, 'name') || value(first(feed, atom, 'author'), atom, 'name') || undefined,
      date: value(entry, atom, 'published') || value(entry, atom, 'issued') || value(entry, atom, 'updated') || value(entry, atom, 'modified'),
      categories: all(entry, atom, 'category').map((category) => category.attrs.label || category.attrs.term || ''),
      ...(audioUrl ? { audio: { url: audioUrl } } : {}),
      alert: capAlert(entry),
    }, entryBase);
  }).filter((item): item is WebFeedItem => Boolean(item));
  const title = htmlToText(atomText(first(feed, atom, 'title')).html ?? atomText(first(feed, atom, 'title')).text ?? '');
  const subtitle = atomText(first(feed, atom, 'subtitle') ?? first(feed, atom, 'tagline'));
  const rights = atomText(first(feed, atom, 'rights') ?? first(feed, atom, 'copyright'));
  const icon = httpsImage(value(feed, atom, 'icon'), base) ?? httpsImage(value(feed, atom, 'logo'), base);
  return {
    format: 'atom',
    title: clip(title, 120) || hostOf(siteUrl ?? feedUrl) || 'Web feed',
    ...(siteUrl ? { siteUrl } : {}),
    ...(resolveUrl(links.find((link) => link.rel === 'self')?.href, base) ? { selfUrl: resolveUrl(links.find((link) => link.rel === 'self')?.href, base) } : {}),
    ...(subtitle.html || subtitle.text ? { description: clip(htmlToText(subtitle.html ?? subtitle.text!.replace(/</g, '&lt;')), 300) } : {}),
    ...(icon ? { iconUrl: icon } : {}),
    ...(feed.attrs['xml:lang'] ? { language: feed.attrs['xml:lang'] } : {}),
    ...(rights.html || rights.text ? { rights: clip(htmlToText(rights.html ?? rights.text!), 200) } : {}),
    skipHours: [], skipDays: [],
    ...(resolveUrl(links.find((link) => link.rel === 'hub')?.href, base) ? { hubUrl: resolveUrl(links.find((link) => link.rel === 'hub')?.href, base) } : {}),
    ...(feedDate(value(feed, atom, 'updated')) ? { updatedAt: feedDate(value(feed, atom, 'updated')) } : {}),
    items: newestItems(items),
  };
}

type JsonObject = Record<string, unknown>;
const str = (input: unknown) => (typeof input === 'string' ? input : typeof input === 'number' ? String(input) : undefined);

function parseJsonFeed(text: string, feedUrl?: string): ParsedWebFeed {
  let data: JsonObject;
  try { data = JSON.parse(text) as JsonObject; } catch { throw new WebFeedError('That JSON isn’t a JSON Feed.'); }
  if (!data || typeof data !== 'object' || !/jsonfeed\.org\/version\//.test(str(data.version) ?? '') || !Array.isArray(data.items)) throw new WebFeedError('That JSON isn’t a JSON Feed.');
  const base = feedUrl;
  const authorName = (input: unknown) => {
    const list = Array.isArray((input as JsonObject)?.authors) ? (input as JsonObject).authors as JsonObject[] : (input as JsonObject)?.author ? [(input as JsonObject).author as JsonObject] : [];
    return list.map((author) => str(author?.name)).filter(Boolean).join(', ') || undefined;
  };
  const items = (data.items as JsonObject[]).filter((item) => item && typeof item === 'object').map((item) => {
    const attachments = Array.isArray(item.attachments) ? item.attachments as JsonObject[] : [];
    const audio = attachments.find((attachment) => /^audio\//.test(str(attachment.mime_type) ?? ''));
    const audioUrl = audio ? resolveUrl(str(audio.url), base) : undefined;
    return finishItem({
      id: str(item.id), url: str(item.url) ?? str(item.external_url), title: (str(item.title) ?? '').replace(/</g, '&lt;'),
      summaryText: str(item.summary), contentHtml: str(item.content_html) ?? (str(item.content_text) ?? '').replace(/</g, '&lt;'),
      images: [{ url: str(item.image), width: 3 }, { url: str(item.banner_image), width: 2 }, ...attachments.filter((attachment) => /^image\//.test(str(attachment.mime_type) ?? '')).map((attachment) => ({ url: str(attachment.url), width: 1 }))],
      author: authorName(item) ?? authorName(data),
      date: str(item.date_published) ?? str(item.date_modified),
      categories: Array.isArray(item.tags) ? (item.tags as unknown[]).map(str).filter((tag): tag is string => Boolean(tag)) : [],
      ...(audioUrl ? { audio: { url: audioUrl, durationSeconds: typeof audio!.duration_in_seconds === 'number' ? audio!.duration_in_seconds : undefined } } : {}),
    }, base);
  }).filter((item): item is WebFeedItem => Boolean(item));
  const siteUrl = resolveUrl(str(data.home_page_url), base);
  const icon = httpsImage(str(data.favicon), base) ?? httpsImage(str(data.icon), base);
  const hub = Array.isArray(data.hubs) ? (data.hubs as JsonObject[]).map((entry) => resolveUrl(str(entry?.url), base)).find(Boolean) : undefined;
  return {
    format: 'json',
    title: clip(htmlToText(str(data.title) ?? ''), 120) || hostOf(siteUrl ?? feedUrl) || 'Web feed',
    ...(siteUrl ? { siteUrl } : {}),
    ...(resolveUrl(str(data.feed_url), base) ? { selfUrl: resolveUrl(str(data.feed_url), base) } : {}),
    ...(str(data.description) ? { description: clip(htmlToText(str(data.description)!), 300) } : {}),
    ...(icon ? { iconUrl: icon } : {}),
    ...(str(data.language) ? { language: str(data.language) } : {}),
    skipHours: [], skipDays: [],
    ...(hub ? { hubUrl: hub } : {}),
    items: newestItems(items),
  };
}

/** Newest first, at most `maxFeedItems`; undated items keep their order after dated ones. */
function newestItems(items: WebFeedItem[]): WebFeedItem[] {
  // Some feeds repeat an article under a second guid (BBC's "#0" and "#1"); one copy is kept.
  const seen = new Set<string>();
  const article = (item: WebFeedItem) => item.url ? `${item.url.replace(/[?#].*$/, '')}|${item.title}` : undefined;
  return items
    .filter((item) => {
      const keys = [item.id, article(item)].filter((key): key is string => Boolean(key));
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      return true;
    })
    .map((item, index) => ({ item, index, time: item.publishedAt ? Date.parse(item.publishedAt) : -Infinity }))
    .sort((a, b) => (b.time - a.time) || (a.index - b.index))
    .slice(0, maxFeedItems)
    .map(({ item }) => item);
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return undefined; }
}

// ---------- discovery ----------

export interface DiscoveredFeed { url: string; title?: string; type: string }

const feedTypes = /^(application\/(rss|atom|feed|rdf)\+(xml|json)|application\/json)$/i;

/**
 * Feeds a web page names through autodiscovery: `<link rel="alternate" type="application/rss+xml"
 * href="…">` (also Atom and JSON Feed), in page order, plus the page's own icon.
 */
export function discoverWebFeeds(html: string, pageUrl: string): { feeds: DiscoveredFeed[]; iconUrl?: string; title?: string } {
  const head = html.slice(0, 300_000);
  const feeds: DiscoveredFeed[] = [];
  const icons: { url: string; size: number }[] = [];
  for (const match of head.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1].matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs[attr[1].toLowerCase()] = decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    const type = (attrs.type ?? '').toLowerCase().split(';')[0].trim();
    if (rel.includes('alternate') && feedTypes.test(type) && !/comments?\b/i.test(attrs.title ?? '')) {
      const url = resolveUrl(attrs.href, pageUrl);
      if (url && !feeds.some((feed) => feed.url === url)) feeds.push({ url, type, ...(attrs.title ? { title: clip(htmlToText(attrs.title), 120) } : {}) });
    }
    if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
      const url = httpsImage(attrs.href, pageUrl);
      const size = rel.includes('apple-touch-icon') ? 180 : Number((attrs.sizes ?? '').split('x')[0]) || (/\.svg(\?|$)/i.test(attrs.href ?? '') ? 0 : 16);
      if (url && !/\.svg(\?|$)/i.test(url)) icons.push({ url, size });
    }
  }
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  // The largest declared icon, so it stays sharp in the card.
  const icon = icons.sort((a, b) => b.size - a.size)[0]?.url;
  return { feeds, ...(icon ? { iconUrl: icon } : {}), ...(title && htmlToText(title) ? { title: clip(htmlToText(title), 120) } : {}) };
}

/** Where sites usually keep a feed, tried only when a page names none. */
export function commonFeedPaths(pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  return ['/feed', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/feed.json'].map((path) => `${origin}${path}`);
}

// ---------- OPML ----------

export interface OpmlOutline { url: string; title?: string; siteUrl?: string }

/** Feeds in an OPML file (any reader's export); folders are flattened. */
export function parseOpml(text: string): OpmlOutline[] {
  const document = parseXml(text.slice(0, 2_000_000));
  const opml = elements(document).find((element) => element.local === 'opml');
  if (!opml) throw new WebFeedError('That file isn’t OPML. Export your subscriptions from your feed reader as OPML.');
  const found: OpmlOutline[] = [];
  const walk = (parent: XmlElement) => {
    for (const outline of all(parent, '', 'outline')) {
      const url = resolveUrl(outline.attrs.xmlUrl ?? outline.attrs.xmlurl);
      if (url && !found.some((item) => item.url === url)) found.push({ url, ...(outline.attrs.title || outline.attrs.text ? { title: clip(htmlToText(outline.attrs.title || outline.attrs.text), 200) } : {}), ...(resolveUrl(outline.attrs.htmlUrl) ? { siteUrl: resolveUrl(outline.attrs.htmlUrl) } : {}) });
      walk(outline);
    }
  };
  walk(first(opml, '', 'body') ?? opml);
  return found;
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An OPML 2.0 file of the person's feeds, which every feed reader imports. */
export function toOpml(feeds: { url: string; title: string; siteUrl?: string }[], ownerName?: string, now = new Date()): string {
  const lines = feeds.map((feed) => `    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''}/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${escapeXml(ownerName ? `${ownerName}’s web feeds on Open Media` : 'Web feeds on Open Media')}</title>\n    <dateCreated>${now.toUTCString()}</dateCreated>\n    <docs>https://opml.org/spec2.opml</docs>\n  </head>\n  <body>\n${lines.join('\n')}\n  </body>\n</opml>\n`;
}

// ---------- into the Feed ----------

export interface WebFeedPostInfo {
  feedUrl: string;
  siteName: string;
  siteUrl?: string;
  iconUrl?: string;
  format: WebFeedFormat;
  author?: string;
  rights?: string;
  /** How often Open Media reads this feed, in minutes. */
  refreshMinutes: number;
  /** Set when the feed is served from a news outlet's or weather service's own domain (webFeedDirectory). */
  official?: { name: string; domain: string };
  alert?: WebFeedAlert;
  audio?: { url: string; durationSeconds?: number };
}

export const formatNames: Record<WebFeedFormat, string> = { rss: 'RSS', rdf: 'RSS 1.0', atom: 'Atom', json: 'JSON Feed' };

/** Short, stable, non-cryptographic key (FNV-1a), for post ids. */
export function shortKey(text: string): string {
  let a = 0x811c9dc5; let b = 0x01000193 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/**
 * A feed item as a canonical post. The site is the author: its handle is the site's host, so
 * lenses can name it (“less from @theverge.com”). Following a feed is an explicit follow.
 */
export function socialPostFromFeedItem(feed: { url: string; title: string; siteUrl?: string; iconUrl?: string; parsed: ParsedWebFeed; refreshMinutes: number }, item: WebFeedItem, now = Date.now()): SocialPost {
  const host = hostOf(feed.siteUrl ?? feed.parsed.siteUrl ?? feed.url) ?? 'web feed';
  const official = officialPublisher(feed.url);
  const siteName = official?.name ?? feed.title;
  const published = item.publishedAt ?? feed.parsed.updatedAt;
  // A date in the future would pin an item to the top; it counts as now.
  const createdAt = published && Date.parse(published) <= now + 60 * 60_000 ? published : new Date(now).toISOString();
  const media: PostMedia[] | undefined = item.imageUrl ? [{ kind: 'image', url: item.imageUrl, aspectRatio: 16 / 9, altText: item.imageAlt ?? item.title }] : undefined;
  const webFeed: WebFeedPostInfo = {
    feedUrl: feed.url, siteName, ...(feed.siteUrl ?? feed.parsed.siteUrl ? { siteUrl: feed.siteUrl ?? feed.parsed.siteUrl } : {}),
    ...(feed.iconUrl ?? feed.parsed.iconUrl ? { iconUrl: feed.iconUrl ?? feed.parsed.iconUrl } : {}),
    format: feed.parsed.format, refreshMinutes: feed.refreshMinutes,
    ...(item.author ? { author: item.author } : {}), ...(feed.parsed.rights ? { rights: feed.parsed.rights } : {}),
    ...(official ? { official: { name: official.name, domain: official.domain } } : {}),
    ...(item.alert ? { alert: item.alert } : {}), ...(item.audio ? { audio: item.audio } : {}),
  };
  return {
    id: `rss:${shortKey(feed.url)}:${shortKey(item.id)}`,
    author: { id: `rss:${host}`, displayName: siteName, handle: host, initials: initialsFor(siteName), ...(webFeed.iconUrl ? { avatarUrl: webFeed.iconUrl } : {}) },
    title: item.title || undefined,
    body: item.excerpt,
    kind: media ? 'image' : 'link',
    createdAt,
    ...(media ? { media } : {}),
    topics: item.categories,
    provenance: { connectorId: 'rss', externalId: item.id, ...(item.url ? { canonicalURL: item.url } : {}) },
    relevance: { followsAuthor: true, selectedInterestMatches: [] },
    eligibility: {
      selection: `From ${siteName}’s web feed (${formatNames[feed.parsed.format]}), which you follow`,
      filters: ['Only the publisher’s headline, a short excerpt and one image are shown; the full article stays on their site', 'Items older than 30 days are left out'],
    },
    webFeed,
  };
}

/** Items older than this are not shown, so a quiet feed's old posts never surface as new. */
export const maxItemAgeDays = 30;

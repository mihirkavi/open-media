/**
 * Sharp logos for email senders without a BIMI mark. Sites publish icons in many sizes, and the
 * old fallback (favicon.ico) is usually 16–32 px, which looks blurry in a 48 px avatar. This finds
 * the largest icon a company's home page declares, checks its real pixel size, and refuses
 * anything under `minIconPixels`, so the app shows clean initials rather than a blurry picture.
 *
 * The app loads icons through this service, so the reader's device never contacts the sender's
 * site, and each result is cached for a week.
 */

export const minIconPixels = 96;
const maxIconBytes = 300 * 1024;
const maxPageBytes = 256 * 1024;
const timeoutMs = 5_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SenderIcon {
  bytes: Uint8Array;
  contentType: string;
}

interface Candidate {
  url: string;
  /** Declared size in pixels; Infinity for scalable SVG, 0 when unknown. */
  declared: number;
}

/** A registrable domain such as "vivino.com"; anything else is refused before any fetch. */
export function isIconDomain(domain: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}\.[a-z]{2,24}$/.test(domain) || /^(?!-)[a-z0-9-]{1,63}\.(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(domain);
}

export async function findSenderIcon(domain: string, fetchImpl: Fetch = fetch): Promise<SenderIcon | undefined> {
  if (!isIconDomain(domain)) return undefined;
  const page = await homePage(domain, fetchImpl);
  const candidates = [
    ...(page ? iconCandidates(page.html, page.url) : []),
    { url: `https://${domain}/apple-touch-icon.png`, declared: 180 },
    { url: `https://www.${domain}/apple-touch-icon.png`, declared: 180 },
    // Some sites refuse automated requests; Google's public icon service has their largest icon.
    // Only the domain is sent, from this server, never anything about the reader.
    { url: `https://www.google.com/s2/favicons?domain=${domain}&sz=256`, declared: 1 },
  ];
  const seen = new Set<string>();
  for (const candidate of candidates.sort((a, b) => b.declared - a.declared)) {
    if (seen.has(candidate.url) || seen.size >= 6) continue;
    seen.add(candidate.url);
    const icon = await download(candidate.url, fetchImpl);
    if (icon && (iconPixels(icon.bytes, icon.contentType) ?? 0) >= minIconPixels) return icon;
  }
  return undefined;
}

async function homePage(domain: string, fetchImpl: Fetch): Promise<{ html: string; url: string } | undefined> {
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (compatible; OpenMediaIconBot/1.0; +https://openmedia.site)' } });
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('html')) continue;
      // Icon links live in <head>, so the start of a large page is enough.
      return { html: new TextDecoder().decode(await readPrefix(response, maxPageBytes)), url: response.url || url };
    } catch {
      // Try the www host next.
    }
  }
  return undefined;
}

/** Icons a page declares in its <link> tags, with their declared sizes. Monochrome mask icons are skipped. */
export function iconCandidates(html: string, pageURL: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of html.slice(0, maxPageBytes).matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, 'rel')?.toLowerCase() ?? '';
    const href = attribute(tag, 'href');
    if (!href || !/\b(apple-touch-icon(-precomposed)?|icon)\b/.test(rel) || /mask-icon/.test(rel)) continue;
    let url: string;
    try { url = new URL(href, pageURL).toString(); } catch { continue; }
    if (!url.startsWith('https://')) continue;
    const sizes = attribute(tag, 'sizes')?.toLowerCase() ?? '';
    const type = attribute(tag, 'type')?.toLowerCase() ?? '';
    const scalable = sizes === 'any' || type === 'image/svg+xml' || /\.svg(\?|$)/i.test(url);
    const declared = scalable ? Infinity : Math.max(0, ...sizes.split(/\s+/).map((size) => Number(size.split('x')[0]) || 0), /apple-touch-icon/.test(rel) ? 180 : 0);
    candidates.push({ url, declared });
  }
  return candidates;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

async function download(url: string, fetchImpl: Fetch): Promise<SenderIcon | undefined> {
  try {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !/^image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(contentType)) return undefined;
    const bytes = await readLimited(response, maxIconBytes);
    return bytes ? { bytes, contentType } : undefined;
  } catch {
    return undefined;
  }
}

/** The first `limit` bytes of a body. */
async function readPrefix(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < limit) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    length += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(length, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

/** Reads a body, or undefined when it is larger than `limit`. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array | undefined> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > limit ? undefined : bytes;
}

/** The smaller side of an image in pixels (largest entry for .ico); Infinity for SVG; undefined if unreadable. */
export function iconPixels(bytes: Uint8Array, contentType: string): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === 'image/svg+xml') return /<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 4096))) ? Infinity : undefined;
  // PNG: width and height in the IHDR chunk.
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) return Math.min(view.getUint32(16), view.getUint32(20));
  // GIF: logical screen size.
  if (bytes.length > 10 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') return Math.min(view.getUint16(6, true), view.getUint16(8, true));
  // ICO: the largest image in the directory (0 means 256).
  if (bytes.length > 6 && view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) {
    let largest = 0;
    for (let index = 0; index < view.getUint16(4, true) && 6 + index * 16 + 2 <= bytes.length; index += 1) {
      const width = bytes[6 + index * 16] || 256;
      const height = bytes[7 + index * 16] || 256;
      largest = Math.max(largest, Math.min(width, height));
    }
    return largest || undefined;
  }
  // JPEG: the first start-of-frame marker.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return Math.min(view.getUint16(offset + 5), view.getUint16(offset + 7));
      offset += 2 + view.getUint16(offset + 2);
    }
    return undefined;
  }
  // WebP (VP8X carries the canvas size; simpler variants are rare for icons).
  if (bytes.length > 30 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' && String.fromCharCode(...bytes.slice(12, 16)) === 'VP8X') {
    return Math.min(1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)));
  }
  return undefined;
}

/**
 * Post formatting. Hive articles and Lens posts are written in Markdown, often mixed with a little
 * HTML. Open Media shows their structure (headings, paragraphs, lists, quotes, tables, emphasis and
 * links) instead of flattening it into one run of text. Images are left out here: a post's first
 * image is already its media, and the rest stay on the original page. Nothing is ever rendered as
 * HTML; tags are only read for the structure they imply.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'strike'; children: MdInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; url: string; children: MdInline[] };

export type MdBlock =
  | { kind: 'heading'; level: number; content: MdInline[] }
  | { kind: 'paragraph'; content: MdInline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: MdInline[][] }
  | { kind: 'quote'; content: MdInline[] }
  | { kind: 'table'; header: MdInline[][]; rows: MdInline[][][]; align: ('left' | 'right' | 'center')[] }
  | { kind: 'rule' }
  | { kind: 'code'; text: string };

/** Signs of Markdown worth rendering; plain text with none of them stays plain. */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|.*\|)|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\(https?:\/\/|```|<(p|br|center|div|b|strong|i|em|h\d)\b/i.test(text);
}

const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };

/** Markdown with the HTML that Hive authors mix in turned into Markdown, images removed, and a length cap at a line break. */
export function cleanPostMarkdown(source: string, maxChars = 3000): string {
  let text = source
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\[\/\/\]:\s*#.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<a\s[^>]*href=["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<\/?(p|div|center|blockquote|section|article|table|tr)\b[^>]*>/gi, '\n\n')
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (_, name: string) => entities[name]);
  // A line that is only an image or video address is the photo itself, already shown as media.
  text = text.split('\n').filter((line) => !/^\s*https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?\s*$/i.test(line) && !/^\s*https:\/\/(images\.hive\.blog|files\.peakd\.com|images\.ecency\.com)\/\S+\s*$/i.test(line)).join('\n');
  text = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf('\n', maxChars);
  return `${text.slice(0, cut > maxChars / 2 ? cut : maxChars).trimEnd()}\n\n…`;
}

const ruleLine = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const listLine = /^\s{0,3}([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const tableSeparator = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = markdown.split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) }); paragraph = []; };
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line.trim()) { flush(); continue; }
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (at += 1; at < lines.length && !/^\s*```/.test(lines[at]); at += 1) code.push(lines[at]);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) { flush(); blocks.push({ kind: 'heading', level: heading[1].length, content: parseInline(heading[2]) }); continue; }
    if (ruleLine.test(line)) { flush(); blocks.push({ kind: 'rule' }); continue; }
    if (line.includes('|') && at + 1 < lines.length && tableSeparator.test(lines[at + 1]) && lines[at + 1].includes('-')) {
      flush();
      const header = cells(line);
      const align = cells(lines[at + 1]).map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' as const : cell.endsWith(':') ? 'right' as const : 'left' as const);
      const rows: MdInline[][][] = [];
      for (at += 2; at < lines.length && lines[at].includes('|') && lines[at].trim(); at += 1) rows.push(cells(lines[at]).slice(0, header.length).map(parseInline));
      at -= 1;
      blocks.push({ kind: 'table', header: header.map(parseInline), rows, align: header.map((_, index) => align[index] ?? 'left') });
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; at < lines.length && /^\s{0,3}>/.test(lines[at]); at += 1) quoted.push(lines[at].replace(/^\s{0,3}>\s?/, ''));
      at -= 1;
      blocks.push({ kind: 'quote', content: parseInline(quoted.join('\n').trim()) });
      continue;
    }
    const item = line.match(listLine);
    if (item) {
      flush();
      const ordered = Boolean(item[2]);
      const items: MdInline[][] = [];
      for (; at < lines.length; at += 1) {
        const next = lines[at].match(listLine);
        if (next && Boolean(next[2]) === ordered) items.push(parseInline(next[3]));
        else if (lines[at].trim() && /^\s{2,}\S/.test(lines[at]) && items.length) items[items.length - 1] = [...items[items.length - 1], { kind: 'text', text: ` ${lines[at].trim()}` }];
        else break;
      }
      at -= 1;
      blocks.push({ kind: 'list', ordered, start: ordered ? Number(item[2]) : 1, items });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const inlinePattern = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\3(?![\p{L}\p{N}])|~~(?=\S)([\s\S]*?\S)~~|`([^`\n]+)`|\[((?:[^[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/u;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = text;
  while (rest) {
    const found = rest.match(inlinePattern);
    if (!found || found.index === undefined) { out.push({ kind: 'text', text: rest }); break; }
    // Underscores inside words (snake_case, @user_name) are not emphasis.
    if ((found[1] === '__' || found[3] === '_') && found.index > 0 && /[\p{L}\p{N}]/u.test(rest[found.index - 1])) {
      out.push({ kind: 'text', text: rest.slice(0, found.index + 1) });
      rest = rest.slice(found.index + 1);
      continue;
    }
    if (found.index > 0) out.push({ kind: 'text', text: rest.slice(0, found.index) });
    if (found[1]) out.push({ kind: 'strong', children: parseInline(found[2]) });
    else if (found[3]) out.push({ kind: 'em', children: parseInline(found[4]) });
    else if (found[5] !== undefined) out.push({ kind: 'strike', children: parseInline(found[5]) });
    else if (found[6] !== undefined) out.push({ kind: 'code', text: found[6] });
    else out.push({ kind: 'link', url: found[8], children: parseInline(found[7]) });
    rest = rest.slice(found.index + found[0].length);
  }
  return out;
}

/** The plain words of inline content, for measuring and accessibility. */
export function inlineText(content: MdInline[]): string {
  return content.map((part) => part.kind === 'text' || part.kind === 'code' ? part.text : inlineText(part.children)).join('');
}

/** A numeric cell (amounts, percentages, counts) reads best right-aligned. */
export function isNumericCell(content: MdInline[]): boolean {
  return /^[-+]?[$€£₹]?\s?\d[\d,.\s]*\s?(%|[A-Za-z$]{0,6})?$/.test(inlineText(content).trim());
}

const words = (text: string) => new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1));

/**
 * Cleaner structure for a card: an opening heading that repeats the post's title is dropped, and
 * rules stay only between running text; tables, headings and the card's edges separate themselves.
 */
export function tidyBlocks(blocks: MdBlock[], title?: string): MdBlock[] {
  let out = [...blocks];
  const first = out.find((block) => block.kind !== 'rule');
  if (title && first?.kind === 'heading') {
    const a = words(title); const b = words(inlineText(first.content));
    const shared = [...b].filter((word) => a.has(word)).length;
    if (b.size && shared / Math.max(a.size, b.size) >= 0.6) out.splice(out.indexOf(first), 1);
  }
  const plain = (block: MdBlock | undefined) => block?.kind === 'paragraph' || block?.kind === 'list' || block?.kind === 'quote';
  out = out.filter((block, index) => block.kind !== 'rule' || (plain(out[index - 1]) && plain(out[index + 1])));
  return out;
}

function blockSize(block: MdBlock): number {
  switch (block.kind) {
    case 'rule': return 20;
    case 'code': return block.text.length;
    case 'list': return block.items.reduce((sum, item) => sum + inlineText(item).length + 30, 0);
    case 'table': return 60 + Math.min(block.rows.length, collapsedTableRows) * 50;
    default: return inlineText(block.content).length + 20;
  }
}

/** Rows a table shows while its post is collapsed. */
export const collapsedTableRows = 4;

/** The opening blocks that fit in about `budget` characters (always at least one), and whether more follow. */
export function previewBlocks(blocks: MdBlock[], budget = 520): { blocks: MdBlock[]; more: boolean } {
  let used = 0;
  const shown: MdBlock[] = [];
  for (const block of blocks) {
    const size = blockSize(block);
    if (shown.length && used + size > budget) break;
    shown.push(block);
    used += size;
  }
  const more = shown.length < blocks.length || shown.some((block) => block.kind === 'table' && block.rows.length > collapsedTableRows);
  return { blocks: shown, more };
}

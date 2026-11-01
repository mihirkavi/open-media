/**
 * Where the searched words appear in a result, so they can be marked. Matching follows the search
 * itself (case-insensitive, anywhere in a word), so whatever made a result match is what is marked.
 */
export interface TextSegment { text: string; match: boolean }

/** The words worth marking: no # or @ prefix, at least two characters, longest first. */
export function highlightTerms(keywords: string[]): string[] {
  const terms = keywords.map((word) => word.replace(/^[#@]+/, '').trim()).filter((word) => word.length >= 2);
  return [...new Set(terms.map((word) => word.toLocaleLowerCase()))].sort((left, right) => right.length - left.length);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termPattern(terms: string[]): RegExp | undefined {
  // A mark runs to the end of the word, so “cook” marks all of “cooking” rather than clipping it.
  return terms.length ? new RegExp(`(?:${terms.map(escape).join('|')})[\\p{L}\\p{N}]*`, 'giu') : undefined;
}

export function splitHighlights(text: string, terms: string[]): TextSegment[] {
  const pattern = termPattern(terms);
  if (!pattern || !text) return [{ text, match: false }];
  const segments: TextSegment[] = [];
  let at = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index ?? 0;
    if (start > at) segments.push({ text: text.slice(at, start), match: false });
    segments.push({ text: found[0], match: true });
    at = start + found[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at), match: false });
  return segments;
}

/**
 * A short excerpt around the first searched word, cut on word boundaries, so a long message shows
 * the part that matched instead of its opening line. Without a match, the start of the text.
 */
export function snippetAround(text: string, terms: string[], length = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  const pattern = termPattern(terms);
  const index = pattern ? clean.search(pattern) : -1;
  if (index < 0) return `${clean.slice(0, clean.lastIndexOf(' ', length) > 0 ? clean.lastIndexOf(' ', length) : length)}…`;
  let start = Math.max(0, index - Math.floor(length / 3));
  let end = Math.min(clean.length, start + length);
  start = Math.max(0, end - length);
  if (start > 0) { const space = clean.indexOf(' ', start); if (space >= 0 && space < index) start = space + 1; }
  if (end < clean.length) { const space = clean.lastIndexOf(' ', end); if (space > index) end = space; }
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

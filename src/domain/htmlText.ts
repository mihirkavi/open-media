/**
 * Small HTML helpers shared by feeds and email. Kept separate from webFeeds.ts so
 * the message list does not pull feed parsing into the first page load.
 */

const htmlEntities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä', ccedil: 'ç', ntilde: 'ñ', iacute: 'í', oacute: 'ó', uacute: 'ú', szlig: 'ß', deg: '°', times: '×', euro: '€', pound: '£', yen: '¥', shy: '', zwnj: '', zwj: '' };

export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return htmlEntities[name.toLowerCase()] ?? match;
  });
}

const markupTag = /<\/?(p|br|div|span|td|tr|table|a\s+href|font|b|strong|em|i|u|li|ul|ol|h[1-6]|img|center|tbody|html|body)\b[^>]*>/gi;

/**
 * True when text that should be plain is really HTML, as when a sender pastes markup
 * into the text/plain part. Needs several tags (or tags plus entities), so a lone
 * "a < b" or a quoted "<p>" in a technical email is left alone.
 */
export function looksLikeHtml(text: string): boolean {
  const tags = text.match(markupTag)?.length ?? 0;
  if (tags >= 3) return true;
  const entities = text.match(/&(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi)?.length ?? 0;
  return tags >= 1 && entities >= 2;
}

/** Private-use characters that mark an exact link inside converted text: start, label/url split, end. */
export const linkMark = { start: '\uE000', split: '\uE001', end: '\uE002' } as const;

/**
 * Message-shaped text from HTML: paragraphs and line breaks kept, and each link marked with
 * `linkMark` around its exact label and URL, so the email formatter makes just those words tappable.
 */
export function htmlToMessageText(html: string): string {
  return decodeHtml(html
    .replace(/<(script|style|head|title|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\b[^>]*?\bhref\s*=\s*(["'])\s*(https?:\/\/[^"']+?)\s*\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_whole, _quote, url: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return text && !/^https?:\/\//i.test(text) ? `${linkMark.start}${text.replace(/[\uE000-\uE002]/g, '')}${linkMark.split}${url}${linkMark.end}` : ` ${url} `;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|table|ul|ol)\s*>/gi, '\n\n')
    .replace(/<\/(tr|li)\s*>|<li\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

import { convert } from 'html-to-text';
import type { ParsedMail } from 'mailparser';
import { looksLikeHtml } from '../../../src/domain/htmlText';

const maxLength = 50_000;

/**
 * The text to store for an email. mailparser only converts the HTML part when there is
 * no text/plain part, but some senders fill the text/plain part with HTML markup. Then,
 * or when the text part is empty, the HTML part is converted instead.
 */
export function bodyTextOf(parsed: Pick<ParsedMail, 'text' | 'html'>): string {
  const text = parsed.text?.trim() ?? '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  if (html && (!text || looksLikeHtml(text))) return htmlToText(html).slice(0, maxLength);
  return (parsed.text ?? '').slice(0, maxLength);
}

function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      // "label [url]" is read as a link by the app's email formatter.
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: false, linkBrackets: ['[', ']'] } },
      { selector: 'img', format: 'skip' },
      { selector: 'h1', options: { uppercase: false } }, { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'table', format: 'block' }, { selector: 'tr', format: 'block' }, { selector: 'td', format: 'inline' }, { selector: 'th', format: 'inline' },
    ],
  }).trim();
}

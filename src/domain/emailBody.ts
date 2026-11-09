/**
 * Turns the plain-text version of an email (often machine-converted from HTML)
 * into something that reads like a message: links become tappable words
 * instead of long tracking URLs, quoted reply history is dropped, invisible
 * characters and layout spacing are cleaned up.
 */

import { htmlToMessageText, linkMark, looksLikeHtml } from './htmlText';

export interface BodySegment {
  text: string;
  /** Present when this segment is a link. */
  url?: string;
}

export interface FormattedEmailBody {
  segments: BodySegment[];
  /** Plain text without links, for previews and search. */
  plain: string;
  /** True when earlier quoted messages were removed. */
  hadQuotedHistory: boolean;
}

const invisible = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g;
const quoteStarts = [
  /^On .{4,200}wrote:\s*$/i,
  /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i,
  /^From:\s.+$/i,
  /^Sent from my (iPhone|iPad|Android)/i,
];

export function formatEmailBody(raw: string): FormattedEmailBody {
  // Some senders put HTML in the plain-text part; read it as a message, links kept.
  let text = (looksLikeHtml(raw) ? htmlToMessageText(raw) : raw)
    .replace(/\r\n?/g, '\n')
    .replace(invisible, '')
    .replace(/ /g, ' ')
    .replace(/\t+/g, ' ');
  text = stripStyleRules(text);

  // Drop quoted history: the first "On … wrote:" / forwarded header, or a trailing block of "> " lines.
  const lines = text.split('\n');
  let cut = lines.findIndex((line, index) => index > 0 && quoteStarts.some((pattern) => pattern.test(line.trim())));
  if (cut === -1) {
    let start = lines.length;
    while (start > 0 && (/^\s*>/.test(lines[start - 1]) || (!lines[start - 1].trim() && start < lines.length))) start -= 1;
    if (start < lines.length && lines.slice(start).some((line) => /^\s*>/.test(line))) cut = start;
  }
  const hadQuotedHistory = cut > 0;
  if (hadQuotedHistory) text = lines.slice(0, cut).join('\n');

  text = text
    .split('\n')
    // Rows of ***, ===, --- or ___ are layout dividers in machine-made text.
    .map((line) => (/^\s*([*=_~#-])\1{3,}\s*$/.test(line) ? '' : line))
    .map((line) => dedupeRepeatedLabel(line.replace(/ {2,}/g, ' ').trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const segments = linkSegments(text);
  const plain = segments.map((segment) => segment.text).join('').replace(/\n{3,}/g, '\n\n').trim();
  return { segments, plain, hadQuotedHistory };
}

/** First readable line of an email, for conversation previews. */
export function emailPreview(raw: string, fallback = ''): string {
  const { plain } = formatEmailBody(raw);
  return plain.split('\n').map((line) => line.trim()).find((line) => line.length > 1) ?? fallback;
}

/**
 * Some senders paste their stylesheet into the plain-text version ("body, td { font-family: … }").
 * Removes rule blocks whose body is CSS declarations, innermost first so @media wrappers go too.
 * A rule's selector must start a line or follow another rule's brace, so ordinary sentences are kept.
 */
function stripStyleRules(text: string): string {
  // A selector list may wrap after its commas ("h1, h2,\nol, li {").
  const rule = /(^|[{}])[ \t]*(?:[^{}\n;]*,[ \t]*\n)*[^{}\n;]*\{\s*(?:[\w-]+\s*:[^{};]*;?\s*)*\}/gm;
  let previous;
  do {
    previous = text;
    text = text.replace(rule, '$1');
  } while (text !== previous);
  return text.replace(/^\s*\}+\s*$/gm, '');
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** "Sparkling Sparkling" (image alt text next to a label) becomes "Sparkling". */
function dedupeRepeatedLabel(line: string): string {
  const words = line.split(' ');
  if (words.length % 2 === 0 && words.length > 0) {
    const half = words.length / 2;
    // Compare without accents or case ("Rose Rosé"), and keep the second, styled label.
    if (fold(words.slice(0, half).join(' ')) === fold(words.slice(half).join(' '))) return words.slice(half).join(' ');
  }
  return line;
}

/** Converts "Label ( https://… )", "Label <https://…>", "Label [https://…]", and bare URLs into link segments. */
function linkSegments(text: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const linkPattern = new RegExp(`${linkMark.start}([^${linkMark.start}${linkMark.split}${linkMark.end}]*)${linkMark.split}(https?:\\/\\/[^\\s${linkMark.end}]+)${linkMark.end}|${/([^\n()[\]<>]*?)\s*[([<]\s*(https?:\/\/[^\s)\]>]+)\s*[)\]>]|(https?:\/\/[^\s)\]>]+)/.source}`, 'g');
  let last = 0;
  for (const match of text.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    const [whole, markedLabel, markedURL, label, wrappedURL, bareURL] = match;
    if (index > last) segments.push({ text: withoutMarks(text.slice(last, index)) });
    if (markedURL) {
      // A link converted from HTML: its exact words, not the whole line before it.
      const words = markedLabel.replace(/\s+/g, ' ').trim();
      segments.push(words ? { text: words, url: markedURL } : { text: linkLabel(markedURL), url: markedURL });
      last = index + whole.length;
      continue;
    }
    const rawURL = wrappedURL ?? bareURL;
    const url = rawURL.replace(/[.,;:!?]+$/, '');
    const trimmedLabel = dedupeRepeatedLabel((label ?? '').trim());
    if (wrappedURL && trimmedLabel) {
      const leading = label!.slice(0, label!.length - label!.trimStart().length);
      if (leading) segments.push({ text: leading });
      segments.push({ text: trimmedLabel, url });
    } else {
      if (label) segments.push({ text: label });
      segments.push({ text: linkLabel(url), url });
    }
    // Trailing sentence punctuation after a bare URL stays in the text.
    last = index + whole.length - (bareURL ? rawURL.length - url.length : 0);
  }
  if (last < text.length) segments.push({ text: withoutMarks(text.slice(last)) });
  return mergeText(segments);
}

/** Link marks left unpaired (say, by cutting quoted history mid-link) are never shown. */
function withoutMarks(text: string): string {
  return text.replace(/[\uE000-\uE002]/g, '');
}

function linkLabel(url: string): string {
  try {
    return `${new URL(url).hostname.replace(/^www\./, '')} ↗`;
  } catch {
    return 'link ↗';
  }
}

function mergeText(segments: BodySegment[]): BodySegment[] {
  const merged: BodySegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && !previous.url && !segment.url) previous.text += segment.text;
    else if (segment.text) merged.push({ ...segment });
  }
  return merged;
}

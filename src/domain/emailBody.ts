/**
 * Turns the plain-text version of an email (often machine-converted from HTML)
 * into something that reads like a message: links become tappable words
 * instead of long tracking URLs, quoted reply history is dropped, invisible
 * characters and layout spacing are cleaned up.
 */

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
  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(invisible, '')
    .replace(/ /g, ' ')
    .replace(/\t+/g, ' ');

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
  const linkPattern = /([^\n()[\]<>]*?)\s*[([<]\s*(https?:\/\/[^\s)\]>]+)\s*[)\]>]|(https?:\/\/[^\s)\]>]+)/g;
  let last = 0;
  for (const match of text.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    const [whole, label, wrappedURL, bareURL] = match;
    if (index > last) segments.push({ text: text.slice(last, index) });
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
  if (last < text.length) segments.push({ text: text.slice(last) });
  return mergeText(segments);
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

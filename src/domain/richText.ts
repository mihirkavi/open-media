import type { IdentityRef } from './people';
import { NetworkId, networks } from './networkPosts';

/**
 * Splits post text into plain runs, links, @mentions and #hashtags, the way social apps highlight
 * them. Pure and conservative: only http(s) and www. addresses become links (so "e.g." or "v1.2"
 * never do), an @ inside a word (an email address) is not a mention, and a hashtag must start with
 * a letter (so "#1" stays text).
 */
export type RichToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string; display: string }
  | { kind: 'mention'; text: string; handle: string }
  | { kind: 'hashtag'; text: string; tag: string };

const linkPattern = /(?:https?:\/\/|www\.)[^\s<>"]+/giu;
const mentionPattern = /@[\p{L}\p{N}_](?:[\p{L}\p{N}_.\-/]*[\p{L}\p{N}_])?/gu;
const hashtagPattern = /#\p{L}[\p{L}\p{N}_]*/gu;
/** Characters that end a sentence rather than an address, e.g. the period in "see example.com/a." */
const trailing = /^[.,!?;:'"’”)\]}>…]$/u;

export function tokenizeRichText(text: string): RichToken[] {
  const found: { start: number; end: number; token: RichToken }[] = [];
  for (const match of text.matchAll(linkPattern)) {
    const raw = trimLink(match[0]);
    const url = raw.toLowerCase().startsWith('www.') ? `https://${raw}` : raw;
    if (!isHttpUrl(url)) continue;
    found.push({ start: match.index, end: match.index + raw.length, token: { kind: 'link', text: raw, url, display: displayUrl(url) } });
  }
  const free = (start: number, end: number) => found.every((item) => end <= item.start || start >= item.end);
  for (const match of text.matchAll(mentionPattern)) {
    const before = text[match.index - 1];
    if (before && /[\p{L}\p{N}_.@]/u.test(before)) continue;
    if (!free(match.index, match.index + match[0].length)) continue;
    found.push({ start: match.index, end: match.index + match[0].length, token: { kind: 'mention', text: match[0], handle: match[0].slice(1) } });
  }
  for (const match of text.matchAll(hashtagPattern)) {
    const before = text[match.index - 1];
    if (before && /[\p{L}\p{N}_&#]/u.test(before)) continue;
    if (!free(match.index, match.index + match[0].length)) continue;
    found.push({ start: match.index, end: match.index + match[0].length, token: { kind: 'hashtag', text: match[0], tag: match[0].slice(1) } });
  }
  found.sort((a, b) => a.start - b.start);
  const tokens: RichToken[] = [];
  let at = 0;
  for (const item of found) {
    if (item.start > at) tokens.push({ kind: 'text', text: text.slice(at, item.start) });
    tokens.push(item.token);
    at = item.end;
  }
  if (at < text.length || !tokens.length) tokens.push({ kind: 'text', text: text.slice(at) });
  return tokens;
}

/** Drops sentence punctuation after an address, keeping a closing bracket whose opener is inside it. */
function trimLink(raw: string): string {
  let value = raw;
  for (let last = value.at(-1); last && trailing.test(last); last = value.at(-1)) {
    if ((last === ')' && count(value, '(') >= count(value, ')')) || (last === ']' && count(value, '[') >= count(value, ']'))) break;
    value = value.slice(0, -1);
  }
  return value;
}

const count = (value: string, character: string) => value.split(character).length - 1;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** "https://www.example.com/a/very/long/path?x=1" → "example.com/a/very/long/pa…". */
export function displayUrl(value: string, max = 32): string {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  const host = url.hostname.replace(/^www\./, '');
  const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
  const shown = `${host}${rest}`;
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}

/**
 * Who an @mention points to. Mentions mean a handle on the network the post came from; Lens writes
 * them as "@lens/name". A mention in an Open Media post is an Open Media handle.
 */
export function mentionRef(handle: string, source: string): IdentityRef | undefined {
  const clean = handle.replace(/^lens\//i, '');
  if (!clean) return undefined;
  if (source === 'open-media') return { kind: 'open_media', handle: clean.toLowerCase() };
  if (source in networks) return { kind: 'network', network: source as NetworkId, handle: clean };
  return undefined;
}

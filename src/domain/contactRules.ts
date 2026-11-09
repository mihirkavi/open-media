/**
 * Cleanup rules for imported contacts (ADR 0035). They make an import from Apple Contacts, iCloud,
 * Google or a spreadsheet arrive tidy: real names in name fields, phone numbers that are numbers,
 * real email addresses, LinkedIn as a profile, and nothing invented. Each rule only fixes what is
 * certainly wrong; anything uncertain is kept as it was.
 */

// ---------------------------------------------------------------- text

/** Mac Roman's upper half, for undoing UTF-8 text that was read as Mac Roman (once or twice). */
const macRoman = '\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7';
const macRomanByte = new Map([...macRoman].map((character, index) => [character, 0x80 + index]));
const mojibakeMark = /[\uf8ff√¬Ô‚Ã∏Äπ≈ç∆˚≤≥ÀÕœ“”÷◊ÿŸ⁄€‹›ﬁﬂ‡·„‰ÂÊÁËÈÍÎÏÌÓÒÚÛÙıˆ˜¯˘˙¸˝˛ˇ]/;

/** "Jos‚àö¬©" → "José". Text that isn't double-encoded comes back unchanged. */
export function repairEncoding(value: string): string {
  let text = value;
  for (let round = 0; round < 4 && mojibakeMark.test(text); round += 1) {
    const bytes: number[] = [];
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 0x80) bytes.push(code);
      else if (macRomanByte.has(character)) bytes.push(macRomanByte.get(character)!);
      else return text;
    }
    let decoded: string;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch { return text; }
    if (decoded === text) return text;
    text = decoded;
  }
  return text;
}

/** Apple's exports sometimes glue the next property onto a value. */
const glued = /X-SHARED-PHOTO-DISPLAY-PREF(?::|%3A)[A-Z_]+/gi;
const hidden = /[​-‏‪-‮⁠-⁤﻿­]/g;

/** Removes glued export text, invisible formatting characters and repeated spaces; repairs encoding. */
export function tidyText(value: string): string {
  return repairEncoding(value.replace(glued, '')).replace(hidden, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Emoji, flags, ®, ™ and box-drawing separators have no place in a name. Fancy math letters become plain. */
function withoutSymbols(value: string): string {
  const plain = /[\u{1D400}-\u{1D7FF}]/u.test(value) ? value.normalize('NFKC') : value;
  return plain.replace(/[─-╿]/g, ' ').replace(/[\p{Extended_Pictographic}\p{So}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, '');
}

// ---------------------------------------------------------------- names

const pronouns = /\(?\b(?:she|he|they|hers|her|him|them|his|theirs)\b(?:\s*\/\s*(?:she|he|they|hers|her|him|them|his|theirs)\b)+\)?/gi;
/** Credentials that can follow a name. Kept to well-known ones so real surnames are never removed. */
const credentials = new Set(['mba', 'pmp', 'phd', 'ph.d.', 'ph.d', 'cfa', 'cpa', 'cga', 'acca', 'aca', 'shrm-cp', 'shrm-scp', 'phr', 'sphr', 'csm', 'cspo', 'capm', 'cfp', 'cft-i', 'm.s.', 'ms.c', 'msc', 'ed.d.', 'cprw', 'frm', 'scr', 'cscp', 'cddp', 'mbb', 'isi', 'mred', 'msei', 'cphr', 'cissp', 'pmi-acp', 'p.eng', 'pe']);
const isCredential = (token: string) => credentials.has(token.toLowerCase().replace(/^\(|\)$/g, '').replace(/[,;]$/, ''));
/** Import markers some systems add to names: Apple's (C), (IC), (V) for contractors, "(Sample)". */
const markers = /\((?:C|IC|V|Sample)\)/gi;
const emailInText = /<?([A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/g;
/** Real name suffixes stay. */
const suffixes = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

export interface CleanName {
  name: string;
  /** Email addresses that were in the name. */
  emails: string[];
}

/**
 * A person's name as it should be saved: no emails, pronouns, credentials, emoji or import
 * markers; no repeated parts ("Erica Ablan-Go Ablan-Go"); "Alekhya(Allu)" spaced as "Alekhya (Allu)";
 * ALL CAPS and all lower case fixed, while initials, accents, particles and McGill-style capitals stay.
 */
export function cleanPersonName(value: string): CleanName {
  const emails: string[] = [];
  let name = withoutSymbols(tidyText(value)).replace(emailInText, (_match, address: string) => { emails.push(address); return ' '; });
  name = name.replace(markers, ' ').replace(pronouns, ' ');
  // Leftover pieces of broken encoding that could not be repaired ("De Paula ‚À¥") are not part of a name.
  name = name.split(/\s+/).filter((token) => !(mojibakeMark.test(token) && !/[A-Za-z]/.test(token))).join(' ');
  // Credentials: after a comma ("Kumar, MBA, PMP") or trailing tokens ("Kalra CFA", "Schulwitz MBA/MRED").
  const [head, ...rest] = name.split(',');
  if (rest.length && rest.join(',').split(/[,\s/]+/).filter(Boolean).every((token) => isCredential(token) || suffixes.has(token.toLowerCase()))) {
    const kept = rest.join(',').split(/[,\s]+/).filter((token) => suffixes.has(token.toLowerCase()));
    name = [head, ...kept].join(' ');
  }
  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && tokens[tokens.length - 1].split('/').every(isCredential)) tokens.pop();
  // Repeated parts: "Erica Ablan-Go Ablan-Go", "Kshitij Akash Akash Kadam", "Police Police".
  for (let size = Math.floor(tokens.length / 2); size >= 1; size -= 1) {
    for (let start = 0; start + 2 * size <= tokens.length; start += 1) {
      const a = tokens.slice(start, start + size).join(' ').toLowerCase();
      const b = tokens.slice(start + size, start + 2 * size).join(' ').toLowerCase();
      if (a === b) { tokens.splice(start + size, size); start -= 1; }
    }
  }
  name = tokens.join(' ')
    .replace(/(\S)\(/g, '$1 (').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',').replace(/^[\s,;-]+|[\s,;-]+$/g, '');
  if ((name.match(/\(/g) ?? []).length !== (name.match(/\)/g) ?? []).length) name = name.replace(/\s*\([^)]*$/, '');
  return { name: fixCase(name.replace(/\s+/g, ' ').trim()), emails };
}

/** ALL CAPS or all lower case → Title Case, keeping initials and Mc/O'/D' capitals; mixed case is left alone. */
export function fixCase(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (!letters) return name;
  const upper = letters === letters.toUpperCase() && letters.length > 3 && name.split(/\s+/).some((token) => token.replace(/[^\p{L}]/gu, '').length > 2);
  const lower = letters === letters.toLowerCase() && letters !== letters.toUpperCase();
  const particles = new Set(['de', 'da', 'del', 'della', 'di', 'do', 'dos', 'das', 'du', 'van', 'von', 'der', 'den', 'la', 'le', 'bin', 'al', 'el']);
  const fixed = (upper || lower) ? name.split(' ').map((token, index) => {
    const core = token.replace(/[^\p{L}]/gu, '');
    if (upper && core.length <= 2) return token;
    if (lower && index > 0 && particles.has(token)) return token;
    return token.split('-').map((part) => {
      const low = part.toLowerCase();
      if (/^mc\p{L}/u.test(low)) return `Mc${low[2].toUpperCase()}${low.slice(3)}`;
      if (/^[od]'\p{L}/u.test(low)) return `${low[0].toUpperCase()}'${low[2].toUpperCase()}${low.slice(3)}`;
      return low.replace(/^(\P{L}*)(\p{L})/u, (_m, lead: string, first: string) => lead + first.toUpperCase());
    }).join('-');
  }).join(' ') : name;
  // "OrdoñEz" (a capital after an accented letter, from a naive title-caser) → "Ordoñez"; "30Th" → "30th".
  return fixed.replace(/([à-ÿ])([A-Z])(?=[a-z])/g, (_m, accent: string, capital: string) => accent + capital.toLowerCase()).replace(/(\d)(St|Nd|Rd|Th)\b/g, (_m, digit: string, ordinal: string) => digit + ordinal.toLowerCase());
}

// ---------------------------------------------------------------- phones

/** Words that some exports put in a phone field instead of a number. */
const phonePlaceholders = /^(mobile|other|home|work|phone|primary phone|home phone( 2)?|mobile phone|pager|home fax|business phone( 2)?|assistant's phone|other phone|car phone|radio phone|tty\/tdd phone|whatsapp|old number)$/i;

/**
 * The phone numbers in one phone field: placeholders, glued metadata ("ROLE:…", "(smsft)") and
 * invisible characters removed, " ::: "-joined values split, and an impossible leading "+0"
 * dropped. Short codes (100, 55121) and USSD codes (*123#) stay. A number without a country code
 * stays without one: none is guessed.
 */
export function cleanPhones(value: string): string[] {
  const text = tidyText(value).replace(/^tel:/i, '').replace(/ROLE:.*$/i, '').replace(/\((?![\d\s])[^)]*\)/g, '');
  return text.split(/\s*:::\s*/).flatMap((part) => {
    const item = part.trim();
    if (!item || phonePlaceholders.test(item) || !/\d/.test(item)) return [];
    if (/^[*#][\d*#]*#$/.test(item.replace(/\s/g, ''))) return [item.replace(/\s/g, '')];
    const digits = item.replace(/\D/g, '');
    if (/^0+$/.test(digits) || (digits.length <= 2)) return [];
    // Two international numbers run together: +919910090482919910904553.
    if (item.startsWith('+') && digits.length === 24 && digits.startsWith('91') && digits.slice(12).startsWith('91')) return [`+${digits.slice(0, 12)}`, `+${digits.slice(12)}`];
    if (item.startsWith('+0')) return [digits];
    return [item];
  });
}

// ---------------------------------------------------------------- emails

const emailPlaceholders = /^(email address|email type|home|other|work|email)$/i;

/** A real email address from an email field, or '' for a placeholder. Domains are never "corrected". */
export function cleanEmail(value: string): string {
  const text = tidyText(value).replace(/^mailto:/i, '').replace(/^<|>$/g, '');
  if (emailPlaceholders.test(text) || !text.includes('@')) return '';
  // Text glued after the domain by an export: "name@gmail.comStatus_S2C".
  return text.replace(/(\.[a-z]{2,6})[A-Z][\w]*$/, '$1');
}

/** Shared mailboxes (info@, careers@…) say nothing about which person a contact is. */
export function isSharedMailbox(address: string): boolean {
  return /^(info|careers?|jobs|support|sales|contact|admissions?|help|hello|team|office|hr|recruiting|noreply|no-reply|donotreply|notifications?)@/i.test(address.trim());
}

// ---------------------------------------------------------------- LinkedIn and other profiles

/**
 * The LinkedIn username in a profile link, also from broken links some exports produce
 * ("https::https::http://www.linkedin.com/in/…", a link nested inside another). '' when none.
 */
export function linkedInSlug(value: string): string {
  let text = value;
  try { text = decodeURIComponent(value); } catch { /* keep as is */ }
  const matches = [...text.matchAll(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/gi)];
  const slug = matches.at(-1)?.[1]?.replace(/\/$/, '') ?? '';
  return slug && !/^https?:?$/i.test(slug) ? slug : '';
}

// ---------------------------------------------------------------- notes

export interface NoteFacts {
  phones: string[];
  emails: string[];
  linkedIn: string[];
  whatsapp: string[];
  company: boolean;
}

/**
 * Contact details hidden in an exported note ("Phone (Mobile): …", "LinkedIn: …", "Email: …",
 * "Contact type: Company"). Only these are kept; the note's text itself is not imported, because
 * exports fill notes with technical metadata (ADR 0035).
 */
export function factsInNote(note: string): NoteFacts {
  const keys = /(Significant [Dd]ate|Phone \(|Email \(|Email Address:|EmailAddress\s*:|Website \(|LinkedIn:|Address \(|WhatsApp:|GitHub:|Context:|Contact type:|Contact category:|Timestamp:)/g;
  const text = tidyText(note.replace(keys, '\n$1')).replace(/ (?=(Significant|Phone \(|Email|Website|LinkedIn:|WhatsApp:|Contact))/g, '\n');
  const phone = String.raw`(\+?\d[\d \-().]{5,}\d)`;
  return {
    phones: [...text.matchAll(new RegExp(String.raw`Phone \([^)]*\):\s*${phone}`, 'g'))].map((match) => match[1]),
    whatsapp: [...text.matchAll(new RegExp(String.raw`WhatsApp:\s*${phone}`, 'g'))].map((match) => match[1]),
    emails: [...text.matchAll(/(?:Email(?: \([^)]*\)| Address)?|EmailAddress)\s*:\s*([\w.+%'-]+@[\w-]+(?:\.[\w-]+)+)/g)].map((match) => cleanEmail(match[1])).filter(Boolean),
    linkedIn: [...text.matchAll(/https?:\S*linkedin\.com\/(?:in|pub)\/[^\s|;]+/gi)].map((match) => linkedInSlug(match[0])).filter(Boolean),
    company: /Contact type:\s*Company|Contact category:\s*Organi[sz]ation/i.test(text),
  };
}

/**
 * Could two names be the same person? Unnamed entries can be; otherwise one name's words must
 * include the other's ("Sam" and "Sam Example"), or the first names agree (or one shortens the
 * other: "Alex" and "Alexandra") with no clash in the last name. "Brian Ng" and "Chen Liu", who
 * share an office switchboard, cannot.
 */
export function namesCompatible(left: string, right: string): boolean {
  const words = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const a = words(left); const b = words(right);
  if (!a.length || !b.length) return true;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  if (small.every((word) => large.includes(word))) return true;
  const close = (x: string, y: string) => x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)));
  if (!close(a[0], b[0])) return false;
  return a.length === 1 || b.length === 1 || close(a[a.length - 1], b[b.length - 1]) || a[a.length - 1][0] === b[b.length - 1][0] && (a[a.length - 1].length === 1 || b[b.length - 1].length === 1);
}

/**
 * A number as people read it, for display only (the saved value never changes): +1 (555) 010-0021
 * for the US and Canada, +91 98765 43210 for India, +44 7700 900123 for the UK; anything else is
 * shown as saved.
 */
export function displayPhone(value: string): string {
  const text = value.trim();
  const digits = text.replace(/\D/g, '');
  if (!text.startsWith('+') || /[^\d\s+().-]/.test(text)) return text;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 12 && digits.startsWith('44')) return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  return text;
}

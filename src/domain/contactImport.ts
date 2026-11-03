import { normalizeEmail, normalizePhone } from './contactCleaning';
import { ContactCard, ContactHandle, HandleNetwork, normalizeHandle, samePhone } from './people';

/**
 * Importing contacts (ADR 0023): vCard files (Apple Contacts, Google Contacts, Outlook, Android),
 * CSV exports (Google, Outlook, or any sheet with name, email and phone columns), and contacts
 * picked from the device. Everything becomes the same shape, is shown for review, and is then
 * merged into the person's encrypted contacts without making duplicates.
 */

export interface ImportedContact {
  name: string;
  nicknames: string[];
  emails: string[];
  phones: string[];
  handles: ContactHandle[];
  notes: string;
}

export type ImportFormat = 'vcard' | 'csv';

export function detectFormat(fileName: string, text: string): ImportFormat | undefined {
  if (/BEGIN:VCARD/i.test(text.slice(0, 2000)) || /\.(vcf|vcard)$/i.test(fileName)) return 'vcard';
  if (/\.csv$/i.test(fileName) || /^[^\n]*,[^\n]*\n/.test(text)) return 'csv';
  return undefined;
}

/** Reads a contacts file. Throws a message the person can act on when it isn't one. */
export function parseContactsFile(fileName: string, text: string): ImportedContact[] {
  const clean = text.replace(/^﻿/, '');
  const format = detectFormat(fileName, clean);
  if (!format) throw new Error('That file doesn’t look like contacts. Choose a .vcf (vCard) or .csv file.');
  const contacts = (format === 'vcard' ? parseVCards(clean) : parseContactsCsv(clean)).map(tidy).filter(hasSomething);
  if (!contacts.length) throw new Error(format === 'vcard' ? 'No contacts in that vCard file.' : 'No contacts in that file. It needs a name, email or phone column.');
  return contacts;
}

// vCard 2.1, 3.0 and 4.0 (RFC 6350): the properties people actually fill in.

const socialServices: Record<string, HandleNetwork> = {
  whatsapp: 'whatsapp', telegram: 'telegram', signal: 'signal', twitter: 'twitter', x: 'twitter', bluesky: 'bluesky', instagram: 'instagram',
  facebook: 'messenger', messenger: 'messenger', linkedin: 'linkedin', slack: 'slack', discord: 'discord', farcaster: 'farcaster', lens: 'lens', hive: 'hive', deso: 'deso',
};

export function parseVCards(text: string): ImportedContact[] {
  // Unfold continuation lines (a line starting with a space or tab continues the previous one).
  const unfolded = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  // Quoted-printable values (vCard 2.1) continue on the next line after a trailing "=".
  const lines: string[] = [];
  for (const line of unfolded) {
    const previous = lines[lines.length - 1];
    if (previous !== undefined && /quoted-printable/i.test(previous.slice(0, indexOfUnquoted(previous, ':'))) && previous.endsWith('=')) lines[lines.length - 1] = previous.slice(0, -1) + line;
    else lines.push(line);
  }
  const contacts: ImportedContact[] = [];
  let current: (ImportedContact & { structured?: string; org?: string }) | undefined;
  for (const line of lines) {
    const colon = indexOfUnquoted(line, ':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const rawValue = line.slice(colon + 1);
    const [nameWithGroup, ...params] = head.split(';');
    const property = nameWithGroup.replace(/^[^.]+\./, '').toUpperCase();
    const paramText = params.join(';').toLowerCase();
    if (property === 'BEGIN' && rawValue.trim().toUpperCase() === 'VCARD') { current = { name: '', nicknames: [], emails: [], phones: [], handles: [], notes: '' }; continue; }
    if (!current) continue;
    const value = decodeValue(rawValue, paramText);
    switch (property) {
      case 'END':
        if (!current.name) current.name = structuredName(current.structured) || current.org || '';
        contacts.push(current);
        current = undefined;
        break;
      case 'FN': current.name = value.trim(); break;
      case 'N': current.structured = rawValue; break;
      case 'ORG': current.org = value.split(';')[0].trim(); break;
      case 'NICKNAME': current.nicknames.push(...value.split(',').map((item) => item.trim()).filter(Boolean)); break;
      case 'EMAIL': current.emails.push(value.trim()); break;
      case 'TEL': current.phones.push(value.replace(/^tel:/i, '').split(';')[0].trim()); break;
      case 'NOTE': current.notes = [current.notes, value.trim()].filter(Boolean).join('\n'); break;
      case 'IMPP':
      case 'X-SOCIALPROFILE': {
        const service = (paramText.match(/(?:x-service-type|type)=([^;:,]+)/)?.[1] ?? value.match(/^([a-z-]+):/i)?.[1] ?? '').toLowerCase().replace(/^x-/, '');
        const network = socialServices[service];
        const handle = handleFromValue(value);
        if (network && handle) current.handles.push({ network, handle });
        break;
      }
      case 'X-WHATSAPP': current.handles.push({ network: 'whatsapp', handle: value.trim() }); break;
      case 'X-TELEGRAM': current.handles.push({ network: 'telegram', handle: value.trim() }); break;
      default: break;
    }
  }
  return contacts;
}

function indexOfUnquoted(line: string, character: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === character && !quoted) return index;
  }
  return -1;
}

function decodeValue(value: string, params: string): string {
  let decoded = value;
  if (/encoding=quoted-printable|quoted-printable/.test(params)) {
    const bytes = decoded.replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    try { decoded = decodeURIComponent(escape(bytes)); } catch { decoded = bytes; }
  }
  return decoded.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function structuredName(value?: string): string {
  if (!value) return '';
  const [family, given, middle, prefix, suffix] = value.split(';').map((part) => part.replace(/\\([,;\\])/g, '$1').trim());
  return [prefix, given, middle, family, suffix].filter(Boolean).join(' ');
}

/** "x-apple:priya", "https://x.com/priya", "https://t.me/priya" or "@priya" → "priya". */
function handleFromValue(value: string): string {
  const trimmed = value.trim();
  const url = trimmed.match(/^https?:\/\/[^/]+\/(?:in\/|@)?([^/?#]+)/i);
  if (url) return decodeURIComponent(url[1]);
  return trimmed.replace(/^[a-z-]+:(\/\/)?/i, '').replace(/^@/, '').trim();
}

// CSV (RFC 4180), with Google's and Outlook's column names and anything that looks like them.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

type Column = 'name' | 'first' | 'middle' | 'last' | 'nickname' | 'email' | 'phone' | 'notes' | 'org' | { network: HandleNetwork };

function columnFor(header: string): Column | undefined {
  const key = header.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/(type|label)$/.test(key)) return undefined;
  if (/^(first name|given name)$/.test(key)) return 'first';
  if (/^(middle name|additional name)$/.test(key)) return 'middle';
  if (/^(last name|family name|surname)$/.test(key)) return 'last';
  if (/^(name|full name|display name|contact name|file as)$/.test(key)) return 'name';
  if (/^nick ?name/.test(key)) return 'nickname';
  if (/e-?mail/.test(key)) return 'email';
  if (/phone|mobile|^tel(ephone)?\b|cell|whatsapp number/.test(key) && !/fax/.test(key)) return /whatsapp/.test(key) ? { network: 'whatsapp' } : 'phone';
  if (/^(notes?|comments?)$/.test(key)) return 'notes';
  if (/^(organi[sz]ation( 1)?( - name)?|organi[sz]ation name|company)$/.test(key)) return 'org';
  for (const [service, network] of Object.entries(socialServices)) if (key === service || key.startsWith(`${service} `) || key.endsWith(` ${service}`)) return { network };
  return undefined;
}

export function parseContactsCsv(text: string): ImportedContact[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const columns = header.map(columnFor);
  if (!columns.some(Boolean)) throw new Error('That CSV has no name, email or phone columns.');
  return rows.map((cells) => {
    const contact: ImportedContact = { name: '', nicknames: [], emails: [], phones: [], handles: [], notes: '' };
    const parts: Record<string, string> = {};
    let org = '';
    cells.forEach((cell, index) => {
      const column = columns[index];
      // Google puts several values in one cell, separated by " ::: ".
      const values = cell.split(' ::: ').map((value) => value.trim()).filter(Boolean);
      if (!column || !values.length) return;
      if (typeof column === 'object') { for (const handle of values) contact.handles.push({ network: column.network, handle: handleFromValue(handle) }); return; }
      if (column === 'email') contact.emails.push(...values);
      else if (column === 'phone') contact.phones.push(...values);
      else if (column === 'nickname') contact.nicknames.push(...values);
      else if (column === 'notes') contact.notes = [contact.notes, values.join('\n')].filter(Boolean).join('\n');
      else if (column === 'org') org ||= values[0];
      else parts[column] ||= values.join(' ');
    });
    contact.name = parts.name || [parts.first, parts.middle, parts.last].filter(Boolean).join(' ') || org;
    return contact;
  });
}

function tidy(contact: ImportedContact): ImportedContact {
  const unique = (values: string[], key: (value: string) => string) => { const seen = new Set<string>(); return values.filter((value) => { const id = key(value); if (!id || seen.has(id)) return false; seen.add(id); return true; }); };
  return {
    name: contact.name.replace(/\s+/g, ' ').trim(),
    nicknames: unique(contact.nicknames.map((value) => value.trim()), (value) => value.toLowerCase()),
    emails: unique(contact.emails.map(normalizeEmail).filter((value) => /^[^\s@]+@[^\s@]+$/.test(value)), (value) => value),
    phones: unique(contact.phones.map((value) => value.trim()).filter((value) => value.replace(/\D/g, '').length >= 5), (value) => normalizePhone(value).replace(/\D/g, '').slice(-10)),
    handles: contact.handles.filter((item) => item.handle.trim()).filter((item, index, all) => all.findIndex((other) => other.network === item.network && normalizeHandle(other.network, other.handle) === normalizeHandle(item.network, item.handle)) === index),
    notes: contact.notes.trim(),
  };
}

function hasSomething(contact: ImportedContact): boolean {
  return Boolean(contact.name || contact.emails.length || contact.phones.length || contact.handles.length);
}

// Merging an import into the saved contacts.

export interface ImportPlan {
  /** The cards to save: new ones and existing ones that gained something. */
  changed: ContactCard[];
  added: number;
  updated: number;
  /** Already saved with nothing new. */
  unchanged: number;
}

/**
 * Matches each imported contact to a saved card that shares an email address or phone number
 * (exactly one; when two cards share it, the import adds a new card rather than guess), adds what
 * is new to it and keeps everything already there. Contacts that match nothing become new cards.
 * Contacts in the file that share an identifier with each other are merged first.
 */
export function planImport(cards: ContactCard[], imported: ImportedContact[], newId: () => string, now = new Date().toISOString()): ImportPlan {
  const working = cards.map((card) => ({ ...card }));
  const changed = new Map<string, ContactCard>();
  const fresh = new Set<string>();
  let unchanged = 0;
  for (const contact of imported) {
    const matches = working.filter((card) => contact.emails.some((email) => card.emails.some((saved) => normalizeEmail(saved) === email))
      || contact.phones.some((phone) => card.phones.some((saved) => samePhone(saved, phone))));
    if (matches.length === 1) {
      const card = matches[0];
      const next = addTo(card, contact, now);
      if (next === card) { if (!fresh.has(card.id) && !changed.has(card.id)) unchanged += 1; continue; }
      Object.assign(card, next);
      changed.set(card.id, card);
      continue;
    }
    const card: ContactCard = {
      id: newId(), source: 'manual', name: contact.name || contact.emails[0] || contact.phones[0] || 'Unnamed contact', nicknames: contact.nicknames, phones: contact.phones,
      emails: contact.emails, handles: contact.handles, notes: contact.notes, links: [], rejected: [], updatedAt: now,
    };
    working.push(card);
    fresh.add(card.id);
    changed.set(card.id, card);
  }
  const updated = [...changed.keys()].filter((id) => !fresh.has(id)).length;
  return { changed: [...changed.values()], added: fresh.size, updated, unchanged };
}

/** The card with whatever the import adds; the same object when it adds nothing. */
function addTo(card: ContactCard, contact: ImportedContact, now: string): ContactCard {
  const emails = contact.emails.filter((email) => !card.emails.some((saved) => normalizeEmail(saved) === email));
  const phones = contact.phones.filter((phone) => !card.phones.some((saved) => samePhone(saved, phone)));
  const handles = contact.handles.filter((item) => !(card.handles ?? []).some((saved) => saved.network === item.network && normalizeHandle(saved.network, saved.handle) === normalizeHandle(item.network, item.handle)));
  const nicknames = contact.nicknames.filter((nickname) => !card.nicknames.some((saved) => saved.toLowerCase() === nickname.toLowerCase()));
  const notes = contact.notes && !card.notes.includes(contact.notes) ? [card.notes, contact.notes].filter(Boolean).join('\n') : card.notes;
  const name = card.name && card.name !== 'Unnamed contact' ? card.name : contact.name || card.name;
  if (!emails.length && !phones.length && !handles.length && !nicknames.length && notes === card.notes && name === card.name) return card;
  return { ...card, name, emails: [...card.emails, ...emails], phones: [...card.phones, ...phones], handles: [...(card.handles ?? []), ...handles], nicknames: [...card.nicknames, ...nicknames], notes, updatedAt: now };
}

import { ContactCard, contactName, HandleNetwork } from './people';

/**
 * Exporting contacts (ADR 0036): every saved contact as one vCard 3.0 file that Apple Contacts,
 * iCloud, Google Contacts and Outlook import. Nothing leaves the device until the person saves or
 * shares the file. Re-importing it into Open Media changes nothing.
 */

/** Personal mail providers; their addresses are labelled Home, the rest Work (ADR 0035's policy). */
const personal = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|rediffmail|proton|protonmail|gmx|zoho)\.[a-z.]+$/i;

/** Apple's own service names for social profiles, so Contacts shows its built-in icons. */
const profileService: Partial<Record<HandleNetwork, string>> = {
  linkedin: 'linkedin', twitter: 'twitter', instagram: 'instagram', messenger: 'facebook', whatsapp: 'WhatsApp',
  telegram: 'Telegram', signal: 'Signal', bluesky: 'Bluesky', slack: 'Slack', discord: 'Discord',
  open_media: 'Open Media', farcaster: 'Farcaster', lens: 'Lens', hive: 'Hive', deso: 'DeSo', gmessages: 'Google Messages', gvoice: 'Google Voice',
};

const profileUrl: Partial<Record<HandleNetwork, (handle: string) => string>> = {
  linkedin: (handle) => `https://www.linkedin.com/in/${encodeURIComponent(handle)}`,
  twitter: (handle) => `https://x.com/${encodeURIComponent(handle)}`,
  instagram: (handle) => `https://www.instagram.com/${encodeURIComponent(handle)}`,
  bluesky: (handle) => `https://bsky.app/profile/${encodeURIComponent(handle)}`,
  telegram: (handle) => `https://t.me/${encodeURIComponent(handle)}`,
  open_media: (handle) => `https://openmedia.site/@${encodeURIComponent(handle)}`,
  farcaster: (handle) => `https://warpcast.com/${encodeURIComponent(handle)}`,
};

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** Lines longer than 75 bytes continue on the next line after a space (RFC 6350 §3.2), never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0; }
    current += character;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** "Erica Ablan-Go" → family "Ablan-Go", given "Erica"; one word is a given name. Companies have none. */
function structuredName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return `;${escape(words[0] ?? '')};;;`;
  return `${escape(words[words.length - 1])};${escape(words.slice(0, -1).join(' '))};;;`;
}

export function contactToVCard(card: ContactCard): string {
  const name = contactName(card);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Open Media//Contacts//EN'];
  if (card.company) {
    lines.push('N:;;;;', `FN:${escape(name || card.emails[0] || card.phones[0] || 'Contact')}`, `ORG:${escape(name)}`, 'X-ABShowAs:COMPANY');
  } else {
    lines.push(`N:${structuredName(name)}`, `FN:${escape(name || card.emails[0] || card.phones[0] || 'Contact')}`);
  }
  if (card.nicknames.length) lines.push(`NICKNAME:${card.nicknames.map(escape).join(',')}`);
  for (const phone of card.phones) lines.push(`TEL;type=VOICE:${phone}`);
  for (const email of card.emails) lines.push(`EMAIL;type=INTERNET;type=${personal.test(email) ? 'HOME' : 'WORK'}:${email}`);
  for (const item of card.handles ?? []) {
    const handle = item.handle.trim().replace(/^@/, '');
    if (!handle) continue;
    const service = profileService[item.network] ?? item.network;
    const url = profileUrl[item.network]?.(handle) ?? `x-apple:${handle.replace(/[\s;,]/g, (character) => encodeURIComponent(character))}`;
    lines.push(`X-SOCIALPROFILE;type=${service};x-user=${handle.replace(/[;:,"]/g, '')}:${url}`);
  }
  if (card.notes.trim()) lines.push(`NOTE:${escape(card.notes.trim())}`);
  lines.push(`UID:${card.id}`, 'END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** All contacts in one file, sorted by name, without your own card unless asked. */
export function contactsToVCard(cards: ContactCard[], { includeSelf = false } = {}): string {
  return cards
    .filter((card) => includeSelf || !card.self)
    .sort((a, b) => (contactName(a) || a.emails[0] || '').localeCompare(contactName(b) || b.emails[0] || '', undefined, { sensitivity: 'base' }))
    .map(contactToVCard)
    .join('');
}

/** "Open Media Contacts 2026-11-07.vcf" */
export function exportFileName(now = new Date()): string {
  return `Open Media Contacts ${now.toISOString().slice(0, 10)}.vcf`;
}

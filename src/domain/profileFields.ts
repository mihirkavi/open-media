/**
 * Profile fields (ADR 0019): everything a person may add about themselves beyond name, handle and
 * bio — pronouns, place, website, contact details and their accounts on other social networks —
 * each with its own visibility. The database returns another person only the fields they may see:
 *
 * - everyone: anyone who can see the profile;
 * - connections: people you follow and who follow you back, or who share a conversation with you;
 * - only_me: nobody but you.
 *
 * Contact details start as only_me. Accounts on Farcaster, Lens, Hive and DeSo stay in
 * `linked_accounts`, because they also build the person's timeline, and are always public.
 */

export type FieldVisibility = 'everyone' | 'connections' | 'only_me';
export const fieldVisibilities: FieldVisibility[] = ['everyone', 'connections', 'only_me'];
export const visibilityLabels: Record<FieldVisibility, string> = { everyone: 'Everyone', connections: 'Connections', only_me: 'Only me' };

export type FieldGroup = 'about' | 'contact' | 'social';
type FieldKind = 'text' | 'url' | 'email' | 'phone' | 'handle';

export interface ProfileFieldDefinition {
  id: string;
  label: string;
  group: FieldGroup;
  kind: FieldKind;
  placeholder: string;
  max: number;
  defaultVisibility: FieldVisibility;
  /** The public page for a handle on this network. */
  link?: (handle: string) => string;
}

const handle = (id: string, label: string, placeholder: string, link?: (value: string) => string): ProfileFieldDefinition =>
  ({ id, label, group: 'social', kind: 'handle', placeholder, max: 100, defaultVisibility: 'everyone', link });

export const profileFieldDefinitions: ProfileFieldDefinition[] = [
  { id: 'pronouns', label: 'Pronouns', group: 'about', kind: 'text', placeholder: 'she/her', max: 40, defaultVisibility: 'everyone' },
  { id: 'location', label: 'Location', group: 'about', kind: 'text', placeholder: 'City, country', max: 120, defaultVisibility: 'everyone' },
  { id: 'website', label: 'Website', group: 'about', kind: 'url', placeholder: 'https://…', max: 300, defaultVisibility: 'everyone' },
  { id: 'email', label: 'Email', group: 'contact', kind: 'email', placeholder: 'you@example.com', max: 254, defaultVisibility: 'only_me' },
  { id: 'phone', label: 'Phone', group: 'contact', kind: 'phone', placeholder: '+91 98765 43210', max: 32, defaultVisibility: 'only_me' },
  handle('linkedin', 'LinkedIn', 'linkedin.com/in/yourname or yourname', (value) => `https://www.linkedin.com/in/${value}`),
  handle('x', 'X (Twitter)', '@yourname', (value) => `https://x.com/${value}`),
  handle('instagram', 'Instagram', '@yourname', (value) => `https://www.instagram.com/${value}`),
  handle('facebook', 'Facebook', 'yourname', (value) => `https://www.facebook.com/${value}`),
  handle('threads', 'Threads', '@yourname', (value) => `https://www.threads.net/@${value}`),
  handle('bluesky', 'Bluesky', 'yourname.bsky.social', (value) => `https://bsky.app/profile/${value}`),
  handle('mastodon', 'Mastodon', '@you@mastodon.social', (value) => { const [user, host] = value.split('@'); return `https://${host}/@${user}`; }),
  handle('tiktok', 'TikTok', '@yourname', (value) => `https://www.tiktok.com/@${value}`),
  handle('youtube', 'YouTube', '@yourchannel', (value) => `https://www.youtube.com/@${value}`),
  handle('github', 'GitHub', 'yourname', (value) => `https://github.com/${value}`),
  handle('reddit', 'Reddit', 'u/yourname', (value) => `https://www.reddit.com/user/${value}`),
  handle('medium', 'Medium', '@yourname', (value) => `https://medium.com/@${value}`),
  handle('substack', 'Substack', 'yourname', (value) => `https://${value}.substack.com`),
  handle('dribbble', 'Dribbble', 'yourname', (value) => `https://dribbble.com/${value}`),
  handle('behance', 'Behance', 'yourname', (value) => `https://www.behance.net/${value}`),
  handle('twitch', 'Twitch', 'yourname', (value) => `https://www.twitch.tv/${value}`),
  handle('pinterest', 'Pinterest', 'yourname', (value) => `https://www.pinterest.com/${value}`),
  handle('snapchat', 'Snapchat', 'yourname', (value) => `https://www.snapchat.com/add/${value}`),
  handle('telegram', 'Telegram', '@yourname', (value) => `https://t.me/${value}`),
  handle('discord', 'Discord', 'yourname'),
];

const byId = new Map(profileFieldDefinitions.map((field) => [field.id, field]));
export const maxProfileFields = profileFieldDefinitions.length;

export interface ProfileFieldValue { field: string; value: string; visibility: FieldVisibility }

export class ProfileFieldError extends Error {}

/** Cleans one value for its field, or explains what is wrong. Handles are stored without @ or the site's address. */
export function cleanFieldValue(id: string, raw: string): string {
  const field = byId.get(id);
  if (!field) throw new ProfileFieldError(`Unknown profile field: ${id}.`);
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length > field.max) throw new ProfileFieldError(`${field.label} can be up to ${field.max} characters.`);
  if (field.kind === 'url') {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.') || parsed.username || parsed.password) throw new Error(); return parsed.toString(); }
    catch { throw new ProfileFieldError(`${field.label} must be a web address, like https://example.com.`); }
  }
  if (field.kind === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ProfileFieldError('Enter an email address like you@example.com.');
    return value.toLowerCase();
  }
  if (field.kind === 'phone') {
    if (!/^\+?[\d\s().-]{6,32}$/.test(value) || value.replace(/\D/g, '').length < 6) throw new ProfileFieldError('Enter a phone number, like +91 98765 43210.');
    return value;
  }
  if (field.kind === 'handle') {
    // People paste a profile link or a handle with @; keep only the handle.
    let handleValue = value.replace(/^https?:\/\/(www\.)?/i, '');
    if (id === 'mastodon') {
      const fromUrl = handleValue.match(/^([^/]+)\/@([^/?#]+)/);
      handleValue = fromUrl ? `${fromUrl[2]}@${fromUrl[1]}` : handleValue.replace(/^@/, '');
      if (!/^[A-Za-z0-9_.]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(handleValue)) throw new ProfileFieldError('Enter your Mastodon address, like @you@mastodon.social.');
      return handleValue;
    }
    handleValue = handleValue
      .replace(/^(linkedin\.com\/in|x\.com|twitter\.com|instagram\.com|facebook\.com|threads\.net|bsky\.app\/profile|tiktok\.com|youtube\.com|github\.com|reddit\.com\/(?:user|u)|medium\.com|dribbble\.com|behance\.net|twitch\.tv|pinterest\.com|snapchat\.com\/add|t\.me)\//i, '')
      .replace(/^([a-z0-9-]+)\.substack\.com.*$/i, '$1')
      .replace(/^u\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(handleValue)) throw new ProfileFieldError(`Enter your ${field.label} name, like ${field.placeholder}.`);
    return handleValue;
  }
  return value;
}

/** Checks a whole set of fields from the app or an agent; empty values are dropped. */
export function validateProfileFields(values: unknown): ProfileFieldValue[] {
  if (!Array.isArray(values)) throw new ProfileFieldError('Send fields as a list of {field, value, visibility}.');
  const seen = new Set<string>();
  const clean: ProfileFieldValue[] = [];
  for (const item of values) {
    const entry = item as Partial<ProfileFieldValue> | null;
    if (!entry || typeof entry.field !== 'string' || typeof entry.value !== 'string') throw new ProfileFieldError('Each field needs a field name and a value.');
    if (seen.has(entry.field)) throw new ProfileFieldError(`${entry.field} appears twice.`);
    seen.add(entry.field);
    const definition = byId.get(entry.field);
    if (!definition) throw new ProfileFieldError(`Unknown profile field: ${entry.field}.`);
    const visibility = entry.visibility ?? definition.defaultVisibility;
    if (!fieldVisibilities.includes(visibility)) throw new ProfileFieldError('Visibility must be everyone, connections or only_me.');
    const value = cleanFieldValue(entry.field, entry.value);
    if (value) clean.push({ field: entry.field, value, visibility });
  }
  return clean;
}

export function fieldDefinition(id: string): ProfileFieldDefinition | undefined {
  return byId.get(id);
}

/** Where a field opens, when it is a link: a website, a social profile, mailto: or tel:. */
export function fieldHref(id: string, value: string): string | undefined {
  const field = byId.get(id);
  if (!field || !value) return undefined;
  if (field.kind === 'url') return value.startsWith('https://') ? value : undefined;
  if (field.kind === 'email') return `mailto:${value}`;
  if (field.kind === 'phone') return `tel:${value.replace(/[^\d+]/g, '')}`;
  return field.link?.(value);
}

/** How a field reads on a profile: handles with @ where the network writes them that way. */
export function fieldDisplay(id: string, value: string): string {
  const field = byId.get(id);
  if (!field) return value;
  if (field.kind === 'url') return value.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');
  if (field.kind !== 'handle') return value;
  if (['x', 'instagram', 'threads', 'tiktok', 'youtube', 'medium', 'telegram'].includes(id)) return `@${value}`;
  if (id === 'mastodon') return `@${value}`;
  if (id === 'reddit') return `u/${value}`;
  return value;
}

/** Fields as the profile's owner edits them: every definition, with what is saved or its default visibility. */
export function editableFields(saved: ProfileFieldValue[]): ProfileFieldValue[] {
  const values = new Map(saved.map((item) => [item.field, item]));
  return profileFieldDefinitions.map((field) => values.get(field.id) ?? { field: field.id, value: '', visibility: field.defaultVisibility });
}

/** Reads fields another person may see, as the database returns them ({field, value}), in the editor's order. */
export function readVisibleFields(value: unknown): { field: string; value: string }[] {
  const order = (field: string) => profileFieldDefinitions.findIndex((item) => item.id === field);
  return (Array.isArray(value) ? value : [])
    .filter((item): item is { field: string; value: string } => Boolean(item) && typeof item.field === 'string' && typeof item.value === 'string' && byId.has(item.field))
    .sort((a, b) => order(a.field) - order(b.field));
}

/** The person's public address on the web app, e.g. https://openmedia.site/@asha. */
export function publicProfileUrl(handleValue: string, origin = 'https://openmedia.site'): string {
  return `${origin}/@${handleValue.replace(/^@/, '').toLowerCase()}`;
}

/** The handle in a profile address such as /@asha (or /@asha/), or undefined. */
export function profileHandleFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/@([a-z0-9_]{3,24})\/?$/i)?.[1]?.toLowerCase();
}

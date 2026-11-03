import { ImportedContact } from '../domain/contactImport';

/**
 * The Contact Picker API (https://w3c.github.io/contact-picker/): the browser shows the device's own
 * contact list and returns only the people the person picks. Chrome on Android supports it; Safari
 * on iOS has it behind a setting; desktop browsers, including on a Mac, don't, so there the person
 * imports a file or drags contacts out of the Contacts app.
 */
interface ContactsManager { select(properties: string[], options?: { multiple?: boolean }): Promise<{ name?: string[]; email?: string[]; tel?: string[] }[]> }

function manager(): ContactsManager | undefined {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || !('ContactsManager' in window)) return undefined;
  return (navigator as Navigator & { contacts?: ContactsManager }).contacts;
}

export function canPickContacts(): boolean {
  return Boolean(manager());
}

export async function pickContacts(): Promise<ImportedContact[]> {
  const contacts = manager();
  if (!contacts) throw new Error('This browser can’t open your contacts. Import a file instead.');
  const picked = await contacts.select(['name', 'email', 'tel'], { multiple: true });
  return picked.map((item) => ({ name: item.name?.[0] ?? '', nicknames: [], emails: item.email ?? [], phones: item.tel ?? [], handles: [], notes: '' }));
}

import { ImportedContact } from '../domain/contactImport';

/**
 * Picking contacts with the browser's Contact Picker (`contactPicker.web.ts`). On iOS and Android the
 * app reads the device's contacts directly (deviceContacts.ts), so there is no picker here.
 */
export function canPickContacts(): boolean {
  return false;
}

export async function pickContacts(): Promise<ImportedContact[]> {
  throw new Error('Use “From this phone” to import your contacts.');
}

export interface ContactValue {
  id: string;
  label?: string;
  value: string;
}

export interface DeviceContactSnapshot {
  id: string;
  fullName: string;
  givenName?: string;
  familyName?: string;
  phones: ContactValue[];
  emails: ContactValue[];
}

export interface ContactCleanupSuggestion {
  contactId: string;
  contactName: string;
  phones: ContactValue[];
  emails: ContactValue[];
  changes: string[];
}

export function suggestContactCleanup(contact: DeviceContactSnapshot): ContactCleanupSuggestion | null {
  const phones = uniqueByNormalized(contact.phones, normalizePhone);
  const emails = uniqueByNormalized(contact.emails, normalizeEmail);
  const changes: string[] = [];

  if (phones.some((value, index) => value.value !== contact.phones[index]?.value)) changes.push('Normalize phone formatting');
  if (phones.length < contact.phones.length) changes.push('Remove duplicate phone numbers');
  if (emails.some((value, index) => value.value !== contact.emails[index]?.value)) changes.push('Normalize email addresses');
  if (emails.length < contact.emails.length) changes.push('Remove duplicate email addresses');
  if (!changes.length) return null;

  return { contactId: contact.id, contactName: contact.fullName || 'Unnamed contact', phones, emails, changes };
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (hasLeadingPlus) return `+${digits}`;
  return digits;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function uniqueByNormalized(values: ContactValue[], normalize: (value: string) => string): ContactValue[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = normalize(value.value);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ ...value, value: normalized }];
  });
}

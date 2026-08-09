import * as Contacts from 'expo-contacts';

import { ContactCleanupSuggestion, DeviceContactSnapshot, suggestContactCleanup } from '../domain/contactCleaning';

const fields = [
  Contacts.ContactField.FULL_NAME,
  Contacts.ContactField.GIVEN_NAME,
  Contacts.ContactField.FAMILY_NAME,
  Contacts.ContactField.PHONES,
  Contacts.ContactField.EMAILS,
] as const;

export async function scanDeviceContacts(): Promise<ContactCleanupSuggestion[]> {
  const permission = await Contacts.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Contacts access was not granted.');

  const contacts = await Contacts.Contact.getAllDetails(fields);
  return contacts.map(toSnapshot).map(suggestContactCleanup).filter((item): item is ContactCleanupSuggestion => Boolean(item));
}

export async function applyContactCleanup(suggestion: ContactCleanupSuggestion): Promise<void> {
  const contact = new Contacts.Contact(suggestion.contactId);
  await contact.patch({
    phones: suggestion.phones.map(({ id, label, value }) => ({ id, label, number: value })),
    emails: suggestion.emails.map(({ id, label, value }) => ({ id, label, address: value })),
  });
}

function toSnapshot(contact: Awaited<ReturnType<typeof Contacts.Contact.getAllDetails>>[number]): DeviceContactSnapshot {
  return {
    id: contact.id,
    fullName: contact.fullName ?? [contact.givenName, contact.familyName].filter(Boolean).join(' '),
    givenName: contact.givenName ?? undefined,
    familyName: contact.familyName ?? undefined,
    phones: (contact.phones ?? []).flatMap((phone: Contacts.ExistingPhone) => phone.number ? [{ id: phone.id, label: phone.label, value: phone.number }] : []),
    emails: (contact.emails ?? []).flatMap((email: Contacts.ExistingEmail) => email.address ? [{ id: email.id, label: email.label, value: email.address }] : []),
  };
}

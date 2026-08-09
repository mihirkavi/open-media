import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEmail, normalizePhone, suggestContactCleanup } from './contactCleaning';

test('normalizes common US phone and email formats', () => {
  assert.equal(normalizePhone('(415) 555-0199'), '4155550199');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizeEmail('  PERSON@Example.COM '), 'person@example.com');
});

test('suggests deterministic cleanup without silently changing contacts', () => {
  const suggestion = suggestContactCleanup({
    id: 'contact-1', fullName: 'Maya Chen',
    phones: [
      { id: 'phone-1', label: 'mobile', value: '(415) 555-0199' },
      { id: 'phone-2', label: 'home', value: '415 555 0199' },
    ],
    emails: [{ id: 'email-1', value: ' MAYA@Example.com ' }],
  });

  assert.ok(suggestion);
  assert.deepEqual(suggestion.phones.map((phone) => phone.value), ['4155550199']);
  assert.deepEqual(suggestion.emails.map((email) => email.value), ['maya@example.com']);
  assert.ok(suggestion.changes.includes('Remove duplicate phone numbers'));
});

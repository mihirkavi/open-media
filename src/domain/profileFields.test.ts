import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanFieldValue, editableFields, fieldDisplay, fieldHref, ProfileFieldError, profileHandleFromPath, publicProfileUrl, readVisibleFields, validateProfileFields } from './profileFields';

test('pasted profile links and @handles are stored as plain handles', () => {
  assert.equal(cleanFieldValue('linkedin', 'https://www.linkedin.com/in/mihirkavishwar/'), 'mihirkavishwar');
  assert.equal(cleanFieldValue('x', '@mihir'), 'mihir');
  assert.equal(cleanFieldValue('x', 'https://twitter.com/mihir?s=21'), 'mihir');
  assert.equal(cleanFieldValue('instagram', 'instagram.com/mihir.k'), 'mihir.k');
  assert.equal(cleanFieldValue('reddit', 'u/mihir'), 'mihir');
  assert.equal(cleanFieldValue('substack', 'https://mihir.substack.com/p/hello'), 'mihir');
  assert.equal(cleanFieldValue('mastodon', 'https://mastodon.social/@mihir'), 'mihir@mastodon.social');
  assert.equal(cleanFieldValue('mastodon', '@mihir@mastodon.social'), 'mihir@mastodon.social');
  assert.throws(() => cleanFieldValue('mastodon', 'mihir'), ProfileFieldError);
  assert.throws(() => cleanFieldValue('x', 'not a handle!'), ProfileFieldError);
});

test('websites, emails and phones are checked', () => {
  assert.equal(cleanFieldValue('website', 'mihirkavishwar.com'), 'https://mihirkavishwar.com/');
  assert.throws(() => cleanFieldValue('website', 'http://example.com'), /web address/);
  assert.throws(() => cleanFieldValue('website', 'javascript:alert(1)'), /web address/);
  assert.equal(cleanFieldValue('email', 'Hello@Example.com'), 'hello@example.com');
  assert.throws(() => cleanFieldValue('email', 'nope'), /email/);
  assert.equal(cleanFieldValue('phone', '+91 98765 43210'), '+91 98765 43210');
  assert.throws(() => cleanFieldValue('phone', '12'), /phone/);
});

test('contact details start as only me, and empty fields are dropped', () => {
  const fields = editableFields([]);
  assert.equal(fields.find((item) => item.field === 'email')?.visibility, 'only_me');
  assert.equal(fields.find((item) => item.field === 'phone')?.visibility, 'only_me');
  assert.equal(fields.find((item) => item.field === 'linkedin')?.visibility, 'everyone');
  assert.deepEqual(validateProfileFields([{ field: 'phone', value: '+1 555 010 0100' }, { field: 'x', value: '  ', visibility: 'everyone' }]), [{ field: 'phone', value: '+1 555 010 0100', visibility: 'only_me' }]);
  assert.throws(() => validateProfileFields([{ field: 'ssn', value: '1', visibility: 'everyone' }]), /Unknown/);
  assert.throws(() => validateProfileFields([{ field: 'x', value: 'a', visibility: 'friends' }]), /Visibility/);
  assert.throws(() => validateProfileFields([{ field: 'x', value: 'a' }, { field: 'x', value: 'b' }]), /twice/);
});

test('fields link to the right places and read naturally', () => {
  assert.equal(fieldHref('linkedin', 'mihirkavishwar'), 'https://www.linkedin.com/in/mihirkavishwar');
  assert.equal(fieldHref('mastodon', 'mihir@mastodon.social'), 'https://mastodon.social/@mihir');
  assert.equal(fieldHref('email', 'a@b.co'), 'mailto:a@b.co');
  assert.equal(fieldHref('phone', '+91 98765 43210'), 'tel:+919876543210');
  assert.equal(fieldHref('discord', 'mihir'), undefined);
  assert.equal(fieldDisplay('x', 'mihir'), '@mihir');
  assert.equal(fieldDisplay('website', 'https://www.example.com/'), 'example.com');
  assert.deepEqual(readVisibleFields([{ field: 'x', value: 'a' }, { field: 'made_up', value: 'b' }, null, { field: 'email', value: 'a@b.co' }]), [{ field: 'email', value: 'a@b.co' }, { field: 'x', value: 'a' }]);
});

test('profile addresses are /@handle', () => {
  assert.equal(publicProfileUrl('@MihirKavishwar'), 'https://openmedia.site/@mihirkavishwar');
  assert.equal(profileHandleFromPath('/@mihirkavishwar'), 'mihirkavishwar');
  assert.equal(profileHandleFromPath('/@mihirkavishwar/'), 'mihirkavishwar');
  assert.equal(profileHandleFromPath('/@mihirkavishwar/resume'), undefined);
  assert.equal(profileHandleFromPath('/mihirkavishwar'), undefined);
});

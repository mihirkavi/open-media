import assert from 'node:assert/strict';
import test from 'node:test';

import { mockConversations } from '../data/mockData';
import { mockPosts } from '../data/mockPosts';
import { universalSearch } from './search';
import { relatedSettings, searchSettings, settingById, settingForSection, settingIndex, settingPath } from './settings';

test('settings accept natural language queries', () => assert.equal(searchSettings('use chronological feed')[0]?.route, 'feed'));
test('universal search spans settings, messages, and posts', () => {
  assert.equal(universalSearch('dark mode', mockPosts, mockConversations)[0]?.kind, 'setting');
  assert.ok(universalSearch('Maya', mockPosts, mockConversations).some((result) => result.kind === 'conversation'));
  assert.ok(universalSearch('protocol', mockPosts, mockConversations).some((result) => result.kind === 'post'));
});

test('a setting result knows the exact place it lives', () => {
  const password = searchSettings('change my password')[0];
  assert.equal(password?.id, 'password');
  assert.equal(password?.page, 'profile');
  assert.equal(password?.anchor, 'security');
  assert.equal(settingPath(password!), 'Profile › Sign-in and security');
  assert.equal(searchSettings('whatsapp')[0]?.page, 'connections');
  assert.equal(searchSettings('write my algorithm')[0]?.anchor, 'feed-algorithm');
});

test('settings search forgives typos, half-typed words and other words for the same thing', () => {
  assert.equal(searchSettings('apperance')[0]?.id, 'appearance');
  assert.equal(searchSettings('pasword')[0]?.id, 'password');
  assert.equal(searchSettings('passw')[0]?.id, 'password');
  assert.equal(searchSettings('2fa')[0]?.id, 'passkeys');
  assert.equal(searchSettings('log out')[0]?.id, 'sign-out');
  assert.equal(searchSettings('make my account private')[0]?.id, 'privacy');
  assert.equal(searchSettings('profile picture')[0]?.id, 'edit-profile');
});

test('settings search leaves out weak matches', () => {
  assert.deepEqual(searchSettings('delete account').map((entry) => entry.id), ['delete-account']);
  assert.deepEqual(searchSettings('zzzz qqqq'), []);
});

test('the settings graph is whole: unique ids, real links, and an anchor wherever a page scrolls', () => {
  const ids = settingIndex.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of settingIndex) {
    assert.ok(entry.path.length > 0, entry.id);
    assert.equal(relatedSettings(entry).length, entry.related?.length ?? 0, `${entry.id} links to a missing setting`);
    if (['settings', 'connections', 'profile'].includes(entry.page)) assert.ok(entry.anchor, `${entry.id} needs an anchor`);
  }
});

test('every section Open Media AI can open resolves to a setting', () => {
  for (const section of ['appearance', 'feed', 'language', 'messages', 'email', 'chat-networks', 'cross-posting', 'ai', 'privacy', 'data', 'profile', 'about', 'security', 'payments', 'store', 'people', 'contacts', 'account']) {
    assert.ok(settingForSection(section), section);
  }
  assert.equal(settingForSection('passkeys'), settingById('passkeys'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { senderIconUrls } from './senderIcons';

test('prefers the verified logo, then the company site icon', () => {
  assert.deepEqual(senderIconUrls('hello@news.vivino.com', 'https://images.vivino.com/logo.svg'), [
    'https://images.vivino.com/logo.svg',
    'https://vivino.com/apple-touch-icon.png',
    'https://www.vivino.com/apple-touch-icon.png',
    'https://www.vivino.com/favicon.ico',
  ]);
});

test('people on personal mail providers get initials, not the provider logo', () => {
  assert.deepEqual(senderIconUrls('friend@gmail.com'), []);
  assert.deepEqual(senderIconUrls('me@icloud.com'), []);
  assert.deepEqual(senderIconUrls('not-an-address'), []);
});

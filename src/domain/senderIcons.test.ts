import assert from 'node:assert/strict';
import test from 'node:test';

import { senderIconUrls } from './senderIcons';

test('prefers the verified logo, then the sharp company icon from the icon service', () => {
  assert.deepEqual(senderIconUrls('hello@news.vivino.com', 'https://images.vivino.com/logo.svg', 'https://api.openmedia.site'), [
    'https://images.vivino.com/logo.svg',
    'https://api.openmedia.site/v1/sender-icons/vivino.com',
  ]);
  assert.deepEqual(senderIconUrls('hello@news.vivino.com'), [], 'no blurry favicon.ico fallback without the service');
});

test('people on personal mail providers get initials, not the provider logo', () => {
  assert.deepEqual(senderIconUrls('friend@gmail.com'), []);
  assert.deepEqual(senderIconUrls('me@icloud.com'), []);
  assert.deepEqual(senderIconUrls('not-an-address'), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

import { decryptSecret, encryptSecret } from './crypto.js';

test('encrypts mailbox credentials with authenticated encryption', () => {
  const key = randomBytes(32).toString('base64');
  const encrypted = encryptSecret('app-specific-password', key);
  assert.equal(encrypted.includes('app-specific-password'), false);
  assert.equal(decryptSecret(encrypted, key), 'app-specific-password');
});

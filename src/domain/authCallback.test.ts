import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthRedirectURL, parseAuthCallbackURL } from './authCallback';

test('creates platform-specific auth callback URLs', () => {
  assert.equal(createAuthRedirectURL('web', 'http://localhost:8081'), 'http://localhost:8081/auth');
  assert.equal(createAuthRedirectURL('web', 'https://openmedia.example/settings'), 'https://openmedia.example/auth');
  assert.equal(createAuthRedirectURL('native'), 'openmedia://auth');
  assert.throws(() => createAuthRedirectURL('web'), /web origin is required/i);
  assert.throws(() => createAuthRedirectURL('web', 'openmedia://app'), /HTTP or HTTPS origin/i);
});

test('accepts only Open Media auth callback routes', () => {
  assert.deepEqual(parseAuthCallbackURL('openmedia://auth?code=one'), { code: 'one' });
  assert.deepEqual(parseAuthCallbackURL('convo://auth?code=two'), { code: 'two' });
  assert.deepEqual(parseAuthCallbackURL('https://app.example/auth?code=three'), { code: 'three' });
  assert.equal(parseAuthCallbackURL('openmedia://profile?code=stolen'), undefined);
  assert.equal(parseAuthCallbackURL('not a URL'), undefined);
});

test('surfaces provider callback errors without exchanging a code', () => {
  assert.deepEqual(
    parseAuthCallbackURL('openmedia://auth#error=access_denied&error_description=Link%20expired'),
    { error: 'Link expired' },
  );
});

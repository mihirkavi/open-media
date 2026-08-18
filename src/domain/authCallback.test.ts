import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAuthCallbackURL } from './authCallback';

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

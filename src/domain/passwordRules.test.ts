import assert from 'node:assert/strict';
import test from 'node:test';

import { passkeyRelyingParty, passkeysSwitchedOffError, passwordProblem } from './passwordRules';

test('passwords need 8 characters and fit the 72-byte hash limit', () => {
  assert.match(passwordProblem('short') ?? '', /at least 8/);
  assert.equal(passwordProblem('correct horse'), undefined);
  assert.match(passwordProblem('é'.repeat(37)) ?? '', /shorter/, '74 bytes even though it is 37 characters');
  assert.match(passwordProblem('        ') ?? '', /spaces/);
});

test('the email name alone is refused as a password', () => {
  assert.match(passwordProblem('mihirkav', 'MihirKav@example.com') ?? '', /email name/);
  assert.equal(passwordProblem('mihirkav-2026', 'mihirkav@example.com'), undefined);
});

test('passkeys belong to the site domain, shared by www', () => {
  assert.deepEqual(passkeyRelyingParty({ hostname: 'www.openmedia.site', origin: 'https://www.openmedia.site' }), { rpId: 'openmedia.site', rpOrigins: ['https://www.openmedia.site'] });
  assert.deepEqual(passkeyRelyingParty({ hostname: 'localhost', origin: 'http://localhost:8081' }), { rpId: 'localhost', rpOrigins: ['http://localhost:8081'] });
});

test('passkeys switched off on the server are recognised, other errors are not', () => {
  assert.equal(passkeysSwitchedOffError('AuthApiError MFA enroll is disabled for WebAuthn mfa_webauthn_enroll_not_enabled'), true);
  assert.equal(passkeysSwitchedOffError('MFA verify is disabled for WebAuthn'), true);
  assert.equal(passkeysSwitchedOffError('NotAllowedError The operation either timed out or was not allowed'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultSmtpPort, mailProviderPresets, presetForEmail } from './mailPresets';

test('detects provider presets from the email domain', () => {
  assert.equal(presetForEmail('Someone@Gmail.com')?.id, 'gmail');
  assert.equal(presetForEmail('me@icloud.com')?.smtp.host, 'smtp.mail.me.com');
  assert.equal(presetForEmail('me@example.org'), undefined);
  assert.equal(presetForEmail('not-an-email'), undefined);
});

test('presets use encrypted ports that match their security mode', () => {
  for (const preset of mailProviderPresets) {
    assert.equal(preset.imap.port, 993, preset.id);
    assert.equal(preset.smtp.port, defaultSmtpPort(preset.smtp.security), preset.id);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultSmtpPort, mailProviderPresets, presetForEmail, presetForMxHosts } from './mailPresets';

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

test('identifies custom-domain providers from MX hosts', () => {
  assert.equal(presetForMxHosts(['mx01.mail.icloud.com.', 'mx02.mail.icloud.com.'])?.id, 'icloud');
  assert.equal(presetForMxHosts(['aspmx.l.google.com'])?.id, 'gmail');
  assert.equal(presetForMxHosts(['example-com.mail.protection.outlook.com'])?.id, 'outlook');
  assert.equal(presetForMxHosts(['in1-smtp.messagingengine.com'])?.id, 'fastmail');
  assert.equal(presetForMxHosts(['mail.example.com']), undefined);
  assert.equal(presetForMxHosts(['notgoogle.com']), undefined);
});

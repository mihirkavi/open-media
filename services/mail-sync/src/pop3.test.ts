import assert from 'node:assert/strict';
import test from 'node:test';

test('POP message dates fall back to the Received header, never the sync time', async () => {
  const { messageDate } = await import('./pop3.js');
  const sent = new Date('2026-10-01T10:00:00Z');
  assert.equal(messageDate({ date: sent, headers: new Map() }).toISOString(), sent.toISOString());
  assert.equal(messageDate({ headers: new Map([['received', 'from mx by mail; Thu, 01 Oct 2026 09:30:00 +0000']]) }).toISOString(), '2026-10-01T09:30:00.000Z');
  assert.equal(messageDate({ headers: new Map() }).getTime(), 0);
});

test('describes mail server failures without leaking details', async () => {
  const { describeMailError } = await import('./imap.js');
  const input = { host: '17.56.9.32', tlsServername: 'imap.mail.me.com', port: 993 };
  assert.match(describeMailError({ authenticationFailed: true, message: 'Command failed' }, input, 'IMAP'), /rejected the username or password.*app password/);
  assert.match(describeMailError({ message: '-ERR invalid password' }, input, 'POP'), /rejected the username or password/);
  assert.match(describeMailError({ code: 'ETIMEDOUT', message: 'x' }, input, 'IMAP'), /did not respond/);
  assert.match(describeMailError({ message: 'connect ECONNREFUSED' }, input, 'IMAP'), /imap\.mail\.me\.com:993/);
});

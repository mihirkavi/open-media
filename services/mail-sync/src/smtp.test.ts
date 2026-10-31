import assert from 'node:assert/strict';
import { createServer, Socket } from 'node:net';
import test from 'node:test';

import { sendSmtp, SmtpConnection, SmtpSocket, testSmtp } from './smtp.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * An in-memory SMTP server that answers like iCloud: STARTTLS on 587, AUTH only after TLS, and
 * several reply lines in one chunk. `upgraded` records whether the client switched to TLS.
 */
function fakeIcloud({ password = 'good-password', auth = 'LOGIN PLAIN' } = {}) {
  const state = { upgraded: false, commands: [] as string[] };
  const outbox: Uint8Array[] = [encoder.encode('220 iCloud SMTP ready\r\n')];
  let wake: (() => void) | undefined;
  let pending = '';
  let inData = false;
  let loginStep: 'user' | 'pass' | undefined;
  const reply = (text: string) => { outbox.push(encoder.encode(text)); wake?.(); };
  const handle = (line: string) => {
    if (inData) {
      if (line === '.') { inData = false; reply('250 2.0.0 queued\r\n'); }
      else state.commands.push(`DATA ${line}`);
      return;
    }
    state.commands.push(line.startsWith('AUTH PLAIN ') ? 'AUTH PLAIN ***' : loginStep ? `LOGIN ${loginStep}` : line);
    if (loginStep === 'user') { loginStep = 'pass'; reply('334 UGFzc3dvcmQ6\r\n'); return; }
    if (loginStep === 'pass') {
      loginStep = undefined;
      reply(Buffer.from(line, 'base64').toString() === password ? '235 2.7.0 Authentication successful\r\n' : '535 5.7.8 Authentication failed\r\n');
      return;
    }
    if (line.startsWith('EHLO')) reply(`250-outbound.icloud.test\r\n250-PIPELINING\r\n${state.upgraded ? `250-AUTH ${auth}\r\n` : '250-STARTTLS\r\n'}250 SMTPUTF8\r\n`);
    else if (line === 'STARTTLS') reply('220 2.0.0 Ready to start TLS\r\n');
    else if (line.startsWith('AUTH PLAIN ')) {
      if (!state.upgraded) reply('530 5.7.0 Must issue a STARTTLS command first\r\n');
      else reply(Buffer.from(line.slice(11), 'base64').toString().split('\0')[2] === password ? '235 2.7.0 Authentication successful\r\n' : '535 5.7.8 Authentication failed\r\n');
    } else if (line === 'AUTH LOGIN') { loginStep = 'user'; reply('334 VXNlcm5hbWU6\r\n'); }
    else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) reply('250 2.1.0 OK\r\n');
    else if (line === 'DATA') { inData = true; reply('354 End data with <CR><LF>.<CR><LF>\r\n'); }
    else if (line === 'QUIT') reply('221 2.0.0 Bye\r\n');
    else reply('500 5.5.1 Unknown command\r\n');
  };
  const socket: SmtpSocket = {
    async read() {
      while (!outbox.length) await new Promise<void>((resolve) => { wake = resolve; });
      return outbox.shift() ?? null;
    },
    async write(bytes) {
      pending += decoder.decode(bytes);
      let end: number;
      while ((end = pending.indexOf('\r\n')) >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 2); handle(line); }
    },
    async startTls() { state.upgraded = true; },
    close() {},
  };
  return { socket, state };
}

const icloud: SmtpConnection = { host: 'smtp.mail.me.com', address: 'smtp.mail.me.com', port: 587, security: 'starttls' };
const account = { email: 'person@example.test', username: 'person@icloud.test', password: 'good-password' };

test('SMTP sign-in upgrades with STARTTLS before sending the password', async () => {
  const server = fakeIcloud();
  await testSmtp(icloud, account, async () => server.socket);
  assert.equal(server.state.upgraded, true);
  assert.deepEqual(server.state.commands, ['EHLO openmedia.site', 'STARTTLS', 'EHLO openmedia.site', 'AUTH PLAIN ***', 'QUIT']);
});

test('SMTP sign-in falls back to AUTH LOGIN when PLAIN is not offered', async () => {
  const server = fakeIcloud({ auth: 'LOGIN' });
  await testSmtp(icloud, account, async () => server.socket);
  assert.deepEqual(server.state.commands.slice(3), ['AUTH LOGIN', 'LOGIN user', 'LOGIN pass', 'QUIT']);
});

test('a wrong app password says so, with the server reply and without the password', async () => {
  const server = fakeIcloud({ password: 'other-password' });
  await assert.rejects(testSmtp(icloud, account, async () => server.socket), (error: Error) => {
    assert.match(error.message, /didn't accept the username or app password/);
    assert.match(error.message, /535 5\.7\.8 Authentication failed/);
    assert.doesNotMatch(error.message, /good-password/);
    return true;
  });
});

test('a server that refuses STARTTLS is a connection problem, not a password one', async () => {
  const server = fakeIcloud();
  const noTls: SmtpSocket = { ...server.socket, async startTls() { throw new Error('TLS failed'); } };
  await assert.rejects(testSmtp(icloud, account, async () => noTls), /Could not sign in to the outgoing mail server smtp\.mail\.me\.com:587/);
});

test('sending writes the envelope and dot-stuffs the body', async () => {
  const server = fakeIcloud();
  const sent = await sendSmtp(icloud, account, { to: ['friend@example.test'], subject: 'Hello', text: 'First line\n.hidden dot\nLast line' }, async () => server.socket);
  const commands = server.state.commands;
  assert.ok(commands.includes('MAIL FROM:<person@example.test>'));
  assert.ok(commands.includes('RCPT TO:<friend@example.test>'));
  assert.ok(commands.includes('DATA ..hidden dot'), 'a line starting with "." is sent as ".."');
  assert.ok(commands.includes('DATA Subject: Hello'));
  assert.equal(commands.at(-1), 'QUIT');
  assert.equal(sent.mailbox, 'Sent');
  assert.match(sent.sourceMessageId, /^<.+@example\.test>$/);
});

test('sending works over a real socket to a local test server', async () => {
  const sockets = new Set<Socket>();
  const received: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write('220 local ready\r\n');
    let buffered = '';
    let inData = false;
    socket.on('data', (data) => {
      buffered += data.toString();
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (inData) { if (line === '.') { inData = false; socket.write('250 queued\r\n'); } else received.push(line); continue; }
        if (line.startsWith('EHLO')) socket.write('250-local\r\n250 SIZE 1000000\r\n');
        else if (line === 'DATA') { inData = true; socket.write('354 go ahead\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  try {
    await sendSmtp({ host: '127.0.0.1', address: '127.0.0.1', port: address.port, security: 'starttls', allowPlaintext: true }, account, { to: ['friend@example.test'], subject: 'Local', text: 'Hi there' });
    assert.ok(received.includes('Hi there'));
  } finally {
    sockets.forEach((socket) => socket.destroy());
    server.close();
  }
});

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

/** A POP mailbox of `count` messages. `uidl: false` answers UIDL with -ERR, like servers without it. */
async function fakePop({ count, uidl = true }: { count: number; uidl?: boolean }) {
  const { createServer } = await import('node:net');
  const retrieved: number[] = [];
  const message = (i: number) => `Message-ID: <p${i}@example.test>\r\nFrom: Sender <s${i}@example.test>\r\nSubject: Pop ${i}\r\nDate: Thu, 01 Oct 2026 09:${String(i % 60).padStart(2, '0')}:00 +0000\r\n\r\nHello ${i}\r\n`;
  const server = createServer((socket) => {
    socket.write('+OK ready\r\n');
    let buffered = '';
    socket.on('data', (data) => {
      buffered += data.toString();
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const [command, arg] = buffered.slice(0, end).split(' ');
        buffered = buffered.slice(end + 2);
        if (command === 'USER' || command === 'PASS') socket.write('+OK\r\n');
        else if (command === 'STAT') socket.write(`+OK ${count} 1000\r\n`);
        else if (command === 'UIDL') socket.write(uidl ? `+OK\r\n${Array.from({ length: count }, (_, i) => `${i + 1} uid-${i + 1}\r\n`).join('')}.\r\n` : '-ERR not supported\r\n');
        else if (command === 'RETR') { retrieved.push(Number(arg)); socket.write(`+OK\r\n${message(Number(arg))}.\r\n`); }
        else if (command === 'QUIT') socket.end('+OK bye\r\n');
        else socket.write('-ERR unknown\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const input = { email: 'person@example.test', protocol: 'pop3' as const, host: '127.0.0.1', port: address.port, secure: false, username: 'person', password: 'test-password', allowPlaintext: true };
  return { input, retrieved, deliver: () => { count += 1; }, close: () => server.close() };
}

test('POP: an unchanged mailbox downloads nothing, and new mail downloads only what came after', async () => {
  const { syncPop3 } = await import('./pop3.js');
  const pop = await fakePop({ count: 4 });
  try {
    let cursor: import('./mailCursor.js').PopCursor | undefined;
    const first = await syncPop3(pop.input, 50, { onCursor: (next) => { cursor = next; } });
    assert.equal(first.length, 4);
    assert.deepEqual(cursor, { count: 4, last: 'uid-4' });
    pop.retrieved.length = 0;
    assert.deepEqual(await syncPop3(pop.input, 50, { cursor }), []);
    assert.deepEqual(pop.retrieved, [], 'nothing downloaded');
    pop.deliver();
    const next = await syncPop3(pop.input, 50, { cursor, onCursor: (value) => { cursor = value; } });
    assert.deepEqual(next.map((message) => message.subject), ['Pop 5']);
    assert.deepEqual(pop.retrieved, [5]);
    assert.deepEqual(cursor, { count: 5, last: 'uid-5' });
  } finally { pop.close(); }
});

test('POP: only mail that is not stored yet is returned, and servers without UIDL still work', async () => {
  const { syncPop3 } = await import('./pop3.js');
  const pop = await fakePop({ count: 3, uidl: false });
  try {
    let cursor: import('./mailCursor.js').PopCursor | undefined;
    const messages = await syncPop3(pop.input, 50, {
      onCursor: (next) => { cursor = next; },
      known: async (ids) => new Map(ids.filter((id) => id !== '<p3@example.test>').map((id) => [id, { sender: '', recipients: [] }])),
    });
    assert.deepEqual(messages.map((message) => message.subject), ['Pop 3']);
    assert.deepEqual(cursor, { count: 3, last: '' });
  } finally { pop.close(); }
});

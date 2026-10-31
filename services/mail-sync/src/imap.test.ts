import assert from 'node:assert/strict';
import { createServer, Socket } from 'node:net';
import test from 'node:test';

/**
 * A minimal IMAP server that answers like iCloud: after login, the untagged
 * CAPABILITY line and its tagged OK arrive in one TCP write.
 */
async function fakeIcloud(): Promise<{ port: number; close: () => void }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write('* OK [CAPABILITY IMAP4rev1] ready\r\n');
    let buffered = '';
    socket.on('data', (data) => {
      buffered += data.toString();
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const [tag, command] = line.split(' ');
        if (command === 'LOGIN') socket.write(`${tag} OK user authenticated\r\n`);
        else if (command === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1 ID NAMESPACE ENABLE CONDSTORE\r\n${tag} OK Completed\r\n`);
        else if (command === 'ID') socket.write(`* ID ("name" "fake")\r\n${tag} OK ID completed\r\n`);
        else if (command === 'NAMESPACE') socket.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK NAMESPACE completed\r\n`);
        else if (command === 'ENABLE') socket.write(`${tag} OK ENABLE completed\r\n`);
        else if (command === 'LOGOUT') socket.end(`* BYE\r\n${tag} OK bye\r\n`);
        else socket.write(`${tag} BAD unknown\r\n`);
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return { port: address.port, close: () => { sockets.forEach((socket) => socket.destroy()); server.close(); } };
}

test('IMAP sign-in finishes when nextTick runs as a microtask, as on Cloudflare Workers', async () => {
  const { testImap } = await import('./imap.js');
  const server = await fakeIcloud();
  // workerd implements process.nextTick with queueMicrotask. Without the reader
  // fix in clientFor(), ImapFlow then misses the second line of a two-line reply
  // and the sign-in hangs until the socket times out.
  const nextTick = process.nextTick;
  process.nextTick = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => callback(...args))) as typeof process.nextTick;
  try {
    const signIn = testImap({
      email: 'person@example.test', protocol: 'imap', host: '127.0.0.1', port: server.port, secure: false,
      username: 'person@example.test', password: 'test-password', allowPlaintext: true,
    });
    let timer: NodeJS.Timeout | undefined;
    const hung = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('IMAP sign-in hung')), 3_000); });
    try { await Promise.race([signIn, hung]); }
    finally { clearTimeout(timer); }
  } finally {
    process.nextTick = nextTick;
    server.close();
  }
});

/**
 * A fake mailbox of `count` messages that honours FETCH ranges and items. `dropAfterFetches`
 * closes the connection after that many body FETCHes; `hangOnLogout` never answers LOGOUT.
 */
async function fakeMailbox({ count, dropAfterFetches, hangOnLogout = false }: { count: number; dropAfterFetches?: number; hangOnLogout?: boolean }) {
  const sockets = new Set<Socket>();
  const fetched: string[] = [];
  const message = (i: number) => `Message-ID: <m${i}@example.test>\r\nFrom: Sender <s${i}@example.test>\r\nSubject: Test ${i}\r\n\r\nHello ${i}\r\n`;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write('* OK [CAPABILITY IMAP4rev1] ready\r\n');
    let buffered = '';
    let bodyFetches = 0;
    socket.on('data', (data) => {
      buffered += data.toString();
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const [tag, command, arg] = line.split(' ');
        const upper = command?.toUpperCase();
        if (upper === 'LOGIN') socket.write(`${tag} OK logged in\r\n`);
        else if (upper === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1 SPECIAL-USE\r\n${tag} OK done\r\n`);
        else if (upper === 'LIST') socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent Messages"\r\n${tag} OK done\r\n`);
        else if (upper === 'EXAMINE' || upper === 'SELECT') socket.write(`* ${count} EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n${tag} OK [READ-ONLY] done\r\n`);
        else if (upper === 'FETCH' || (upper === 'UID' && arg?.toUpperCase() === 'FETCH')) {
          const range = upper === 'UID' ? line.split(' ')[3] : arg;
          const withBody = /BODY(\.PEEK)?\[\]/i.test(line);
          if (withBody) {
            fetched.push(range);
            if (dropAfterFetches !== undefined && ++bodyFetches > dropAfterFetches) { socket.destroy(); return; }
          }
          const wanted = new Set<number>();
          for (const part of range.split(',')) {
            const [low, high] = part.split(':');
            for (let i = Number(low); i <= (high === undefined ? Number(low) : high === '*' ? count : Number(high)); i += 1) wanted.add(i);
          }
          let out = '';
          for (const i of [...wanted].sort((a, b) => a - b)) {
            const body = message(i);
            out += `* ${i} FETCH (UID ${i} RFC822.SIZE ${body.length} ENVELOPE (NIL "Test ${i}" (("Sender" NIL "s${i}" "example.test")) NIL NIL NIL NIL NIL NIL "<m${i}@example.test>")${withBody ? ` BODY[] {${body.length}}\r\n${body}` : ''})\r\n`;
          }
          socket.write(`${out}${tag} OK done\r\n`);
        } else if (upper === 'LOGOUT') { if (!hangOnLogout) socket.end(`* BYE\r\n${tag} OK bye\r\n`); }
        else socket.write(`${tag} OK done\r\n`);
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const input = { email: 'person@example.test', protocol: 'imap' as const, host: '127.0.0.1', port: address.port, secure: false, username: 'person', password: 'test-password', allowPlaintext: true };
  return { input, fetched, close: () => { sockets.forEach((socket) => socket.destroy()); server.close(); } };
}

test('IMAP sync reads the newest messages, bodies in batches of ten', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 30 });
  try {
    const messages = await syncImap(mailbox.input, { INBOX: 25, Sent: 5 });
    const inbox = messages.filter((message) => message.mailbox === 'INBOX');
    assert.equal(inbox.length, 25);
    assert.equal(inbox[0].subject, 'Test 30', 'newest first');
    assert.match(inbox[0].text, /Hello 30/);
    assert.equal(messages.filter((message) => message.mailbox === 'Sent').length, 5);
    assert.deepEqual(mailbox.fetched.slice(0, 3), ['30,29,28,27,26,25,24,23,22,21', '20,19,18,17,16,15,14,13,12,11', '10,9,8,7,6']);
  } finally { mailbox.close(); }
});

test('IMAP sync keeps the messages that arrived when the connection drops partway', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 30, dropAfterFetches: 1 });
  try {
    const messages = await syncImap(mailbox.input, { INBOX: 30, Sent: 0 });
    assert.equal(messages.length, 10);
    assert.equal(messages[0].subject, 'Test 30');
  } finally { mailbox.close(); }
});

test('a sync that gets nothing explains the problem instead of "Connection not available"', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 30, dropAfterFetches: 0 });
  try {
    await assert.rejects(syncImap(mailbox.input, { INBOX: 30, Sent: 0 }), (error: Error) => {
      assert.equal(error.name, 'UserFacingError');
      assert.doesNotMatch(error.message, /Connection not available/);
      return true;
    });
  } finally { mailbox.close(); }
});

test('a server that never answers LOGOUT does not fail a finished sync', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 3, hangOnLogout: true });
  try {
    const started = Date.now();
    const messages = await syncImap(mailbox.input, { INBOX: 3, Sent: 0 });
    assert.equal(messages.length, 3);
    assert.ok(Date.now() - started < 6_000);
  } finally { mailbox.close(); }
});

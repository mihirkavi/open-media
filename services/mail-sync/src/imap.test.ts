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
 * `withAttachment` adds a small file to each message; `reportedSize` overrides RFC822.SIZE.
 * IDLE is supported, and `deliver()` adds a message and tells idling clients, like new mail.
 */
async function fakeMailbox({ count, dropAfterFetches, hangOnLogout = false, withAttachment = false, reportedSize, withCc = false }: { count: number; dropAfterFetches?: number; hangOnLogout?: boolean; withAttachment?: boolean; reportedSize?: number; withCc?: boolean }) {
  const sockets = new Set<Socket>();
  const fetched: string[] = [];
  const idling = new Set<Socket>();
  const headers = (i: number) => `Message-ID: <m${i}@example.test>\r\nFrom: Sender <s${i}@example.test>\r\nSubject: Test ${i}\r\n`;
  const message = (i: number) => withAttachment
    ? `${headers(i)}MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nHello ${i}\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=file${i}.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(`file ${i}`).toString('base64')}\r\n--b--\r\n`
    : `${headers(i)}\r\nHello ${i}\r\n`;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write('* OK [CAPABILITY IMAP4rev1] ready\r\n');
    let buffered = '';
    let bodyFetches = 0;
    let idleTag = '';
    socket.on('data', (data) => {
      buffered += data.toString();
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const [tag, command, arg] = line.split(' ');
        const upper = command?.toUpperCase();
        if (tag === 'DONE') { idling.delete(socket); socket.write(`${idleTag} OK idle done\r\n`); continue; }
        if (upper === 'IDLE') { idleTag = tag; idling.add(socket); socket.write('+ idling\r\n'); continue; }
        if (upper === 'LOGIN') socket.write(`${tag} OK logged in\r\n`);
        else if (upper === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1 SPECIAL-USE IDLE\r\n${tag} OK done\r\n`);
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
            out += `* ${i} FETCH (UID ${i} RFC822.SIZE ${reportedSize ?? body.length} ENVELOPE (NIL "Test ${i}" (("Sender" NIL "s${i}" "example.test")) NIL NIL (("Me" NIL "person" "example.test")) ${withCc ? '(("Ana Lima" NIL "ana" "example.test"))' : 'NIL'} NIL NIL "<m${i}@example.test>")${withBody ? ` BODY[] {${body.length}}\r\n${body}` : ''})\r\n`;
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
  const deliver = () => { count += 1; idling.forEach((socket) => socket.write(`* ${count} EXISTS\r\n`)); };
  return { input, fetched, deliver, close: () => { sockets.forEach((socket) => socket.destroy()); server.close(); } };
}

/** How the fake mailbox's message `i` is stored once synced with names. */
const people = (i: number) => ({ sender: `"Sender" <s${i}@example.test>`, recipients: ['"Me" <person@example.test>'] });

test('IMAP sync reads the newest messages, bodies in batches of ten', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 30 });
  try {
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 25, Sent: 5 } });
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
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 30, Sent: 0 } });
    assert.equal(messages.length, 10);
    assert.equal(messages[0].subject, 'Test 30');
  } finally { mailbox.close(); }
});

test('a sync that gets nothing explains the problem instead of "Connection not available"', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 30, dropAfterFetches: 0 });
  try {
    await assert.rejects(syncImap(mailbox.input, { limits: { INBOX: 30, Sent: 0 } }), (error: Error) => {
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
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 3, Sent: 0 } });
    assert.equal(messages.length, 3);
    assert.ok(Date.now() - started < 6_000);
  } finally { mailbox.close(); }
});

test('sync saves each batch before downloading the next, then lets go of the file bytes', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 25, withAttachment: true });
  const saves: Array<{ size: number; downloadsSoFar: number; withBytes: boolean }> = [];
  try {
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 25, Sent: 0 }, save: async (batch) => {
      saves.push({ size: batch.length, downloadsSoFar: mailbox.fetched.length, withBytes: batch.every((message) => Buffer.isBuffer(message.attachments?.[0]?.content)) });
    } });
    assert.deepEqual(saves, [{ size: 10, downloadsSoFar: 1, withBytes: true }, { size: 10, downloadsSoFar: 2, withBytes: true }, { size: 5, downloadsSoFar: 3, withBytes: true }]);
    assert.equal(messages.length, 25);
    assert.equal(messages[0].attachments?.[0].filename, 'file25.pdf');
    assert.ok(messages.every((message) => message.attachments?.every((attachment) => attachment.content === undefined)), 'no bytes are kept after saving');
  } finally { mailbox.close(); }
});

test('large messages download in smaller batches', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 5, reportedSize: 5 * 1024 * 1024 });
  try {
    await syncImap(mailbox.input, { limits: { INBOX: 5, Sent: 0 } });
    assert.deepEqual(mailbox.fetched, ['5,4', '3,2', '1']);
  } finally { mailbox.close(); }
});

test('a failed save fails the sync instead of looking like a partial one', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 25 });
  let calls = 0;
  try {
    await assert.rejects(syncImap(mailbox.input, { limits: { INBOX: 25, Sent: 0 }, save: async () => { if (++calls === 2) throw new Error('database unavailable'); } }), /database unavailable/);
  } finally { mailbox.close(); }
});

test('sync downloads only new mail, plus mail saved without the sender name', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 30 });
  try {
    // m30–m21 are stored with names; m20 was stored before names were kept.
    const stored = new Map(Array.from({ length: 10 }, (_, index) => [`<m${30 - index}@example.test>`, people(30 - index)]));
    stored.set('<m20@example.test>', { sender: 's20@example.test', recipients: ['person@example.test'] });
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 25, Sent: 0 }, known: async (ids) => new Map(ids.filter((id) => stored.has(id)).map((id) => [id, stored.get(id)!])) });
    assert.equal(messages.length, 15);
    assert.equal(messages[0].subject, 'Test 20');
    assert.equal(messages[0].from, '"Sender" <s20@example.test>');
    assert.equal(mailbox.fetched[0], '20,19,18,17,16,15,14,13,12,11');
  } finally { mailbox.close(); }
});

test('a waiting sync returns new mail moments after it arrives, with nextTick as on Workers', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 3 });
  const everything = async (ids: string[]) => new Map(ids.filter((id) => id !== '<m4@example.test>').map((id) => [id, people(Number(id.match(/\d+/)![0]))]));
  const nextTick = process.nextTick;
  process.nextTick = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => callback(...args))) as typeof process.nextTick;
  try {
    const started = Date.now();
    setTimeout(mailbox.deliver, 300);
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 3, Sent: 0 }, known: everything, waitMs: 5_000 });
    assert.deepEqual(messages.map((message) => message.subject), ['Test 4']);
    assert.ok(Date.now() - started < 2_000, 'answers when mail arrives, not at the end of the wait');
  } finally {
    process.nextTick = nextTick;
    mailbox.close();
  }
});

test('a waiting sync with no new mail answers empty when the wait ends', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 3 });
  try {
    const started = Date.now();
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 3, Sent: 0 }, known: async (ids) => new Map(ids.map((id) => [id, people(Number(id.match(/\d+/)![0]))])), waitMs: 400 });
    assert.deepEqual(messages, []);
    assert.ok(Date.now() - started >= 400);
  } finally { mailbox.close(); }
});

test('Cc recipients are kept, and mail saved before Cc was kept is downloaded once more', async () => {
  const { syncImap } = await import('./imap.js');
  const mailbox = await fakeMailbox({ count: 2, withCc: true });
  try {
    const before = { sender: '"Sender" <s2@example.test>', recipients: ['person@example.test'] };
    const after = { sender: '"Sender" <s1@example.test>', recipients: ['"Me" <person@example.test>', '"Ana Lima" <ana@example.test>'] };
    const stored = new Map([['<m2@example.test>', before], ['<m1@example.test>', after]]);
    const messages = await syncImap(mailbox.input, { limits: { INBOX: 2, Sent: 0 }, known: async () => stored });
    assert.deepEqual(messages.map((message) => message.subject), ['Test 2'], 'only the message saved without Cc');
    assert.deepEqual(messages[0].to, ['"Me" <person@example.test>', '"Ana Lima" <ana@example.test>']);
  } finally { mailbox.close(); }
});

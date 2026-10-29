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

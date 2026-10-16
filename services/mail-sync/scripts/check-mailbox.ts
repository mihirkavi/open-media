/**
 * `npm run mail:check` — tests a mailbox sign-in from your own terminal, with
 * the same IMAP/SMTP code Open Media uses, and shows the server's exact reply.
 *
 * The password is typed hidden, used only for this check, and never saved or
 * printed. Nothing is stored in Open Media.
 */
import { resolveMx } from 'node:dns/promises';
import { createInterface } from 'node:readline';

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

import { presetForEmail, presetForMxHosts } from '../../../src/domain/mailPresets';

async function main() {
  console.log('Check a mailbox sign-in (nothing is saved).\n');
  const email = (await ask('Email address: ')).trim().toLowerCase();
  const domain = email.split('@')[1];
  if (!domain) throw new Error('That does not look like an email address.');

  let preset = presetForEmail(email);
  if (!preset) {
    const mx = await resolveMx(domain).catch(() => []);
    preset = presetForMxHosts(mx.map((record) => record.exchange));
    if (preset) console.log(`${domain} uses ${preset.label} (from its MX records).`);
  }
  const imapHost = preset?.imap.host ?? (await ask('IMAP server: ')).trim();
  const smtp = preset?.smtp;
  console.log(`IMAP ${imapHost}:993${smtp ? ` · SMTP ${smtp.host}:${smtp.port}` : ''}\n`);

  const username = (await ask(`Username [${email}]: `)).trim() || email;
  const password = await askHidden('App password (hidden): ');
  if (!password) throw new Error('A password is required.');

  // Apple accepts the full @icloud.com address or just the part before @.
  const candidates = [username];
  if (preset?.id === 'icloud' && username.includes('@')) candidates.push(username.split('@')[0]);

  let working: string | undefined;
  for (const user of candidates) {
    const result = await tryImap(imapHost, user, password);
    console.log(`IMAP as ${user}: ${result.ok ? '✓ signed in' : `✗ ${result.reply}`}`);
    if (result.ok) { working = user; break; }
  }

  if (!working) {
    console.log('\nNo username worked. Common causes:');
    if (preset?.id === 'icloud') {
      console.log('  • The username must be your @icloud.com address (iPhone: Settings → your name → iCloud → iCloud Mail).');
      console.log('  • Use a new app-specific password from account.apple.com, typed with its dashes.');
      console.log('  • iCloud Mail must be turned on for this Apple Account.');
    } else {
      console.log('  • Most providers need an app password, and some require IMAP to be enabled in their settings.');
    }
    rl.close();
    process.exit(1);
  }

  if (smtp) {
    const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.security === 'tls', requireTLS: smtp.security === 'starttls', auth: { user: working, pass: password }, connectionTimeout: 15_000 });
    const reply = await transport.verify().then(() => '✓ signed in', (error: Error & { response?: string }) => `✗ ${error.response ?? error.message}`);
    transport.close();
    console.log(`SMTP as ${working}: ${reply}`);
  }

  rl.close();
  console.log(`\n✓ Use these in Open Media → Settings → Email & connections:\n  Email address: ${email}\n  Username: ${working}\n  Password: the same app password`);
}

async function tryImap(host: string, user: string, pass: string): Promise<{ ok: boolean; reply: string }> {
  let lastServerLine = '';
  const remember = (entry: { msg?: string }) => { if (entry.msg && /^\d+ (NO|BAD)|^\* BYE/.test(entry.msg)) lastServerLine = entry.msg; };
  const client = new ImapFlow({
    host, port: 993, secure: true, auth: { user, pass }, disableCompression: true,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    logger: { debug: remember, info: remember, warn: remember, error: remember } as never,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.logout();
    return { ok: true, reply: 'OK' };
  } catch (error) {
    const detail = error as { responseText?: string; message?: string };
    return { ok: false, reply: detail.responseText || lastServerLine || detail.message || 'sign-in failed' };
  }
}

// One reader for every prompt, so typed or piped input is never lost between questions.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines: string[] = [];
let waiting: ((line: string) => void) | undefined;
let muted = false;
rl.on('line', (line) => { if (waiting) { const done = waiting; waiting = undefined; done(line); } else lines.push(line); });
const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
const write = output._writeToOutput.bind(rl);
output._writeToOutput = (text: string) => { if (!muted) write(text); else if (text.includes('\n')) process.stdout.write('\n'); };

function nextLine(): Promise<string> {
  const queued = lines.shift();
  return queued !== undefined ? Promise.resolve(queued) : new Promise((done) => { waiting = done; });
}

async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  return nextLine();
}

async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  muted = true;
  try { return (await nextLine()).trim(); } finally { muted = false; if (!process.stdin.isTTY) process.stdout.write('\n'); }
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

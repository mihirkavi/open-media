/**
 * `npm run local:email` — makes local sign-in emails go to your real inbox by
 * sending them through your own email provider's SMTP server.
 *
 * You type the password here, in your own terminal; it is saved only in
 * supabase/.env (gitignored, readable only by you) and is checked against the
 * server before it is saved. `npm run local:email -- --off` switches back to
 * the local test inbox.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import nodemailer from 'nodemailer';
import { defaultSmtpPort, presetForEmail, SmtpSecurity } from '../src/domain/mailPresets';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, 'supabase', '.env');

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

async function main() {
  if (process.argv.includes('--off')) {
    writeEnv({ enabled: false, host: 'localhost', port: 587, user: '', pass: '', from: 'no-reply@localhost' });
    restartAuth();
    console.log('✓ Sign-in emails go to the local test inbox again: http://127.0.0.1:54324');
    return;
  }

  console.log('Send Open Media sign-in emails through your own email provider.\n');
  const from = (await ask('Your email address (sign-in emails are sent from it): ')).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('That does not look like an email address.');

  const preset = presetForEmail(from);
  let host = preset?.smtp.host ?? '';
  let security: SmtpSecurity = preset?.smtp.security ?? 'starttls';
  let port = preset?.smtp.port ?? defaultSmtpPort(security);
  if (preset) {
    console.log(`\nDetected ${preset.label}: ${host}:${port} (${security === 'tls' ? 'TLS' : 'STARTTLS'})`);
    console.log(`Password: ${preset.passwordHelp}`);
    if (preset.caution) console.log(`Note: ${preset.caution}`);
  } else {
    host = (await ask('\nOutgoing (SMTP) server, e.g. smtp.example.com: ')).trim();
    security = (await ask('Security — type "tls" (port 465) or "starttls" (port 587) [starttls]: ')).trim().toLowerCase() === 'tls' ? 'tls' : 'starttls';
    port = Number((await ask(`Port [${defaultSmtpPort(security)}]: `)).trim()) || defaultSmtpPort(security);
  }
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('Enter a valid SMTP server hostname.');

  const user = (await ask(`\nSMTP username [${from}]: `)).trim() || from;
  const pass = await askHidden('Password (app password; hidden while you type): ');
  if (!pass) throw new Error('A password is required.');

  console.log(`\nChecking sign-in to ${host}:${port}…`);
  const transport = nodemailer.createTransport({ host, port, secure: security === 'tls', requireTLS: security === 'starttls', auth: { user, pass }, tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 15_000 });
  try {
    await transport.verify();
  } catch (error) {
    throw new Error(`The server refused the sign-in: ${(error as Error).message}\nCheck the server, port, username, and app password. Nothing was saved.`);
  } finally {
    transport.close();
  }

  writeEnv({ enabled: true, host, port, user, pass, from });
  restartAuth();
  console.log(`\n✓ Saved. Sign-in emails for the local app are now sent from ${from} through ${host}.`);
  console.log('  Your password is stored only in supabase/.env (gitignored). Run `npm run local:email -- --off` to undo.');
}

function writeEnv(values: { enabled: boolean; host: string; port: number; user: string; pass: string; from: string }) {
  const quote = (value: string) => JSON.stringify(value);
  writeFileSync(envFile, [
    '# Written by `npm run local:email`. Local only; gitignored. Do not commit.',
    `OPEN_MEDIA_SMTP_ENABLED=${values.enabled}`,
    `OPEN_MEDIA_SMTP_HOST=${values.host}`,
    `OPEN_MEDIA_SMTP_PORT=${values.port}`,
    `OPEN_MEDIA_SMTP_USER=${quote(values.user)}`,
    `OPEN_MEDIA_SMTP_PASS=${quote(values.pass)}`,
    `OPEN_MEDIA_SMTP_FROM=${quote(values.from)}`,
    '',
  ].join('\n'), { mode: 0o600 });
  chmodSync(envFile, 0o600);
}

function restartAuth() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    console.log('Docker is not running; the setting applies the next time you run `npm run local`.');
    return;
  }
  console.log('Restarting local Supabase so the setting takes effect…');
  execFileSync('npx', ['supabase', 'stop'], { cwd: root, stdio: 'ignore' });
  execFileSync('npx', ['supabase', 'start'], { cwd: root, stdio: 'ignore' });
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((done) => rl.question(question, (answer) => { rl.close(); done(answer); }));
}

function askHidden(question: string): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(question);
    output._writeToOutput = (text: string) => { if (text.includes('\n')) process.stdout.write('\n'); };
    rl.question('', (answer) => { rl.close(); done(answer); });
  });
}

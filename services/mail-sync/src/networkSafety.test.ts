import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublicAddress, resolveMailHost } from './networkSafety.js';

const answers = (...list: Array<{ address: string; family: number }>) => async () => list;

test('rejects private and link-local mail targets', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.2.3', '100.64.0.1', '::1', 'fd00::1']) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('17.57.154.29'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('non-IP strings are never treated as public addresses', () => {
  assert.equal(isPublicAddress('imap.mail.me.com.akadns.net.'), false);
  assert.equal(isPublicAddress(''), false);
});

test('connects by hostname after every IP answer is checked', async () => {
  const resolved = await resolveMailHost('imap.mail.me.com', false, answers(
    { address: 'imap.mail.me.com.akadns.net.', family: 4 },
    { address: '17.56.9.32', family: 4 },
  ));
  assert.deepEqual(resolved, { address: 'imap.mail.me.com', local: false });
});

test('refuses hosts with any private answer or no IP answers', async () => {
  await assert.rejects(resolveMailHost('evil.example', false, answers({ address: '17.56.9.32', family: 4 }, { address: '10.0.0.5', family: 4 })), /private or reserved/);
  await assert.rejects(resolveMailHost('alias.example', false, answers({ address: 'target.example.', family: 4 })), /Could not find/);
  await assert.rejects(resolveMailHost('missing.example', false, async () => { throw new Error('ENOTFOUND'); }), /Could not find/);
});

test('allows local mail servers only when explicitly enabled for development', async () => {
  assert.deepEqual(await resolveMailHost('localhost', true), { address: '127.0.0.1', local: true });
  await assert.rejects(resolveMailHost('127.0.0.1', false), /IP address/);
  await assert.rejects(resolveMailHost('localhost', false, answers({ address: '127.0.0.1', family: 4 })), /private or reserved/);
});

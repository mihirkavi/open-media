import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublicAddress } from './networkSafety.js';

test('rejects private and link-local mail targets', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.2.3', '::1', 'fd00::1']) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('17.57.154.29'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('allows local mail servers only when explicitly enabled for development', async () => {
  const { resolveMailHost } = await import('./networkSafety.js');
  assert.deepEqual(await resolveMailHost('localhost', true), { address: '127.0.0.1', local: true });
  await assert.rejects(resolveMailHost('localhost', false), /IP address|private or reserved/);
  await assert.rejects(resolveMailHost('127.0.0.1', false), /IP address/);
});

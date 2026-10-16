import assert from 'node:assert/strict';
import test from 'node:test';

test('POP message dates fall back to the Received header, never the sync time', async () => {
  const { messageDate } = await import('./pop3.js');
  const sent = new Date('2026-10-01T10:00:00Z');
  assert.equal(messageDate({ date: sent, headers: new Map() }).toISOString(), sent.toISOString());
  assert.equal(messageDate({ headers: new Map([['received', 'from mx by mail; Thu, 01 Oct 2026 09:30:00 +0000']]) }).toISOString(), '2026-10-01T09:30:00.000Z');
  assert.equal(messageDate({ headers: new Map() }).getTime(), 0);
});

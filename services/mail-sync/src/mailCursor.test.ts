import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCursor, parseCursor } from './mailCursor.js';

test('IMAP and POP cursors survive a round trip through the app', () => {
  const imap = { kind: 'imap' as const, imap: { inbox: { validity: '1700000000', next: 4821 }, sent: { validity: '3', next: 90 } } };
  assert.deepEqual(parseCursor(formatCursor(imap)), imap);
  const noSent = { kind: 'imap' as const, imap: { inbox: { validity: '7', next: 2 } } };
  assert.deepEqual(parseCursor(formatCursor(noSent)), { kind: 'imap', imap: { inbox: { validity: '7', next: 2 }, sent: undefined } });
  const pop = { kind: 'pop' as const, pop: { count: 12, last: 'AQ.xyz/+=' } };
  assert.deepEqual(parseCursor(formatCursor(pop)), pop);
});

test('a malformed or oversized cursor is ignored, so the sync reads the mailbox as before', () => {
  for (const value of [null, '', 'i1.x.1..', 'i2.1.2..', 'p1.-1.a', 'p1.3.%E0', 'p1.3.a%20b', `p1.1.${'a'.repeat(300)}`, 'i1.1.2.3', 'i1...']) {
    assert.equal(parseCursor(value), undefined, String(value));
  }
});

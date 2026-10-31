import assert from 'node:assert/strict';
import test from 'node:test';

import { nextMailPoll } from './liveMail';

test('new mail asks again right away', () => {
  assert.equal(nextMailPoll({ elapsedMs: 900, newMessages: 2, failures: 0 }), 0);
});

test('a full wait with nothing new asks again right away', () => {
  assert.equal(nextMailPoll({ elapsedMs: 25_300, newMessages: 0, failures: 0 }), 0);
});

test('a server that answers empty at once is polled every 15 seconds', () => {
  assert.equal(nextMailPoll({ elapsedMs: 1_200, newMessages: 0, failures: 0 }), 15_000);
});

test('errors back off to once a minute', () => {
  assert.deepEqual([1, 2, 3, 6].map((failures) => nextMailPoll({ elapsedMs: 100, newMessages: 0, failures })), [15_000, 30_000, 60_000, 60_000]);
});

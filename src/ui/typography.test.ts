import assert from 'node:assert/strict';
import test from 'node:test';

import { sfTracking } from './typeMetrics';

const close = (a: number, b: number) => Math.abs(a - b) < 0.0005;

test('SF tracking matches apple.com at its common sizes', () => {
  assert.ok(close(sfTracking(12), -0.01));
  assert.ok(close(sfTracking(14), -0.0148));
  assert.ok(close(sfTracking(17), -0.022));
  assert.ok(close(sfTracking(21), 0.0105));
  assert.equal(sfTracking(40), 0);
  assert.equal(sfTracking(72), 0);
});

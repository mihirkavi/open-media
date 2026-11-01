import assert from 'node:assert/strict';
import test from 'node:test';

import { geistTracking } from './typeMetrics';

test('Geist tracking leaves reading text open and tightens large text', () => {
  assert.equal(geistTracking(12), 0);
  assert.equal(geistTracking(14), 0);
  assert.ok(geistTracking(18) < 0 && geistTracking(18) > -0.006);
  assert.ok(geistTracking(32) < -0.019);
  assert.equal(geistTracking(72), -0.022);
});

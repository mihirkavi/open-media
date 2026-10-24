import assert from 'node:assert/strict';
import test from 'node:test';

import { interTracking } from './typeMetrics';

test('Inter tracking tightens large text and leaves small text open', () => {
  assert.ok(interTracking(12) > -0.001);
  assert.ok(interTracking(15) < 0 && interTracking(15) > -0.012);
  assert.ok(interTracking(32) < -0.02);
});

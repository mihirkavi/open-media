import assert from 'node:assert/strict';
import test from 'node:test';

import { connectorCatalog } from './catalog';
import { supports } from './types';

test('connector capabilities never infer missing operations', () => {
  const gmail = connectorCatalog.find((connector) => connector.id === 'gmail');
  assert.ok(gmail);
  assert.equal(supports(gmail, 'read-email'), false);
  assert.equal(supports(gmail, 'publish-post'), false);
});

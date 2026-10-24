import assert from 'node:assert/strict';
import test from 'node:test';

import { connectorCatalog } from '../connectors/catalog';
import { chatNetworks } from './chatNetworks';

test('every bridged network has a connector entry that never claims attachments', () => {
  for (const network of chatNetworks) {
    const connector = connectorCatalog.find((item) => item.id === network.id);
    assert.ok(connector, network.id);
    assert.equal(connector.displayName, network.name);
    assert.equal(connector.capabilities.find((capability) => capability.operation === 'attachments')?.available, false);
  }
});

test('connector ids are unique', () => {
  const ids = connectorCatalog.map((connector) => connector.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every network explains how to connect or why it cannot yet', () => {
  for (const network of chatNetworks) assert.ok(network.qr || network.code || network.input || network.cookies, network.id);
});

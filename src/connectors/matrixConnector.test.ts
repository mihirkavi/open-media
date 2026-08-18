import assert from 'node:assert/strict';
import test from 'node:test';

import { mapMatrixSnapshot } from './matrixConnector';

test('maps a Matrix room into the canonical people-first conversation model', () => {
  const conversations = mapMatrixSnapshot({
    userId: '@mihir:localhost',
    rooms: [{
      id: '!openmedia:localhost',
      name: 'Open Media Matrix Lab',
      members: [{ id: '@mihir:localhost', displayName: 'Mihir' }, { id: '@matrixbot:localhost', displayName: 'Matrix Guide' }],
      events: [
        { id: '$one', sender: '@matrixbot:localhost', body: 'This arrived through Matrix.', timestamp: 1000 },
        { id: '$two', sender: '@mihir:localhost', body: 'Open Media can reply.', timestamp: 2000 },
      ],
    }],
  });

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].participants[0].name, 'Matrix Guide');
  assert.deepEqual(conversations[0].sourceSummary, ['matrix']);
  assert.equal(conversations[0].messages[0].direction, 'inbound');
  assert.equal(conversations[0].messages[1].direction, 'outbound');
  assert.equal(conversations[0].preview, 'Open Media can reply.');
});

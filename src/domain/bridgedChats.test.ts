import assert from 'node:assert/strict';
import test from 'node:test';

import { bridgedSourceOf, mapBridgeSnapshot } from './bridgedChats';

const me = '@om_4493a42e416b41d0baeaaed2666f5225:openmedia.localhost';

test('bridged WhatsApp chats become people-first conversations', () => {
  const [chat] = mapBridgeSnapshot({
    userId: me,
    rooms: [{
      id: '!abc:openmedia.localhost',
      network: 'whatsapp',
      name: 'Ada',
      members: [{ id: '@whatsapp_15550001:openmedia.localhost', displayName: 'Ada' }],
      events: [
        { id: '$2', sender: me, body: 'See you then', timestamp: 2_000 },
        { id: '$1', sender: '@whatsapp_15550001:openmedia.localhost', body: 'Lunch tomorrow?', timestamp: 1_000 },
      ],
    }],
  });
  assert.equal(chat.participants[0].name, 'Ada');
  assert.deepEqual(chat.sourceSummary, ['whatsapp']);
  assert.deepEqual(chat.labels, ['WhatsApp']);
  assert.deepEqual(chat.messages.map((message) => [message.body, message.direction]), [['Lunch tomorrow?', 'inbound'], ['See you then', 'outbound']]);
  assert.equal(chat.preview, 'See you then');
  assert.equal(bridgedSourceOf(chat), 'whatsapp');
});

test('group chats keep their name and unknown networks are skipped', () => {
  const chats = mapBridgeSnapshot({
    userId: me,
    rooms: [
      { id: '!g:x', network: 'whatsapp', name: 'Family', members: [{ id: '@whatsapp_1:x', displayName: 'Mum' }, { id: '@whatsapp_2:x', displayName: 'Dad' }], events: [] },
      { id: '!u:x', network: 'carrier-pigeon', name: 'Nope', members: [{ id: '@p:x', displayName: 'P' }], events: [] },
    ],
  });
  assert.equal(chats.length, 1);
  assert.equal(chats[0].groupTitle, 'Family');
  assert.deepEqual(chats[0].labels, ['WhatsApp', 'Group']);
});

test('every bridged network gets its own label, including Google Voice and Messenger', () => {
  const chats = mapBridgeSnapshot({
    userId: me,
    rooms: [
      { id: '!v:x', network: 'gvoice', name: 'Pat', members: [{ id: '@gvoice_1:x', displayName: 'Pat' }], events: [{ id: '$1', sender: '@gvoice_1:x', body: 'Call me', timestamp: 2 }] },
      { id: '!f:x', network: 'messenger', name: 'Sam', members: [{ id: '@messenger_1:x', displayName: 'Sam' }], events: [{ id: '$2', sender: '@messenger_1:x', body: 'Hi', timestamp: 1 }] },
    ],
  });
  assert.deepEqual(chats.map((chat) => [chat.labels[0], bridgedSourceOf(chat)]), [['Google Voice', 'gvoice'], ['Messenger', 'messenger']]);
});

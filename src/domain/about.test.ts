import assert from 'node:assert/strict';
import test from 'node:test';

import { agentInterfaces, mission, principles, promises, roadmap } from './about';
import { settingIndex } from './settings';

test('the mission and principles match the Master Builder Prompt', () => {
  assert.match(mission, /^Build the open communication layer for humanity/);
  assert.ok(principles.includes('Applications are doorways. The human remains the constant.'));
  assert.deepEqual(promises.map((item) => item.title), ['Everything together', 'Your feed belongs to you', 'You are not locked in']);
  assert.equal(roadmap.length, 10);
});

test('every agent interface is documented once, with a description', () => {
  const all = [...agentInterfaces.discovery, ...agentInterfaces.public, ...agentInterfaces.account, ...agentInterfaces.mcp];
  for (const item of all) assert.ok(item.description.length > 10, item.path);
  const keys = all.map((item) => `${'method' in item ? item.method : ''} ${item.path}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('people can find the mission and the developer page from settings search', () => {
  assert.ok(settingIndex.some((entry) => entry.id === 'mission' && entry.route === 'about'));
  assert.ok(settingIndex.some((entry) => entry.id === 'developers' && entry.keywords.includes('mcp')));
});

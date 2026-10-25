import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { agentSkills, skillMarkdown } from './agentSkills';

test('the plugin ships exactly the skills the Worker serves', () => {
  for (const skill of agentSkills()) {
    const file = readFileSync(join(__dirname, '..', '..', 'agent-plugin', 'skills', skill.name, 'SKILL.md'), 'utf8');
    assert.equal(file, skillMarkdown(skill), `run npm run agent-plugin:sync (${skill.name})`);
    assert.match(file, /^---\nname: [a-z-]+\ndescription: ".+"\n---\n/);
  }
});

test('the three plugin manifests agree on name and version', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', 'agent-plugin', path), 'utf8')) as { name: string; version: string };
  const manifests = [read('plugin.json'), read('.claude-plugin/plugin.json'), read('.codex-plugin/plugin.json')];
  assert.deepEqual(new Set(manifests.map((item) => `${item.name}@${item.version}`)).size, 1);
});

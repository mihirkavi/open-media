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

test('the Claude and Codex manifests agree, and share one MCP config both can read', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', 'agent-plugin', path), 'utf8')) as { name: string; version: string };
  const manifests = [read('.claude-plugin/plugin.json'), read('.codex-plugin/plugin.json')] as { name: string; version: string; mcpServers?: unknown }[];
  assert.deepEqual(new Set(manifests.map((item) => `${item.name}@${item.version}`)).size, 1);
  assert.deepEqual(manifests.map((item) => item.mcpServers), ['./.mcp.json', './.mcp.json']);
  // Codex ignores .codex-plugin/plugin.json servers when a portable plugin.json sits at the root.
  assert.throws(() => read('plugin.json'));
  const servers = (read('.mcp.json') as unknown as { mcpServers: Record<string, { type: string; url: string; headers?: object; bearer_token_env_var?: string }> }).mcpServers;
  assert.ok(Object.values(servers).every((server) => server.type === 'http' && server.url.startsWith('https://')), 'Claude Code needs type http');
  assert.equal(servers['open-media-account'].bearer_token_env_var, 'OPEN_MEDIA_TOKEN', 'Codex reads the token from the environment');
});

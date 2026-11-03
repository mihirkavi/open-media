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

test('every marketplace manifest describes one plugin, with the same servers and no secrets (ADR 0027)', () => {
  const root = join(__dirname, '..', '..', 'agent-plugin');
  const text = (path: string) => readFileSync(join(root, path), 'utf8');
  const read = <T = Record<string, unknown>>(path: string) => JSON.parse(text(path)) as T;
  const manifests = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json', '.antigravity-plugin/plugin.json'].map((path) => [path, read<{ name: string; version: string }>(path)] as const);
  assert.equal(new Set(manifests.map(([, item]) => `${item.name}@${item.version}`)).size, 1, 'one name and version everywhere');

  // The same three servers in every format; the account is reached with OAuth, never a token in a file.
  const expected = { 'open-media': 'https://api.openmedia.site/open/mcp', 'open-media-docs': 'https://api.openmedia.site/docs/mcp', 'open-media-account': 'https://api.openmedia.site/account/mcp' };
  const urls = (servers: Record<string, { url?: string; serverUrl?: string }>) => Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, server.url ?? server.serverUrl]));
  assert.deepEqual(urls(read<{ mcpServers: Record<string, { url: string; type: string }> }>('.mcp.json').mcpServers), expected);
  assert.ok(Object.values(read<{ mcpServers: Record<string, { type: string }> }>('.mcp.json').mcpServers).every((server) => server.type === 'http'), 'Claude Code and Codex read type http');
  const portable = read<{ $schema: string; mcpServers: Record<string, Record<string, unknown>> }>('mcp.json');
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(urls(portable.mcpServers as never), expected);
  assert.ok(Object.values(portable.mcpServers).every((server) => server.type === 'streamable-http' && Object.keys(server).sort().join() === 'type,url'), 'portable servers carry only type and url');
  assert.deepEqual(urls(read<{ mcpServers: Record<string, { serverUrl: string }> }>('mcp_config.json').mcpServers), expected);
  for (const file of ['.mcp.json', 'mcp.json', 'mcp_config.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json']) {
    assert.doesNotMatch(text(file), /authorization|bearer|token_env|\$\{/i, `${file} holds no credential or placeholder`);
  }

  // agent-plugins.org: a closed schema, so only its own fields plus namespaced extensions.
  const standard = read<Record<string, unknown>>('plugin.json');
  assert.equal(standard.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.deepEqual(Object.keys(standard).filter((key) => !['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'].includes(key)), []);

  // Codex and ChatGPT directory limits.
  const codex = read<{ interface: Record<string, string | string[]> }>('.codex-plugin/plugin.json').interface;
  assert.ok(String(codex.displayName).length <= 30 && String(codex.shortDescription).length <= 30);
  assert.ok((codex.defaultPrompt as string[]).length <= 3 && (codex.defaultPrompt as string[]).every((prompt) => prompt.length <= 128));
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) assert.match(String(codex[key]), /^https:\/\//, key);
  assert.deepEqual(read<{ extensions: { 'com.openai': { interface: unknown } } }>('plugin.json').extensions['com.openai'].interface, codex, 'the portable manifest carries the same interface');

  // Square icons, as Codex and Antigravity require.
  for (const icon of ['assets/icon.png', 'assets/logo.png']) {
    const png = readFileSync(join(root, icon));
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), `${icon} is square`);
    assert.ok(png.readUInt32BE(16) >= 128, `${icon} is at least 128 px`);
  }

  // Claude Code slash commands each say what they do.
  for (const command of ['catch-up', 'inbox', 'feed', 'post', 'algorithm', 'follow']) assert.match(text(`commands/${command}.md`), /^---\ndescription: .+\n/, command);

  // MCP Registry entries, one per server, under the openmedia.site namespace.
  for (const [key, url] of Object.entries(expected)) {
    const entry = read<{ name: string; remotes: { type: string; url: string }[] }>(`registry/${key}.server.json`);
    assert.match(entry.name, /^site\.openmedia\//);
    assert.deepEqual(entry.remotes, [{ type: 'streamable-http', url }]);
  }
});

/**
 * Writes the agent plugin's skills (agent-plugin/skills/{name}/SKILL.md) from the one source the
 * Worker also serves: src/domain/agentSkills.ts. Run with `npm run agent-plugin:sync`; the app
 * tests fail if the files drift.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentSkills, skillMarkdown } from '../src/domain/agentSkills';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const skill of agentSkills()) {
  const folder = join(root, 'agent-plugin', 'skills', skill.name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), skillMarkdown(skill));
  console.log(`wrote agent-plugin/skills/${skill.name}/SKILL.md`);
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { Account, AgentEnv, assistantToolkit } from './agentApi.js';

// An account that records what the tools ask of it, and touches nothing.
function recordingAccount(calls: string[]) {
  return new Proxy({}, { get: (_target, name) => async (...args: unknown[]) => { calls.push(`${String(name)}:${JSON.stringify(args)}`); return { understood: ['Much less Hive'], changes: ['Now: Much less Hive'], manifest: { boosts: [] } }; } }) as unknown as Account;
}
const run = (kit: ReturnType<typeof assistantToolkit>, name: string, args: Record<string, unknown>) => (kit.tools[name] as { execute: (args: unknown, options: unknown) => Promise<unknown> }).execute(args, { toolCallId: 't', messages: [] });

test('Open Media AI gets reading and approved changes, never publishing, sending, paying, deleting or passwords', () => {
  const kit = assistantToolkit({} as AgentEnv, 'https://api.openmedia.site', recordingAccount([]), 'hi');
  const names = Object.keys(kit.tools);
  for (const wanted of ['about_open_media', 'find_setting', 'tune_feed_lens', 'follow_web_feed', 'set_my_privacy', 'change_app_setting', 'open_settings']) assert.ok(names.includes(wanted), wanted);
  for (const never of ['publish_post', 'send_message', 'send_email', 'delete_my_account', 'connect_mailbox', 'start_payment', 'delete_post', 'block_person', 'ask_ai']) assert.ok(!names.includes(never), never);
});

test('a change needs the model’s confirmed flag and the person’s own yes; until then only a preview runs', async () => {
  const calls: string[] = [];
  const asking = assistantToolkit({} as AgentEnv, 'https://api.openmedia.site', recordingAccount(calls), 'make my feed less hive');
  const answer = await run(asking, 'tune_feed_lens', { key: 'relevant', request: 'less hive', confirmed: true });
  assert.match(String(answer), /^Not changed yet\. Preview of the change: understood: Much less Hive/);
  assert.deepEqual(calls, ['tuneLens:[{"key":"relevant","request":"less hive","save":false}]'], 'only a preview, even though the model claimed confirmation');
  assert.deepEqual(asking.pending, { name: 'tune_feed_lens', args: { key: 'relevant', request: 'less hive' } });

  const approved = assistantToolkit({} as AgentEnv, 'https://api.openmedia.site', recordingAccount(calls), 'yes');
  await run(approved, 'tune_feed_lens', { key: 'relevant', request: 'less hive', confirmed: true });
  assert.equal(calls.at(-1), 'tuneLens:[{"key":"relevant","request":"less hive"}]');
  assert.deepEqual(approved.used, ['tune_feed_lens']);
  await assert.rejects(approved.run('delete_my_account', {}), /isn’t available/);
});

test('device settings and Settings sections become app actions, and odd values are refused', async () => {
  const kit = assistantToolkit({} as AgentEnv, 'https://api.openmedia.site', recordingAccount([]), 'dark mode please');
  await run(kit, 'change_app_setting', { setting: 'appearance', value: 'Dark' });
  await run(kit, 'open_settings', { section: 'email' });
  assert.match(String(await run(kit, 'change_app_setting', { setting: 'appearance', value: 'purple' })), /isn’t a value/);
  assert.deepEqual(kit.actions, [{ type: 'appearance', value: 'dark' }, { type: 'open', value: 'email' }]);
});

test('it can read the person’s own messages, email, chats and contacts, at most 40 emails at a time', async () => {
  const calls: string[] = [];
  const kit = assistantToolkit({} as AgentEnv, 'https://api.openmedia.site', recordingAccount(calls), 'catch me up');
  for (const wanted of ['list_conversations', 'list_email', 'list_bridged_chats', 'list_my_contacts', 'search', 'get_feed']) assert.ok(kit.tools[wanted], wanted);
  await run(kit, 'list_email', { limit: 500 });
  assert.equal(calls.at(-1), 'email:[40]');
  assert.deepEqual(kit.used, ['list_email']);
});

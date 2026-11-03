import assert from 'node:assert/strict';
import test from 'node:test';

import { Account, fullOpenApi, registeredTools, serverCard } from './agentApi.js';

const origin = 'https://api.test';

test('the server card lists exactly the tools each server registers', () => {
  const card = serverCard(origin) as { servers: { name: string; tools?: string[] }[] };
  const open = card.servers.find((server) => server.name === 'open-media');
  const account = card.servers.find((server) => server.name === 'open-media-account');
  assert.deepEqual(open?.tools, registeredTools('public'));
  assert.deepEqual(account?.tools, registeredTools('account'));
  for (const name of ['like_post', 'reshare_post', 'comment_on_post', 'get_post_comments', 'mark_conversation_read', 'set_read_receipts']) assert.ok(account?.tools?.includes(name), name);
  assert.equal(new Set([...registeredTools('public'), ...registeredTools('account')]).size, registeredTools('public').length + registeredTools('account').length, 'no tool is listed twice');
});

test('likes, reshares and comments are documented as account routes', () => {
  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { security?: unknown }>> };
  assert.ok(document.paths['/v1/me/posts/{id}/like'].put.security);
  assert.ok(document.paths['/v1/me/posts/{id}/reshare'].delete.security);
  assert.ok(document.paths['/v1/me/posts/{id}/comments'].post.security);
});

test('an agent is told plainly that other networks’ posts are answered from the app', async () => {
  const account = Object.create(Account.prototype) as Account;
  await assert.rejects(() => account.likePost('farcaster:0xabc', true), /from the person's own connected Farcaster account/);
  await assert.rejects(() => account.resharePost('lens-0x01-0x02', true), /from the person's own connected Lens account/);
  await assert.rejects(() => account.commentOnPost('open-media:not-a-post', 'hi'), /Post not found/);
  await assert.rejects(() => account.commentOnPost('6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11', '   '), /Write the comment first/);
});

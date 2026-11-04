import assert from 'node:assert/strict';
import test from 'node:test';

import { AiRecord, foundIn, looksLikeAsk, sendRecovering } from './aiChat';

test('questions and requests go to Open Media AI; names and keywords stay a search', () => {
  for (const ask of ['Catch me up', 'what does my conversation with Sam look like', 'set my theme to dark', 'any news about lens?', 'Summarize my inbox', 'show me what I missed today']) assert.equal(looksLikeAsk(ask), true, ask);
  for (const search of ['sam', 'ethereum on lens', 'videos about cooking today', 'dark mode', '#hive', '']) assert.equal(looksLikeAsk(search), false, search);
});

const record = (id: string, role: AiRecord['role'], clientId?: string): AiRecord => ({ id, role, body: id, source: 'chat', createdAt: '2026-11-03T00:00:00Z', ...(clientId ? { meta: { clientId } } : {}) });
const sentChat = [record('a', 'user', 'pending-1-aa'), record('b', 'assistant'), record('c', 'user', 'pending-2-bb'), record('d', 'assistant')];
const noWait = async () => undefined;

test('a message is found in the AI chat by its id, with the answer that followed it', () => {
  assert.deepEqual(foundIn(sentChat, 'pending-1-aa')?.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(foundIn(sentChat, 'pending-2-bb')?.map((item) => item.id), ['c', 'd']);
  assert.equal(foundIn(sentChat, 'pending-3-cc'), undefined);
});

test('an AI answer lost on the way back is found in the chat instead of the message showing as not sent', async () => {
  let loads = 0;
  const lost = async () => { throw new TypeError('Failed to fetch'); };
  const added = await sendRecovering(lost, 'pending-2-bb', async () => { loads += 1; return loads < 2 ? [] : sentChat; }, noWait);
  assert.deepEqual(added.map((item) => item.id), ['c', 'd']);
  assert.equal(loads, 2, 'it looks again while the answer is still being saved');

  // A refusal (4xx) is final and shown as it is, without looking.
  const refused = async () => { throw Object.assign(new Error('Too many AI messages'), { status: 429 }); };
  await assert.rejects(sendRecovering(refused, 'pending-2-bb', async () => sentChat, noWait), /Too many AI messages/);

  // Never saved: still not sent, so the person can try again.
  const failed = async () => { throw Object.assign(new Error('The AI didn’t answer. Try again.'), { status: 502 }); };
  await assert.rejects(sendRecovering(failed, 'pending-9-zz', async () => sentChat, noWait), /The AI didn’t answer/);
});

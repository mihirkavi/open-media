import assert from 'node:assert/strict';
import test from 'node:test';

import { relevantLens } from '../../../src/domain/feedLenses';
import { assistLens, checkModelLens } from './lensAssist';

const failingAi = { run: async () => { throw new Error('the model must not be called'); } };

test('Requests the rules fully understand never reach the model', async () => {
  const result = await assistLens({ request: 'only videos from people I follow, no crypto' }, { AI: failingAi });
  assert.equal(result.source, 'rules');
  assert.deepEqual(result.lens.filters.kinds, ['video']);
  assert.match(result.reply, /Only videos/);
});

test('A conversation changes the lens in use', async () => {
  const first = await assistLens({ request: 'only videos called Watch' }, {});
  const second = await assistLens({ request: 'also hide hive', base: first.lens }, {});
  assert.equal(second.lens.id, first.lens.id);
  assert.equal(second.lens.version, first.lens.version + 1);
  assert.deepEqual(second.lens.filters.hideSources, ['hive']);
  assert.match(second.reply, /^Updated “Watch”/);
  const fromRelevant = await assistLens({ request: 'also hide deso', base: 'relevant' }, {});
  assert.equal(fromRelevant.lens.name, 'My Relevant');
});

test('Words the rules cannot read go to the model, whose manifest is validated', async () => {
  const ai = { run: async () => ({ response: 'Here you go: {"name":"Calm","permissions":["interests"],"filters":{"mute":["politics","election"]},"order":"ranked","objectives":{"recency":0.7,"interests":0.3,"diversity":0.5},"interests":["gardening"],"reply":"Calm mutes politics and lifts gardening."}' }) };
  const result = await assistLens({ request: 'something soothing, gardening vibes, nothing political' }, { AI: ai });
  assert.equal(result.source, 'model');
  assert.equal(result.lens.name, 'Calm');
  assert.deepEqual(result.lens.filters.mute, ['politics', 'election']);
  assert.equal(result.reply, 'Calm mutes politics and lifts gardening.');
});

test('A model answer that asks for a forbidden signal or a built-in id is refused, and the rules answer stands', async () => {
  assert.equal(checkModelLens('{"name":"Spy","permissions":["private_messages"],"order":"ranked"}'), undefined);
  assert.equal(checkModelLens('{"name":"Close","filters":{"exactLocation":true}}'), undefined);
  assert.equal(checkModelLens('{"name":"Sneaky","objectives":{"follows":1}}'), undefined);
  assert.equal(checkModelLens('not json'), undefined);
  // The model can't overwrite a built-in by naming its id: ids come from the base, never the answer.
  assert.notEqual(checkModelLens('{"id":"relevant","name":"Relevant"}')?.lens.id, 'relevant');
  const ai = { run: async () => ({ response: '{"name":"Spy","permissions":["private_messages"]}' }) };
  const result = await assistLens({ request: 'something soothing please' }, { AI: ai });
  assert.equal(result.source, 'rules');
});

test('Empty requests and broken bases are explained', async () => {
  await assert.rejects(assistLens({ request: '  ' }, {}), /Describe the feed/);
  await assert.rejects(assistLens({ request: 'also hide hive', base: 'nonsense' }, {}), /base must be/);
  assert.equal((await assistLens({ request: 'also hide hive', base: { ...relevantLens } }, {})).lens.name, 'My Relevant');
});

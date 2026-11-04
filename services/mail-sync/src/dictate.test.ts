import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../../../src/domain/dictation';
import { dictationModel, readDictationAudio, transcribe } from './dictate.js';
import { handleMailRequest } from './mailHandler.js';

const wav = () => encodeWav(new Float32Array(16_000));
const body = () => wav().buffer as ArrayBuffer;

test('Whisper gets the WAV as base64 and its text comes back cleaned', async () => {
  let seen: { model?: string; input?: { audio?: string; vad_filter?: boolean } } = {};
  const env = { AI: { run: async (model: string, input: unknown) => { seen = { model, input: input as typeof seen.input }; return { text: '  Hello  world. ', transcription_info: { language: 'en' } }; } } };
  const bytes = wav();
  assert.deepEqual(await transcribe(bytes, env), { text: 'Hello world.', language: 'en' });
  assert.equal(seen.model, dictationModel);
  assert.equal(seen.input?.vad_filter, true);
  assert.equal(seen.input?.audio, Buffer.from(bytes).toString('base64'));
});

test('only WAV recordings of a sensible size are accepted', async () => {
  await assert.rejects(readDictationAudio(new Request('http://x/v1/dictate', { method: 'POST', body: new ArrayBuffer(200) })), /WAV/);
  await assert.rejects(readDictationAudio(new Request('http://x/v1/dictate', { method: 'POST', body: new ArrayBuffer(4_100_000) })), /too long/);
  assert.equal((await readDictationAudio(new Request('http://x/v1/dictate', { method: 'POST', body: body() }))).byteLength, 32_044);
});

test('/v1/dictate says whether it can transcribe, and transcribes without an account', async () => {
  const base = { CONVO_APP_ORIGIN: '*', SUPABASE_URL: 'http://db.test' } as never;
  const off = await handleMailRequest(new Request('http://x/v1/dictate'), base);
  assert.deepEqual(await off.json(), { available: false });
  const refused = await handleMailRequest(new Request('http://x/v1/dictate', { method: 'POST', body: body() }), base);
  assert.equal(refused.status, 503);
  const env = { ...(base as object), AI: { run: async () => ({ text: 'Testing one two.' }) } } as never;
  const on = await handleMailRequest(new Request('http://x/v1/dictate', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: body() }), env);
  assert.equal(on.status, 200);
  assert.equal(on.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await on.json(), { text: 'Testing one two.' });
});

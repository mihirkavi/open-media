import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanTranscript, dictationEligible, downsample, encodeWav, insertDictation, isWav, meteringLevel, speechLevel, tidyWav } from './dictation';

test('fields people write words in get the mic; codes, emails, passwords and handles do not', () => {
  assert.equal(dictationEligible({}), true);
  assert.equal(dictationEligible({ keyboardType: 'web-search' }), true);
  assert.equal(dictationEligible({ secureTextEntry: true }), false);
  assert.equal(dictationEligible({ keyboardType: 'email-address' }), false);
  assert.equal(dictationEligible({ keyboardType: 'number-pad', inputMode: 'numeric' }), false);
  assert.equal(dictationEligible({ autoComplete: 'one-time-code' }), false);
  assert.equal(dictationEligible({ textContentType: 'URL' }), false);
  assert.equal(dictationEligible({ autoCapitalize: 'none' }), false);
  assert.equal(dictationEligible({ editable: false }), false);
  assert.equal(dictationEligible({ autoCapitalize: 'none', dictation: true }), true);
  assert.equal(dictationEligible({ dictation: false }), false);
});

test('spoken text goes in at the cursor with the spacing typing would give', () => {
  assert.deepEqual(insertDictation('', 0, 0, 'Hello there.', { multiline: true }), { text: 'Hello there.', cursor: 12 });
  assert.deepEqual(insertDictation('Hi', 2, 2, 'How are you?', { multiline: true }), { text: 'Hi how are you?', cursor: 15 });
  assert.equal(insertDictation('Done. ', 6, 6, 'Next one.', { multiline: true }).text, 'Done. Next one.');
  assert.equal(insertDictation('see you', 3, 3, 'Then', { multiline: true }).text, 'see then you');
  assert.equal(insertDictation('replace THIS please', 8, 12, 'that', { multiline: true }).text, 'replace that please');
  // "I" stays a capital in the middle of a sentence.
  assert.equal(insertDictation('and', 3, 3, 'I think so.', { multiline: true }).text, 'and I think so.');
});

test('a one-sentence search loses its full stop; longer dictation keeps its punctuation', () => {
  assert.equal(insertDictation('', 0, 0, 'Coffee shops in Pune.').text, 'Coffee shops in Pune');
  assert.equal(insertDictation('', 0, 0, 'Hi. How are you?').text, 'Hi. How are you?');
  assert.equal(insertDictation('', 0, 0, 'Coffee shops in Pune.', { multiline: true }).text, 'Coffee shops in Pune.');
});

test('dictation respects the field’s maximum length', () => {
  assert.deepEqual(insertDictation('abc', 3, 3, 'Defghij', { maxLength: 6, multiline: true }), { text: 'abc de', cursor: 6 });
});

test('Whisper’s noise-only output is dropped', () => {
  assert.equal(cleanTranscript('  [BLANK_AUDIO] '), '');
  assert.equal(cleanTranscript(' ... '), '');
  assert.equal(cleanTranscript('  Hello   world '), 'Hello world');
});

test('recordings become 16 kHz mono 16-bit WAV files', () => {
  const second = new Float32Array(48_000).map((_, index) => Math.sin(index / 10));
  const small = downsample(second, 48_000);
  assert.equal(small.length, 16_000);
  const wav = encodeWav(small);
  assert.equal(wav.byteLength, 44 + 32_000);
  assert.ok(isWav(wav));
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(isWav(new Uint8Array(100)), false);
});

test('the level meter is quiet for silence and full for loud speech', () => {
  assert.equal(speechLevel(new Float32Array(512)), 0);
  assert.equal(speechLevel(new Float32Array(512).fill(0.5)), 1);
});

test('a phone WAV with padding chunks becomes a plain WAV', () => {
  const plain = encodeWav(new Float32Array(1_600).fill(0.25));
  const samples = plain.subarray(44);
  // RIFF, WAVE, fmt (16), FLLR padding (odd size), then data: the shape iOS writes.
  const padding = 7;
  const phone = new Uint8Array(12 + 24 + 8 + padding + 1 + 8 + samples.length);
  const view = new DataView(phone.buffer);
  const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) phone[offset + index] = text.charCodeAt(index); };
  ascii(0, 'RIFF'); view.setUint32(4, phone.length - 8, true); ascii(8, 'WAVE');
  phone.set(plain.subarray(12, 36), 12);
  ascii(36, 'FLLR'); view.setUint32(40, padding, true);
  const dataAt = 44 + padding + 1;
  ascii(dataAt, 'data'); view.setUint32(dataAt + 4, samples.length, true);
  phone.set(samples, dataAt + 8);
  assert.deepEqual(tidyWav(phone), plain);
  assert.deepEqual(tidyWav(plain), plain);
  assert.equal(tidyWav(new Uint8Array(100)), undefined);
});

test('metering decibels become a 0 to 1 level', () => {
  assert.equal(meteringLevel(undefined), 0);
  assert.equal(meteringLevel(-160), 0);
  assert.equal(meteringLevel(0), 1);
  assert.ok(meteringLevel(-30) > 0.4 && meteringLevel(-30) < 0.7);
});

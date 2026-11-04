/**
 * Dictation (ADR 0031): speak instead of typing in any text field. This module is the part that
 * doesn't touch a microphone: which fields get the mic, how spoken text joins what is already
 * typed, and the small 16 kHz WAV files sent to the Worker's Whisper model.
 */

/** Longest single dictation. Whisper handles more, but a long take is easier to lose. */
export const maxDictationSeconds = 120;
/** Whisper's native rate: smaller uploads, and nothing is lost for speech. */
export const dictationSampleRate = 16_000;
/** 16-bit mono at 16 kHz for the longest take, plus the WAV header and some slack. */
export const maxDictationBytes = 4_000_000;

/** The props of a text field that decide whether speaking into it makes sense. */
export interface DictationFieldProps {
  dictation?: boolean;
  secureTextEntry?: boolean;
  editable?: boolean;
  readOnly?: boolean;
  keyboardType?: string;
  inputMode?: string;
  autoComplete?: string;
  textContentType?: string;
  autoCapitalize?: string;
}

const spokenKeyboards = new Set(['default', 'web-search', 'ascii-capable', 'twitter']);
const typedOnlyAutoComplete = /^(one-time-code|email|password|new-password|current-password|tel|url|username|cc-|postal-code|sms-otp|birthdate)/;
const typedOnlyContent = new Set(['oneTimeCode', 'password', 'newPassword', 'emailAddress', 'URL', 'telephoneNumber', 'username', 'creditCardNumber', 'postalCode']);

/**
 * Every field people write words in gets the mic. Fields for things nobody says aloud (passwords,
 * codes, email addresses, numbers, links, handles and keys, which turn off capitalisation) don't.
 * `dictation` overrides the guess either way.
 */
export function dictationEligible(props: DictationFieldProps): boolean {
  if (props.dictation !== undefined) return props.dictation;
  if (props.secureTextEntry || props.editable === false || props.readOnly) return false;
  if (props.keyboardType && !spokenKeyboards.has(props.keyboardType)) return false;
  if (props.inputMode && props.inputMode !== 'text' && props.inputMode !== 'search') return false;
  if (props.autoComplete && typedOnlyAutoComplete.test(props.autoComplete)) return false;
  if (props.textContentType && typedOnlyContent.has(props.textContentType)) return false;
  if (props.autoCapitalize === 'none') return false;
  return true;
}

/** Whisper's usual output for silence or noise; never worth inserting. */
const noiseOnly = /^[\s.,!?…-]*$|^\[?(blank_audio|music|silence|inaudible)\]?$|^\(?(music|silence)\)?$/i;

export function cleanTranscript(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  return noiseOnly.test(text) ? '' : text;
}

/**
 * Puts spoken text where the cursor is (replacing any selection) the way a person would have
 * typed it: a space where one is needed, a lowercase start in the middle of a sentence, and no
 * full stop at the end of a one-sentence search or title.
 */
export function insertDictation(current: string, selectionStart: number, selectionEnd: number, transcript: string, options: { multiline?: boolean; maxLength?: number } = {}): { text: string; cursor: number } {
  const start = clamp(selectionStart, 0, current.length);
  const end = clamp(Math.max(selectionEnd, start), start, current.length);
  let spoken = cleanTranscript(transcript);
  if (!spoken) return { text: current, cursor: end };
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lastChar = before.trimEnd().slice(-1);
  const midSentence = before.trim().length > 0 && !/[.!?…:\n]/.test(lastChar);
  // "I", "I'm" and acronyms keep their capitals; other words follow the sentence they join.
  if (midSentence && /^[A-Z][a-z]/.test(spoken) && !/^I\b|^I['’]/.test(spoken)) spoken = spoken[0].toLowerCase() + spoken.slice(1);
  if (!options.multiline && !/[.!?…].+[.!?…]?$/.test(spoken.slice(0, -1))) spoken = spoken.replace(/\.$/, '');
  if (after && /^[\w(“"'‘]/.test(after) && !/[\s(“"'‘-]$/.test(spoken)) spoken += ' ';
  if (before && !/\s$/.test(before) && !/^[.,!?;:…)”’]/.test(spoken)) spoken = ' ' + spoken;
  if (options.maxLength !== undefined && options.maxLength >= 0) {
    const room = Math.max(0, options.maxLength - before.length - after.length);
    spoken = spoken.slice(0, room);
  }
  return { text: before + spoken + after, cursor: before.length + spoken.length };
}

function clamp(value: number, low: number, high: number) {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : high;
}

/** Averages the samples of each output step, so downsampling doesn't alias speech into hiss. */
export function downsample(samples: Float32Array, fromRate: number, toRate = dictationSampleRate): Float32Array {
  if (fromRate <= toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < out.length; index += 1) {
    const from = Math.floor(index * ratio);
    const to = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = from; at < to; at += 1) sum += samples[at];
    out[index] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/** A 16-bit PCM mono WAV file: the one format every speech model reads. */
export function encodeWav(samples: Float32Array, sampleRate = dictationSampleRate): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

/** True for the RIFF/WAVE files `encodeWav` writes. */
export function isWav(bytes: Uint8Array): boolean {
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  return bytes.length > 44 && tag(0) === 'RIFF' && tag(8) === 'WAVE';
}

/** Loudness of one block of samples, 0–1, shaped so normal speech fills the meter. */
export function speechLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.sqrt(rms) * 2.2);
}

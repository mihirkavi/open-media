/**
 * Dictation (ADR 0031): a short WAV recording from the app's mic button becomes text with
 * Whisper large-v3-turbo on Cloudflare Workers AI, the open-source speech model that Handy and
 * most dictation apps are built on. The audio and the text are transcribed in memory and never
 * stored, cached or logged.
 */
import { cleanTranscript, isWav, maxDictationBytes } from '../../../src/domain/dictation';
import { UserFacingError } from './errors.js';
import { AiBinding } from './searchAssist.js';

export const dictationModel = '@cf/openai/whisper-large-v3-turbo';

export interface DictateEnv { AI?: AiBinding }

/** Reads the request's audio, refusing anything that isn't a WAV of a sensible size. */
export async function readDictationAudio(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxDictationBytes) throw new UserFacingError('That recording is too long. Keep each take under two minutes.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxDictationBytes) throw new UserFacingError('That recording is too long. Keep each take under two minutes.');
  if (!isWav(bytes)) throw new UserFacingError('Send the recording as a WAV file (audio/wav).');
  return bytes;
}

export async function transcribe(bytes: Uint8Array, env: DictateEnv): Promise<{ text: string; language?: string }> {
  if (!env.AI) throw new UserFacingError('Dictation isn’t available on this server.');
  const result = await env.AI.run(dictationModel, {
    audio: toBase64(bytes),
    task: 'transcribe',
    // Skips silence, which is where Whisper otherwise invents words ("Thank you.").
    vad_filter: true,
  }) as { text?: unknown; transcription_info?: { language?: unknown } };
  const language = typeof result?.transcription_info?.language === 'string' ? result.transcription_info.language : undefined;
  return { text: cleanTranscript(typeof result?.text === 'string' ? result.text : ''), ...(language ? { language } : {}) };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

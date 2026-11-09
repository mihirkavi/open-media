import { AudioModule, AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { getAPIAccessToken } from '../auth/supabase';
import { getAPIURL } from '../connectors/mailApiConnector';
import { cleanTranscript, dictationSampleRate, maxDictationBytes, maxDictationSeconds, meteringLevel, tidyWav } from '../domain/dictation';
import type { DictationCallbacks, DictationSession } from './dictationService';

/**
 * Dictation in the iPhone app (ADR 0031, phones). The phone records 16 kHz mono 16-bit WAV with
 * expo-audio and sends it to the same Worker route the web uses (`/v1/dictate`, Whisper), which
 * keeps nothing. Android's recorder can't write WAV, so the mic stays on iOS for now and Android
 * keeps its keyboard's own dictation.
 */

export class DictationError extends Error {}

/** True where the phone can record a WAV take. */
export function dictationSupported(): boolean {
  return Platform.OS === 'ios';
}

let available: Promise<boolean> | undefined;
/** Asked once per launch: does the server have a speech model? */
function serverCanTranscribe(): Promise<boolean> {
  available ??= fetch(`${getAPIURL()}/v1/dictate`, { method: 'GET' })
    .then(async (response) => response.ok && Boolean(((await response.json().catch(() => ({}))) as { available?: boolean }).available))
    .catch(() => { available = undefined; return false; });
  return available;
}

type Recorder = InstanceType<typeof AudioModule.AudioRecorder>;

const recording = {
  extension: '.wav',
  sampleRate: dictationSampleRate,
  numberOfChannels: 1,
  bitRate: dictationSampleRate * 16,
  isMeteringEnabled: true,
  outputFormat: IOSOutputFormat.LINEARPCM,
  audioQuality: AudioQuality.HIGH,
  linearPCMBitDepth: 16,
  linearPCMIsBigEndian: false,
  linearPCMIsFloat: false,
};

export async function startDictation(callbacks: DictationCallbacks): Promise<DictationSession> {
  if (!dictationSupported()) throw new DictationError('Use your keyboard’s mic to dictate on this phone.');
  if (!(await serverCanTranscribe())) throw new DictationError('Dictation isn’t available right now. Try your keyboard’s mic.');
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) throw new DictationError('Allow the microphone for Open Media in Settings to dictate.');
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

  let recorder: Recorder | undefined;
  try {
    recorder = new AudioModule.AudioRecorder(recording);
    // The system can stall here when no input is available (a Simulator without the Mac's mic).
    await withTimeout(recorder.prepareToRecordAsync(), 6000);
    recorder.record();
  } catch (error) {
    // After a stall the recorder is still busy inside the system: releasing it now would block
    // this thread, so it is left for the system to drop once preparing gives up.
    if (!(error instanceof PrepareTimeout)) { try { recorder?.release(); } catch { /* never created */ } }
    void restoreAudio();
    throw new DictationError('The microphone couldn’t start.');
  }

  const active = recorder;
  let loudest = 0;
  let limited = false;
  const startedAt = Date.now();
  const meter = setInterval(() => {
    const level = meteringLevel(active.getStatus().metering);
    loudest = Math.max(loudest, level);
    callbacks.onLevel(level);
    if (!limited && Date.now() - startedAt >= maxDictationSeconds * 1000) { limited = true; callbacks.onLimit(); }
  }, 50);

  let done = false;
  const halt = async (): Promise<string | null> => {
    if (done) return null;
    done = true;
    clearInterval(meter);
    try { await active.stop(); } catch { /* already stopped */ }
    const uri = active.uri;
    active.release();
    await restoreAudio();
    return uri;
  };

  return {
    cancel() { void halt().then((uri) => { if (uri) remove(uri); }); },
    async stop() {
      const seconds = (Date.now() - startedAt) / 1000;
      const uri = await halt();
      if (!uri) return '';
      try {
        // Under a third of a second, or never louder than room noise: nothing was said.
        if (seconds < 1 / 3 || loudest < 0.12) return '';
        const wav = tidyWav(await new File(uri).bytes());
        if (!wav) throw new DictationError('The recording couldn’t be read. Try again.');
        if (wav.byteLength > maxDictationBytes) throw new DictationError('That recording is too long. Keep each take under two minutes.');
        return await transcribe(wav);
      } finally {
        remove(uri);
      }
    },
  };
}

async function transcribe(wav: Uint8Array): Promise<string> {
  const token = await getAPIAccessToken().catch(() => undefined);
  let response: Response;
  try {
    response = await fetch(`${getAPIURL()}/v1/dictate`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer,
    });
  } catch {
    throw new DictationError('Couldn’t reach Open Media to transcribe. Check your connection.');
  }
  const payload = await response.json().catch(() => ({})) as { text?: string; error?: string };
  if (response.status === 503) available = undefined;
  if (response.status === 429) throw new DictationError('That’s a lot of dictation. Try again in a minute.');
  if (!response.ok) throw new DictationError(payload.error ?? 'Transcription failed. Try again.');
  return cleanTranscript(payload.text ?? '');
}

class PrepareTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PrepareTimeout()), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Hands the audio session back so videos play normally again. */
function restoreAudio(): Promise<void> {
  return setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
}

function remove(uri: string) {
  try { new File(uri).delete(); } catch { /* the system clears its caches anyway */ }
}

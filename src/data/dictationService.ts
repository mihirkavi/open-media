import { getAPIAccessToken } from '../auth/supabase';
import { getAPIURL } from '../connectors/mailApiConnector';
import { cleanTranscript, downsample, encodeWav, maxDictationSeconds, speechLevel } from '../domain/dictation';

/**
 * Dictation on the web (ADR 0031). The microphone is recorded in the page, turned into a small
 * 16 kHz WAV and sent to the Worker, which transcribes it with Whisper (the open-source model
 * Handy and most dictation apps use) and keeps nothing. Where the server has no speech model, the
 * browser's own speech recognition is used instead. Loaded only when someone presses a mic.
 */

export interface DictationSession {
  /** Stops listening and resolves with what was said ('' for nothing). */
  stop(): Promise<string>;
  /** Stops listening and throws the recording away. */
  cancel(): void;
}

export interface DictationCallbacks {
  /** Loudness 0–1, about 20 times a second, for the button's meter. */
  onLevel(level: number): void;
  /** The take reached its time limit and stopped by itself. */
  onLimit(): void;
}

type Engine = 'whisper' | 'browser' | 'none';
let engine: Promise<Engine> | undefined;

interface BrowserRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}

function browserRecognition(): (new () => BrowserRecognition) | undefined {
  const scope = globalThis as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** True when this browser can record at all; the mic is hidden otherwise. */
export function dictationSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean(navigator.mediaDevices?.getUserMedia) || Boolean(browserRecognition());
}

/** Asked once per session: does the server have a speech model? */
function chooseEngine(): Promise<Engine> {
  engine ??= (async () => {
    const recordable = Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== 'undefined';
    if (recordable) {
      try {
        const response = await fetch(`${getAPIURL()}/v1/dictate`, { method: 'GET' });
        const status = await response.json().catch(() => ({})) as { available?: boolean };
        if (response.ok && status.available) return 'whisper';
      } catch { /* No server here; try the browser's own engine. */ }
    }
    return browserRecognition() ? 'browser' : 'none';
  })();
  return engine;
}

export class DictationError extends Error {}

export async function startDictation(callbacks: DictationCallbacks): Promise<DictationSession> {
  const chosen = await chooseEngine();
  if (chosen === 'none') throw new DictationError('Dictation isn’t available in this browser.');
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new DictationError('Allow the microphone for this site to dictate.');
    if (name === 'NotFoundError') throw new DictationError('No microphone found.');
    if (chosen === 'whisper') throw new DictationError('The microphone couldn’t start.');
  }
  const capture = stream ? record(stream, callbacks) : undefined;
  return chosen === 'whisper' && capture ? whisperSession(capture) : browserSession(capture, callbacks);
}

interface Capture { finish(): { samples: Float32Array; rate: number; loud: boolean }; release(): void }

/** Raw samples straight from the microphone, plus the level meter. */
function record(stream: MediaStream, callbacks: DictationCallbacks): Capture {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but runs everywhere without a separate worklet file.
  const processor = context.createScriptProcessor(2048, 1, 1);
  const chunks: Float32Array[] = [];
  let length = 0;
  let loudest = 0;
  const limit = maxDictationSeconds * context.sampleRate;
  let limited = false;
  processor.onaudioprocess = (event) => {
    const block = new Float32Array(event.inputBuffer.getChannelData(0));
    const level = speechLevel(block);
    loudest = Math.max(loudest, level);
    callbacks.onLevel(level);
    if (length >= limit) {
      if (!limited) { limited = true; callbacks.onLimit(); }
      return;
    }
    chunks.push(block);
    length += block.length;
  };
  source.connect(processor);
  processor.connect(context.destination);
  context.resume().catch(() => undefined);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    processor.onaudioprocess = null;
    try { source.disconnect(); processor.disconnect(); } catch { /* already gone */ }
    stream.getTracks().forEach((track) => track.stop());
    context.close().catch(() => undefined);
  };
  return {
    release,
    finish() {
      release();
      const samples = new Float32Array(length);
      let at = 0;
      for (const chunk of chunks) { samples.set(chunk, at); at += chunk.length; }
      return { samples, rate: context.sampleRate, loud: loudest > 0.12 };
    },
  };
}

function whisperSession(capture: Capture): DictationSession {
  return {
    cancel: () => capture.release(),
    async stop() {
      const { samples, rate, loud } = capture.finish();
      // Under a third of a second, or never louder than room noise: nothing was said.
      if (!loud || samples.length < rate / 3) return '';
      const wav = encodeWav(downsample(samples, rate));
      const token = await getAPIAccessToken().catch(() => undefined);
      let response: Response;
      try {
        response = await fetch(`${getAPIURL()}/v1/dictate`, {
          method: 'POST',
          headers: { 'content-type': 'audio/wav', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: wav as unknown as BodyInit,
        });
      } catch {
        throw new DictationError('Couldn’t reach Open Media to transcribe. Check your connection.');
      }
      const payload = await response.json().catch(() => ({})) as { text?: string; error?: string };
      if (response.status === 503) engine = undefined;
      if (response.status === 429) throw new DictationError('That’s a lot of dictation. Try again in a minute.');
      if (!response.ok) throw new DictationError(payload.error ?? 'Transcription failed. Try again.');
      return cleanTranscript(payload.text ?? '');
    },
  };
}

/** The browser's speech engine. The capture, when there is one, only drives the level meter. */
function browserSession(capture: Capture | undefined, callbacks: DictationCallbacks): DictationSession {
  const Recognition = browserRecognition();
  if (!Recognition) { capture?.release(); throw new DictationError('Dictation isn’t available in this browser.'); }
  const recognition = new Recognition();
  recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  recognition.continuous = true;
  recognition.interimResults = false;
  const finals: string[] = [];
  let failure: string | undefined;
  let ended = false;
  let finished: (() => void) | undefined;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) finals.push(event.results[index][0].transcript);
    }
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') failure = 'Allow the microphone for this site to dictate.';
    else if (event.error === 'network') failure = 'Your browser’s speech service couldn’t be reached.';
    else if (event.error !== 'no-speech' && event.error !== 'aborted') failure = 'Dictation stopped unexpectedly.';
  };
  recognition.onend = () => { ended = true; finished?.(); };
  recognition.start();
  const limit = setTimeout(() => callbacks.onLimit(), maxDictationSeconds * 1000);
  return {
    cancel() { clearTimeout(limit); capture?.release(); recognition.abort(); },
    async stop() {
      clearTimeout(limit);
      capture?.release();
      if (!ended) {
        await new Promise<void>((resolve) => {
          finished = resolve;
          recognition.stop();
          setTimeout(resolve, 4000);
        });
      }
      if (failure) throw new DictationError(failure);
      const text = cleanTranscript(finals.join(' '));
      // The browser's engine leaves sentences bare; give the first one a capital.
      return text ? text[0].toUpperCase() + text.slice(1) : '';
    },
  };
}

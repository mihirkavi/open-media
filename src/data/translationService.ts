import AsyncStorage from '@react-native-async-storage/async-storage';

import { getAPIURL, request } from '../connectors/mailApiConnector';
import {
  defaultTranslationPreferences, deviceTranslationKey, maxTranslationItems, normalizeForTranslation, parseTranslationPreferences,
  TranslatedItem, TranslationPreferences,
} from '../domain/translation';

/**
 * Automatic translation (ADR 0022). Items the device found to be in another language are
 * collected for a moment and sent to the Worker together. Public text may be cached by the
 * Worker; private text (messages, email) is sent with the person's session and `private: true`,
 * so it is never stored there. Translations are kept in memory on this device only.
 */

export type TranslationPrivacy = 'public' | 'private';

const storageKey = 'open-media.translation.v1';
let preferences: TranslationPreferences = defaultTranslationPreferences;
let loaded = false;
const listeners = new Set<() => void>();

export function translationPreferences(): TranslationPreferences {
  return preferences;
}

export function subscribeTranslationPreferences(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    AsyncStorage.getItem(storageKey).then((stored) => {
      if (!stored) return;
      preferences = parseTranslationPreferences(JSON.parse(stored));
      listeners.forEach((notify) => notify());
    }).catch(() => undefined);
  }
  return () => { listeners.delete(listener); };
}

export function setTranslationPreferences(next: Partial<TranslationPreferences>) {
  preferences = parseTranslationPreferences({ ...preferences, ...next });
  AsyncStorage.setItem(storageKey, JSON.stringify(preferences)).catch(() => undefined);
  listeners.forEach((notify) => notify());
}

interface Pending { id: string; text: string; source: string; resolve: (item: TranslatedItem | undefined) => void }

const results = new Map<string, Promise<TranslatedItem | undefined>>();
const queues: Record<TranslationPrivacy, Pending[]> = { public: [], private: [] };
const timers: Partial<Record<TranslationPrivacy, ReturnType<typeof setTimeout>>> = {};
/** Set when the server says it has no translation engine, so the app stops asking this session. */
let unavailable = false;
const batchDelayMs = 40;

/** The translation of one item, or undefined when it can't be translated now. */
export function translateText(text: string, source: string, target: string, privacy: TranslationPrivacy): Promise<TranslatedItem | undefined> {
  const normalized = normalizeForTranslation(text);
  const key = `${privacy}:${deviceTranslationKey(normalized, source, target)}`;
  const known = results.get(key);
  if (known) return known;
  if (unavailable || !normalized) return Promise.resolve(undefined);
  const promise = new Promise<TranslatedItem | undefined>((resolve) => {
    queues[privacy].push({ id: key, text: normalized, source, resolve });
    if (queues[privacy].length >= maxTranslationItems) flush(privacy, target);
    else timers[privacy] ??= setTimeout(() => flush(privacy, target), batchDelayMs);
  });
  results.set(key, promise);
  return promise;
}

function flush(privacy: TranslationPrivacy, target: string) {
  clearTimeout(timers[privacy]);
  delete timers[privacy];
  while (queues[privacy].length) send(queues[privacy].splice(0, maxTranslationItems), privacy, target);
}

async function send(batch: Pending[], privacy: TranslationPrivacy, target: string) {
  const body = { items: batch.map(({ id, text, source }) => ({ id, text, source })), target, ...(privacy === 'private' ? { private: true } : {}) };
  try {
    const payload = privacy === 'private'
      ? await request<TranslateResponse>('/v1/translate', { method: 'POST', body }, 'Translation failed.')
      : await publicTranslate(body);
    const byId = new Map(payload.translations.map((item) => [item.id, item]));
    for (const item of batch) {
      const found = byId.get(item.id);
      // The device's own detection names the language unless the server could tell more precisely.
      item.resolve(found?.translated ? { text: found.text, source: found.source === 'und' ? item.source : found.source, target: found.target } : undefined);
    }
  } catch (error) {
    if (error instanceof Unavailable || (error instanceof Error && error.message.includes('isn’t available'))) unavailable = true;
    // Failed items may be tried again the next time they are shown.
    for (const item of batch) { results.delete(item.id); item.resolve(undefined); }
  }
}

interface TranslateResponse { translations: Array<{ id: string; text: string; source: string; target: string; translated: boolean }> }

class Unavailable extends Error {}

async function publicTranslate(body: unknown): Promise<TranslateResponse> {
  const response = await fetch(`${getAPIURL()}/v1/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 503) throw new Unavailable();
  if (!response.ok) throw new Error('Translation failed.');
  return await response.json() as TranslateResponse;
}

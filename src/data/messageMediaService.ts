/**
 * The message media picker's network and device state (ADR 0029): GIF and animated sticker search
 * through the Open Media server (which holds the GIPHY key), and the picker's small preferences
 * (recent emoji, skin tone, avatar look), which stay on this device.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAPIURL } from "../connectors/mailApiConnector";
import { GifResult, SkinTone, newAvatarSeed } from "../domain/messageMedia";

export class GifsUnavailable extends Error {}

export async function searchGifs(query: string, kind: "gifs" | "stickers", offset = 0, signal?: AbortSignal): Promise<GifResult[]> {
  const params = new URLSearchParams({ q: query.trim(), offset: String(offset) });
  if (kind === "stickers") params.set("kind", "stickers");
  const response = await fetch(`${getAPIURL()}/v1/media/gifs?${params}`, { signal });
  if (response.status === 503) throw new GifsUnavailable();
  if (!response.ok) throw new Error("GIFs couldn’t load.");
  return ((await response.json()) as { gifs: GifResult[] }).gifs;
}

export interface MediaPreferences { recentEmoji: string[]; skinTone: SkinTone; avatarSeed: string }

const storageKey = "open-media:message-media:v1";
const maxRecent = 32;

export async function loadMediaPreferences(): Promise<MediaPreferences> {
  const fallback: MediaPreferences = { recentEmoji: [], skinTone: 0, avatarSeed: newAvatarSeed() };
  try {
    const stored = JSON.parse((await AsyncStorage.getItem(storageKey)) ?? "null") as Partial<MediaPreferences> | null;
    const preferences: MediaPreferences = {
      recentEmoji: Array.isArray(stored?.recentEmoji) ? stored.recentEmoji.filter((item): item is string => typeof item === "string").slice(0, maxRecent) : [],
      skinTone: [0, 1, 2, 3, 4, 5].includes(stored?.skinTone as number) ? (stored!.skinTone as SkinTone) : 0,
      avatarSeed: typeof stored?.avatarSeed === "string" && /^[a-z0-9]{6,24}$/.test(stored.avatarSeed) ? stored.avatarSeed : fallback.avatarSeed,
    };
    // The first look is kept from the start, so it stays the same tomorrow.
    if (!stored?.avatarSeed) await saveMediaPreferences(preferences);
    return preferences;
  } catch {
    return fallback;
  }
}

export async function saveMediaPreferences(preferences: MediaPreferences): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(preferences)).catch(() => undefined);
}

export function withRecentEmoji(recent: string[], emoji: string): string[] {
  return [emoji, ...recent.filter((item) => item !== emoji)].slice(0, maxRecent);
}

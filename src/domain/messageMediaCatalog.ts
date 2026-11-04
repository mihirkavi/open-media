/**
 * The emoji and sticker catalogs behind the media picker (ADR 0029), kept apart from
 * messageMedia.ts because they are large (about 320 KB of JSON). Only the picker imports this
 * module, and the picker is loaded on demand, so opening the app or a conversation never pays for it.
 */
import emojiCatalogData from "./emojiCatalog.json";
import stickerCatalogData from "./stickerCatalog.json";
import { EmojiGroup, EmojiRow, StickerCategory, StickerRow, words } from "./messageMedia";

export const emojiGroups: EmojiGroup[] = (emojiCatalogData as unknown as { groups: EmojiGroup[] }).groups;

/** Every typed word must start a word of the emoji's name or keywords ("hea" finds hearts). */
export function searchEmoji(query: string, limit = 120): EmojiRow[] {
  const wanted = words(query);
  if (!wanted.length) return [];
  const results: Array<{ row: EmojiRow; score: number }> = [];
  for (const group of emojiGroups) {
    for (const row of group.emoji) {
      const name = words(row[1]);
      const keywords = words(row[2]);
      if (!wanted.every((word) => name.some((part) => part.startsWith(word)) || keywords.some((part) => part.startsWith(word)))) continue;
      // Names before keywords, and exact names first.
      const score = (row[1].toLowerCase() === query.trim().toLowerCase() ? 0 : 2) + (wanted.every((word) => name.some((part) => part.startsWith(word))) ? 0 : 1);
      results.push({ row, score });
    }
  }
  return results.sort((a, b) => a.score - b.score).slice(0, limit).map((item) => item.row);
}

export const stickerCategories: StickerCategory[] = (stickerCatalogData as unknown as { categories: StickerCategory[] }).categories;

export function searchStickers(query: string, limit = 90): StickerRow[] {
  const wanted = words(query);
  if (!wanted.length) return [];
  return stickerCategories.flatMap((category) => category.stickers)
    .filter((row) => { const own = words(row[1]); return wanted.every((word) => own.some((part) => part.startsWith(word))); })
    .slice(0, limit);
}

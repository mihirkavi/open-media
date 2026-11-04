/**
 * Builds the catalogs behind the message media picker (ADR 0029) from their open sources:
 *
 * - Emoji: Emojibase (MIT) — names, search keywords, groups and skin tones for Unicode emoji.
 *   Only emoji up to `maxEmojiVersion` are kept, so every one draws in today's system fonts.
 * - Stickers: Microsoft's Fluent Emoji (MIT) in its 3D style — 256 px PNGs (about 40 KB each),
 *   served by jsDelivr from a pinned commit of github.com/microsoft/fluentui-emoji. Google's Noto
 *   Animated Emoji were considered, but they exist only at 512 px (0.6–1.2 MB each).
 *
 * Run `npm run media:catalogs` to refresh. The output is committed, so the app needs no network
 * call to open the picker. Paths resolve from this file, never from the caller's directory.
 */
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const emojibaseVersion = "18.0.0";
const maxEmojiVersion = 15.1;
/** Pinned so a sticker URL sent today still loads in years. */
export const fluentCommit = "1ffb34c752ecf5d402f04cfb4b392c77f57c54bc";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface EmojibaseSkin { emoji: string; tone?: number | number[] }
interface EmojibaseEmoji { emoji: string; label: string; group?: number; order?: number; version: number; tags?: string[]; skins?: EmojibaseSkin[] }

const groupNames: Record<number, string> = {
  0: "Smileys",
  1: "People",
  3: "Animals & nature",
  4: "Food & drink",
  5: "Travel & places",
  6: "Activities",
  7: "Objects",
  8: "Symbols",
  9: "Flags",
};

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json() as Promise<T>;
}

function emojibase() {
  return json<EmojibaseEmoji[]>(`https://cdn.jsdelivr.net/npm/emojibase-data@${emojibaseVersion}/en/data.json`);
}

function usable(data: EmojibaseEmoji[]) {
  return data.filter((entry) => entry.group !== undefined && entry.group !== 2 && entry.version <= maxEmojiVersion).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function emoji(data: EmojibaseEmoji[]) {
  const groups = new Map<number, Array<[string, string, string] | [string, string, string, string[]]>>();
  for (const item of usable(data)) {
    const tags = (item.tags ?? []).filter((tag) => !item.label.includes(tag)).join(" ");
    // Skin tones only where one tone applies to the whole emoji (not mixed-tone couples).
    const skins = item.skins?.filter((skin) => typeof skin.tone === "number").map((skin) => skin.emoji);
    const row: [string, string, string] | [string, string, string, string[]] = skins?.length === 5 ? [item.emoji, item.label, tags, skins] : [item.emoji, item.label, tags];
    groups.set(item.group!, [...(groups.get(item.group!) ?? []), row]);
  }
  return {
    source: `Emojibase ${emojibaseVersion} (MIT), emoji up to version ${maxEmojiVersion}`,
    groups: [...groups].map(([id, items]) => ({ name: groupNames[id] ?? String(id), emoji: items })),
  };
}

const folded = (value: string) => value.toLowerCase().replace(/[’'“”".,:!()]/g, "").replace(/\s+/g, " ").trim();

/** Fluent's folders are named after the emoji's Unicode name, so they join Emojibase by label. */
async function stickers(data: EmojibaseEmoji[]) {
  const tree = await json<{ tree: Array<{ path: string }>; truncated: boolean }>(`https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/${fluentCommit}?recursive=1`);
  if (tree.truncated) throw new Error("GitHub truncated the Fluent Emoji file list.");
  const byName = new Map<string, string>();
  for (const { path } of tree.tree) {
    // One file per emoji: the plain 3D image, or the default-tone one for emoji with skin tones.
    const match = path.match(/^assets\/([^/]+)\/(?:Default\/)?3D\/[^/]+\.png$/);
    if (match) byName.set(folded(match[1]), path.slice("assets/".length));
  }
  const groups = new Map<number, Array<[string, string]>>();
  for (const item of usable(data)) {
    const path = byName.get(folded(item.label));
    if (!path || item.group === 9) continue;
    groups.set(item.group!, [...(groups.get(item.group!) ?? []), [path, [item.label, ...(item.tags ?? []).slice(0, 4)].join(" ")]]);
  }
  return {
    source: `Fluent Emoji 3D by Microsoft (MIT), commit ${fluentCommit}`,
    categories: [...groups].map(([id, items]) => ({ name: groupNames[id] ?? String(id), stickers: items })),
  };
}

async function main() {
  const data = await emojibase();
  const emojiCatalog = emoji(data);
  const stickerCatalog = await stickers(data);
  await writeFile(resolve(root, "src/domain/emojiCatalog.json"), `${JSON.stringify(emojiCatalog)}\n`);
  await writeFile(resolve(root, "src/domain/stickerCatalog.json"), `${JSON.stringify(stickerCatalog)}\n`);
  const emojiCount = emojiCatalog.groups.reduce((sum, group) => sum + group.emoji.length, 0);
  const stickerCount = stickerCatalog.categories.reduce((sum, category) => sum + category.stickers.length, 0);
  console.log(`Wrote ${emojiCount} emoji and ${stickerCount} Fluent 3D stickers.`);
}

main().catch((reason) => {
  console.error(reason);
  process.exit(1);
});

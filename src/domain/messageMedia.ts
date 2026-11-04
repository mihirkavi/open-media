/**
 * Emoji, GIFs, stickers and avatar stickers in messages (ADR 0029).
 *
 * A GIF or sticker travels as its link, alone in the message body. Every network Open Media sends
 * through (Open Media, Matrix, WhatsApp and other bridges, email) carries a link, and anyone
 * without Open Media still sees something that opens. Open Media draws the link as the picture,
 * but only for the open sets below, so a stranger can't make your app load images from a server
 * of their choosing (which would tell it your address and when you read the message).
 *
 * - Emoji: Unicode, drawn by the system font; names and keywords from Emojibase (MIT).
 * - Stickers: Microsoft Fluent Emoji 3D (MIT), from a pinned commit on jsDelivr.
 * - Avatar stickers: DiceBear's Avataaars style (free for personal and commercial use), drawn
 *   from a random seed kept on the device, never from an account id.
 * - GIFs and animated stickers: GIPHY, searched through the Open Media server.
 *
 * The emoji and sticker catalogs (about 320 KB) live in messageMediaCatalog.ts, which only the
 * picker loads, so showing a message never downloads them.
 */

export type MessageMediaKind = "gif" | "sticker" | "avatar";

export interface MessageMedia {
  kind: MessageMediaKind;
  /** What is sent and stored: the message body. */
  url: string;
  /** What Open Media draws: an animated GIF on every platform, 200 px wide for GIPHY (the full
   * original can be several megabytes). */
  displayUrl: string;
  /** Width over height, when the link says. */
  aspectRatio: number;
  label: string;
}

// ── Emoji ────────────────────────────────────────────────────────────────────────────────────

/** [emoji, name, keywords, five skin-tone versions?] */
export type EmojiRow = [string, string, string] | [string, string, string, string[]];
export interface EmojiGroup { name: string; emoji: EmojiRow[] }

/** 0 is the yellow default; 1–5 are light to dark (Fitzpatrick 1–2 to 6). */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;
export const skinToneSwatches = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"] as const;

export function withSkinTone(row: EmojiRow, tone: SkinTone): string {
  return tone && row[3] ? row[3][tone - 1] ?? row[0] : row[0];
}

export function words(query: string): string[] {
  return query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

const emojiUnit = /(?:\p{Regional_Indicator}\p{Regional_Indicator})|(?:[#*0-9]\uFE0F?\u20E3)|(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:[\u{E0020}-\u{E007F}]+)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)/gu;

/** One to three emoji and nothing else: drawn large, without a bubble, as chat apps do. */
export function jumboEmojiCount(body: string): number {
  const text = body.trim();
  if (!text || text.length > 40) return 0;
  const units = text.match(emojiUnit) ?? [];
  if (!units.length || units.length > 3) return 0;
  return text.replace(emojiUnit, "").replace(/\s/g, "") ? 0 : units.length;
}

// ── Stickers (Fluent Emoji 3D) ──────────────────────────────────────────────────────────────

/** Matches scripts/generate-message-media.ts, so links sent today keep loading. */
export const fluentCommit = "1ffb34c752ecf5d402f04cfb4b392c77f57c54bc";
const fluentBase = `https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@${fluentCommit}/assets/`;

/** [path inside the Fluent assets folder, name and keywords] */
export type StickerRow = [string, string];
export interface StickerCategory { name: string; stickers: StickerRow[] }
export function stickerURL(path: string): string {
  return fluentBase + path.split("/").map(encodeURIComponent).join("/");
}

// ── Avatar stickers (DiceBear Avataaars) ─────────────────────────────────────────────────────

export interface AvatarExpression { id: string; label: string; eyes: string; mouth: string; eyebrows: string }

export const avatarExpressions: AvatarExpression[] = [
  { id: "happy", label: "Happy", eyes: "happy", mouth: "smile", eyebrows: "defaultNatural" },
  { id: "love", label: "Love it", eyes: "hearts", mouth: "smile", eyebrows: "raisedExcitedNatural" },
  { id: "lol", label: "LOL", eyes: "squint", mouth: "twinkle", eyebrows: "raisedExcitedNatural" },
  { id: "wink", label: "Wink", eyes: "wink", mouth: "twinkle", eyebrows: "upDownNatural" },
  { id: "silly", label: "Silly", eyes: "winkWacky", mouth: "tongue", eyebrows: "raisedExcitedNatural" },
  { id: "wow", label: "Wow", eyes: "surprised", mouth: "screamOpen", eyebrows: "raisedExcitedNatural" },
  { id: "hmm", label: "Hmm", eyes: "side", mouth: "serious", eyebrows: "upDownNatural" },
  { id: "eyeroll", label: "Sure…", eyes: "eyeRoll", mouth: "serious", eyebrows: "flatNatural" },
  { id: "yikes", label: "Yikes", eyes: "surprised", mouth: "grimace", eyebrows: "sadConcernedNatural" },
  { id: "sad", label: "Sad", eyes: "cry", mouth: "sad", eyebrows: "sadConcernedNatural" },
  { id: "mad", label: "Grr", eyes: "squint", mouth: "serious", eyebrows: "angryNatural" },
  { id: "yum", label: "Yum", eyes: "happy", mouth: "eating", eyebrows: "defaultNatural" },
  { id: "unsure", label: "Unsure", eyes: "default", mouth: "concerned", eyebrows: "sadConcernedNatural" },
  { id: "dizzy", label: "Dizzy", eyes: "xDizzy", mouth: "disbelief", eyebrows: "upDownNatural" },
  { id: "sleepy", label: "Sleepy", eyes: "closed", mouth: "default", eyebrows: "flatNatural" },
  { id: "calm", label: "Calm", eyes: "default", mouth: "default", eyebrows: "defaultNatural" },
];

const avatarBase = "https://api.dicebear.com/9.x/avataaars/png";
const seedPattern = /^[a-z0-9]{6,24}$/;
const avatarOption = /^[A-Za-z]{2,24}$/;

/** A random look, kept on the device; a new one is just a new seed. */
export function newAvatarSeed(random: () => number = Math.random): string {
  let seed = "";
  while (seed.length < 12) seed += Math.floor(random() * 36).toString(36);
  return seed;
}

export function avatarStickerURL(seed: string, expression: AvatarExpression = avatarExpressions[0]): string {
  if (!seedPattern.test(seed)) throw new Error("Avatar seeds are 6–24 lowercase letters and digits.");
  const params = new URLSearchParams({ seed, eyes: expression.eyes, mouth: expression.mouth, eyebrows: expression.eyebrows, size: "256" });
  return `${avatarBase}?${params}`;
}

// ── GIFs (GIPHY) ─────────────────────────────────────────────────────────────────────────────

export interface GifResult { id: string; title: string; width: number; height: number }

const giphyId = /^[A-Za-z0-9]{4,40}$/;

/** The sent link carries its size after #, so the picture takes its place before it loads. */
export function gifURL(gif: GifResult, kind: "gif" | "sticker" = "gif"): string {
  if (!giphyId.test(gif.id)) throw new Error("Not a GIPHY id.");
  return `https://media.giphy.com/media/${gif.id}/giphy.gif#${kind === "sticker" ? "sticker-" : ""}${Math.round(gif.width)}x${Math.round(gif.height)}`;
}

/** A small version with fewer frames for the picker grid (tens of KB, not megabytes). */
export function gifPreviewURL(id: string): string {
  return `https://media.giphy.com/media/${id}/200w_d.gif`;
}

// ── Reading a message ────────────────────────────────────────────────────────────────────────

const giphyLink = /^https:\/\/(?:media\d?|i)\.giphy\.com\/media\/(?:v1\.[A-Za-z0-9_=-]+\/)?([A-Za-z0-9]{4,40})\/(?:giphy|200w|200|giphy-downsized)\.(?:gif|webp)(?:#(sticker-)?(\d{1,4})x(\d{1,4}))?$/;
const fluentLink = new RegExp(`^${fluentBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}((?:[A-Za-z0-9%._-]+/){1,3}[a-z0-9_.%-]+_3d(?:_default)?\\.png)$`);

/** The picture a message is, when its whole body is one link from the open sets. */
export function parseMessageMedia(body: string): MessageMedia | undefined {
  const url = body.trim();
  if (!url.startsWith("https://") || /\s/.test(url) || url.length > 600) return undefined;
  const gif = url.match(giphyLink);
  if (gif) {
    const [, id, sticker, width, height] = gif;
    const ratio = width && height ? Number(width) / Number(height) : 1;
    return { kind: sticker ? "sticker" : "gif", url, displayUrl: `https://media.giphy.com/media/${id}/200w.gif`, aspectRatio: clampRatio(ratio), label: sticker ? "Sticker" : "GIF" };
  }
  const fluent = url.match(fluentLink);
  if (fluent) {
    const name = decodeURIComponent(fluent[1].split("/")[0]);
    return { kind: "sticker", url, displayUrl: url, aspectRatio: 1, label: `${name} sticker` };
  }
  if (url.startsWith(`${avatarBase}?`)) {
    const params = new URL(url).searchParams;
    const keys = [...params.keys()];
    const allowed = ["seed", "eyes", "mouth", "eyebrows", "size"];
    if (!seedPattern.test(params.get("seed") ?? "") || keys.some((key) => !allowed.includes(key)) || ["eyes", "mouth", "eyebrows"].some((key) => params.has(key) && !avatarOption.test(params.get(key)!))) return undefined;
    const expression = avatarExpressions.find((item) => item.eyes === params.get("eyes") && item.mouth === params.get("mouth"));
    return { kind: "avatar", url, displayUrl: url, aspectRatio: 1, label: `Avatar sticker${expression ? `: ${expression.label}` : ""}` };
  }
  return undefined;
}

function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(Math.max(ratio, 0.5), 2.2) : 1;
}

/** How a media message reads in a conversation list, a reply quote or a notification. */
export function mediaPreview(body: string): string | undefined {
  const media = parseMessageMedia(body);
  if (!media) return undefined;
  return media.kind === "gif" ? "GIF" : media.kind === "avatar" ? "Avatar sticker" : "Sticker";
}

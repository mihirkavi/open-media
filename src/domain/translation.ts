/**
 * Automatic translation (ADR 0022): which items need translating, how a translation is keyed,
 * and what the reader sees. The app and the Worker both use this file, so a post is detected,
 * keyed and labelled the same way everywhere. Detection runs on the device: text that is already
 * in the reader's language never leaves it to be translated.
 */

export interface TranslationPreferences {
  /** Show translations automatically. On by default. */
  auto: boolean;
  /** ISO 639-1 code of the reader's language. */
  target: string;
}

export const defaultTranslationPreferences: TranslationPreferences = { auto: true, target: 'en' };

/** Bumped when the engine or prompt changes, so old cached translations are not reused. */
export const translationVersion = 't1';

export const maxTranslationItems = 20;
export const maxTranslationChars = 5_000;

/** Languages Open Media can name. Detection only ever returns one of these, or `und`. */
export const languageNames: Record<string, string> = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', nl: 'Dutch',
  pl: 'Polish', tr: 'Turkish', id: 'Indonesian', vi: 'Vietnamese', sv: 'Swedish', ro: 'Romanian', cs: 'Czech',
  ru: 'Russian', uk: 'Ukrainian', el: 'Greek', ar: 'Arabic', fa: 'Persian', he: 'Hebrew', hi: 'Hindi',
  bn: 'Bengali', pa: 'Punjabi', gu: 'Gujarati', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam',
  th: 'Thai', lo: 'Lao', km: 'Khmer', my: 'Burmese', si: 'Sinhala', am: 'Amharic', ka: 'Georgian', hy: 'Armenian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
};

export function languageName(code: string): string {
  return languageNames[code] ?? (code === 'und' ? 'another language' : code.toUpperCase());
}

export function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(languageNames, value);
}

/** Letters of each writing system; a script used by one language names it outright. */
const scripts: Array<[RegExp, string]> = [
  [/[぀-ヿ]/g, 'ja'], [/[가-힯ᄀ-ᇿ]/g, 'ko'], [/[一-鿿㐀-䶿]/g, 'zh'],
  [/[Ѐ-ӿ]/g, 'ru'], [/[؀-ۿݐ-ݿ]/g, 'ar'], [/[֐-׿]/g, 'he'],
  [/[Ͱ-Ͽ]/g, 'el'], [/[฀-๿]/g, 'th'], [/[ऀ-ॿ]/g, 'hi'], [/[ঀ-৿]/g, 'bn'],
  [/[਀-੿]/g, 'pa'], [/[઀-૿]/g, 'gu'], [/[஀-௿]/g, 'ta'], [/[ఀ-౿]/g, 'te'],
  [/[ಀ-೿]/g, 'kn'], [/[ഀ-ൿ]/g, 'ml'], [/[඀-෿]/g, 'si'], [/[຀-໿]/g, 'lo'],
  [/[က-႟]/g, 'my'], [/[ក-៿]/g, 'km'], [/[ሀ-፿]/g, 'am'], [/[Ⴀ-ჿ]/g, 'ka'], [/[԰-֏]/g, 'hy'],
  [/[a-zA-ZÀ-ɏ]/g, 'latin'],
];

/** Common short words: Latin-script languages are told apart by how often their own appear. */
const stopwords: Record<string, string> = {
  en: 'the and is are was were of to in that it for on with this you have be not but at by from they we what can will just my your our about all so do if or there their an like get one how when',
  es: 'el la los las de que y en un una es por para con no se su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros hoy aquí gracias',
  pt: 'o a os as de que e do da em um uma é para com não se na por mais no dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele tu te vocês vos lhes meus minhas obrigado hoje aqui',
  fr: 'le la les de des du et en un une est que qui pour dans pas ne sur au aux avec ce cette ces il elle ils nous vous je tu on se sa son ses mais ou où plus par comme été être avoir fait très aussi tout tous bien leur leurs mon ma mes merci aujourd',
  de: 'der die das und ist nicht ein eine zu den von mit sich des auf für im dem auch es an als nach wie aus bei noch wird nur oder aber vor zur bis mehr durch man sind über so ich du wir ihr sie mein dein sein kann hat haben werden wenn dass heute danke',
  it: 'il lo la i gli le di che e un una è per non con su del della dei delle al alla si sono come ma più anche ho ha questo questa nel nella mi ti ci se io tu noi voi loro molto tutto oggi grazie',
  nl: 'de het een en van in is dat op te zijn met voor niet aan er maar om ook als bij dan nog wel naar uit door heb hebben ik je jij wij we zij dit die wat kan zou geen meer hoe vandaag bedankt',
  pl: 'i w na nie że się z do to jest jak o po ale co tak za od czy już tylko jego jej ich być może są ten ta te dla przez bardzo jestem mam dzisiaj dziękuję',
  tr: 've bir bu da de için ile çok ne o ama gibi daha en olarak var yok ben sen biz siz onlar şey kadar sonra mi mı mu mü değil her bugün teşekkürler',
  id: 'yang dan di ke dari ini itu untuk dengan tidak ada akan pada juga saya kamu kami kita mereka adalah sudah bisa atau karena oleh dalam hari ini terima kasih',
  vi: 'và của là có không được cho người này những một các với trong để đã khi cũng như từ đó tôi bạn chúng rất hôm nay cảm ơn',
  sv: 'och att det som en på är av för med till den har inte om ett men jag du vi de var så kan från nu också idag tack',
  ro: 'și în de la pe care cu un o nu este sunt să din pentru mai ce dar se ca fost eu tu noi voi ei azi mulțumesc',
  cs: 'a se na je že to v s z do jsem jsi jako ale by jak tak pro jeho její jejich není být už také dnes děkuji',
};

const letterHints: Record<string, RegExp> = {
  es: /[ñ¿¡]/gi, pt: /[ãõç]/gi, de: /[ßäöü]/gi, fr: /[èêëàâçœ]/gi, pl: /[łśźżąęń]/gi, tr: /[ğış]/gi,
  vi: /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi, ro: /[șțăî]/gi, cs: /[ěščřžůý]/gi,
};

const stopwordSets =Object.fromEntries(Object.entries(stopwords).map(([code, words]) => [code, new Set(words.split(' '))])) as Record<string, Set<string>>;

/** Text without links, handles, hashtags, emoji and numbers: what detection and length rules look at. */
export function proseOf(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[@#][\p{L}\p{N}_.-]+/gu, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DetectedLanguage {
  /** ISO 639-1 code, or `und` when the text is too short or mixed to say. */
  language: string;
  confidence: number;
}

/** Below this many letters a guess is too unreliable to act on ("gm", "lol", a name). */
const minLetters = 12;

export function detectLanguage(text: string): DetectedLanguage {
  const prose = proseOf(text);
  const letters = (prose.match(/\p{L}/gu) ?? []).length;
  if (letters < minLetters) return { language: 'und', confidence: 0 };
  const counts = scripts.map(([pattern, code]) => [code, (prose.match(pattern) ?? []).length] as const).filter(([, count]) => count > 0);
  counts.sort((a, b) => b[1] - a[1]);
  const [script, count] = counts[0] ?? ['latin', 0];
  const share = count / letters;
  // Kana is the sign of Japanese even when kanji (shared with Chinese) outnumber it.
  if (counts.some(([code, n]) => code === 'ja' && n / letters >= 0.1)) return { language: 'ja', confidence: 0.95 };
  if (script !== 'latin') {
    if (share < 0.4) return { language: 'und', confidence: share };
    if (script === 'ru' && /[іїєґ]/i.test(prose)) return { language: 'uk', confidence: share };
    if (script === 'ar' && /[پچژگ]/.test(prose)) return { language: 'fa', confidence: share };
    return { language: script, confidence: share };
  }
  return detectLatin(prose);
}

function detectLatin(prose: string): DetectedLanguage {
  const words = prose.toLocaleLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  if (words.length < 3) return { language: 'und', confidence: 0 };
  const scores = Object.entries(stopwordSets).map(([code, set]) => {
    // Letters only some languages use break ties between close relatives (es/pt, de/nl).
    const marks = letterHints[code] ? Math.min(prose.match(letterHints[code])?.length ?? 0, 3) * 0.5 : 0;
    return [code, words.filter((word) => set.has(word)).length + marks] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, top] = scores[0];
  const second = scores[1]?.[1] ?? 0;
  const ratio = top / words.length;
  // Too few common words to tell, or two languages nearly tied: leave it alone.
  if (top < 2 || ratio < 0.12 || top - second < 1) return { language: best === 'en' && top >= 2 ? 'en' : 'und', confidence: ratio };
  return { language: best, confidence: Math.min(1, ratio * 2) };
}

/** The source language to translate from, or undefined when the item should be shown as written. */
export function translationSource(text: string, target: string): string | undefined {
  if (!text.trim()) return undefined;
  const { language } = detectLanguage(text);
  return language === 'und' || language === target ? undefined : language;
}

/** The exact text that is translated and keyed: trimmed, Windows line breaks made plain, capped. */
export function normalizeForTranslation(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim().slice(0, maxTranslationChars);
}

/** What the cache key is a hash of. The Worker hashes it with SHA-256; the app with keyHash. */
export function translationKeyInput(text: string, source: string, target: string): string {
  return `${translationVersion}\n${source}\n${target}\n${normalizeForTranslation(text)}`;
}

/** A fast 64-bit FNV-1a hash (two 32-bit halves) for keys kept on the device. */
export function keyHash(input: string): string {
  let a = 0x811c9dc5; let b = 0x050c5d1f;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (a >>> 13)) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export function deviceTranslationKey(text: string, source: string, target: string): string {
  const input = translationKeyInput(text, source, target);
  return `${source}:${target}:${input.length}:${keyHash(input)}`;
}

export interface TranslatedItem {
  text: string;
  source: string;
  target: string;
}

export interface TranslationDisplay {
  /** The text to show. */
  text: string;
  /** The quiet note under it, which is also the toggle. Absent when nothing was translated. */
  note?: { label: string; accessibilityLabel: string };
}

/** What the reader sees for one item, and the note that switches between translation and original. */
export function translationDisplay(original: string, translation: TranslatedItem | undefined, showOriginal: boolean): TranslationDisplay {
  if (!translation || !translation.text.trim() || translation.text.trim() === original.trim()) return { text: original };
  const from = languageName(translation.source);
  const into = languageName(translation.target);
  return showOriginal
    ? { text: original, note: { label: `Original in ${from} · Show ${into}`, accessibilityLabel: `Showing the original ${from}. Show the ${into} translation.` } }
    : { text: translation.text, note: { label: `Translated from ${from} · Show original`, accessibilityLabel: `Translated from ${from}. Show the original.` } };
}

/** Flips one item between its translation and its original. */
export function toggleOriginal(showing: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(showing);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Reads saved preferences, falling back to the defaults for anything missing or invalid. */
export function parseTranslationPreferences(value: unknown): TranslationPreferences {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<TranslationPreferences>;
  return {
    auto: typeof saved.auto === 'boolean' ? saved.auto : defaultTranslationPreferences.auto,
    target: isLanguageCode(saved.target) ? saved.target : defaultTranslationPreferences.target,
  };
}

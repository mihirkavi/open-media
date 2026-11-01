import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectLanguage, deviceTranslationKey, keyHash, normalizeForTranslation, parseTranslationPreferences, proseOf,
  toggleOriginal, translationDisplay, translationKeyInput, translationSource, translationVersion,
} from './translation';

test('detects Latin-script languages from their common words', () => {
  const samples: Array<[string, string]> = [
    ['Hoy publiqué mi primer artículo en Hive sobre la comunidad de fotografía. ¡Espero que les guste!', 'es'],
    ['Hoje eu publiquei meu primeiro post aqui na Hive, muito obrigado a todos que me ajudaram com isso.', 'pt'],
    ['Aujourd’hui je partage avec vous les photos de mon voyage dans les Alpes, et c’est très beau.', 'fr'],
    ['Ich habe heute einen neuen Artikel über die Zukunft des Internets geschrieben und bin sehr stolz.', 'de'],
    ['Oggi ho scritto un nuovo articolo su questa comunità e sono molto contento di come è venuto.', 'it'],
    ['Vandaag heb ik een nieuw artikel geschreven over de toekomst van het internet en ik ben er trots op.', 'nl'],
    ['Saya sangat senang hari ini karena bisa berbagi cerita dengan kalian semua di komunitas ini.', 'id'],
    ['Just shipped a new version of the app with better search and a cleaner feed for everyone.', 'en'],
  ];
  for (const [text, language] of samples) assert.equal(detectLanguage(text).language, language, text);
});

test('detects languages by writing system', () => {
  const samples: Array<[string, string]> = [
    ['今日はとてもいい天気ですね。散歩に行きましょう。', 'ja'],
    ['今天天气很好，我们一起去公园散步吧。', 'zh'],
    ['오늘 날씨가 정말 좋네요. 같이 산책해요.', 'ko'],
    ['Привет всем, сегодня я хочу рассказать о своём путешествии.', 'ru'],
    ['Привіт усім, сьогодні я хочу розповісти про свою подорож.', 'uk'],
    ['نمی‌دانم چگونه این پروژه را شروع کنم ولی خیلی هیجان دارم', 'fa'],
    ['مرحبا بالجميع، اليوم أريد أن أشارككم قصة رحلتي', 'ar'],
    ['नमस्ते दोस्तों, आज मैं आपके साथ अपनी यात्रा की कहानी साझा करना चाहता हूँ।', 'hi'],
    ['สวัสดีครับ วันนี้อากาศดีมากเลย', 'th'],
    ['မင်္ဂလာပါ ဒီနေ့ ရာသီဥတု အရမ်းကောင်းပါတယ်', 'my'],
    ['សួស្តី ថ្ងៃនេះ អាកាសធាតុល្អណាស់', 'km'],
    ['ሰላም ዛሬ የአየር ሁኔታው በጣም ጥሩ ነው', 'am'],
  ];
  for (const [text, language] of samples) assert.equal(detectLanguage(text).language, language, text);
});

test('leaves short, mixed or link-only text undetermined', () => {
  for (const text of ['gm', 'lol 😂😂', 'https://example.com/a-very-long-link-to-something', '@alice @bob #hive #photography', 'Ok', '12345 678 90']) {
    assert.equal(detectLanguage(text).language, 'und', text);
    assert.equal(translationSource(text, 'en'), undefined, text);
  }
});

test('only non-English prose needs translating into English', () => {
  assert.equal(translationSource('Just shipped a new version of the app with better search for everyone.', 'en'), undefined);
  assert.equal(translationSource('Hola amigos, hoy es un buen día para salir a caminar por la playa.', 'en'), 'es');
  assert.equal(translationSource('Hola amigos, hoy es un buen día para salir a caminar por la playa.', 'es'), undefined);
  assert.equal(translationSource('   ', 'en'), undefined);
});

test('ignores links, handles, hashtags and emoji when detecting', () => {
  assert.equal(proseOf('Mira esto https://hive.blog/@ana/post @ana #photography 📷 2026'), 'Mira esto');
  assert.equal(detectLanguage('#spanish #photography Hoy salí a caminar con mi perro por el parque y fue muy bonito https://x.co/1').language, 'es');
});

test('cache keys depend on the text, both languages and the engine version', () => {
  const text = 'Hola amigos, hoy es un buen día.';
  assert.equal(translationKeyInput(text, 'es', 'en'), `${translationVersion}\nes\nen\n${text}`);
  assert.equal(deviceTranslationKey(text, 'es', 'en'), deviceTranslationKey(`  ${text}\r\n`, 'es', 'en'));
  assert.notEqual(deviceTranslationKey(text, 'es', 'en'), deviceTranslationKey(text, 'pt', 'en'));
  assert.notEqual(deviceTranslationKey(text, 'es', 'en'), deviceTranslationKey(text, 'es', 'fr'));
  assert.notEqual(deviceTranslationKey(text, 'es', 'en'), deviceTranslationKey(`${text}!`, 'es', 'en'));
  assert.match(keyHash('anything'), /^[0-9a-f]{16}$/);
  assert.equal(normalizeForTranslation('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(normalizeForTranslation('x'.repeat(6000)).length, 5000);
});

test('shows the translation with a note that toggles back to the original', () => {
  const translation = { text: 'Hello friends', source: 'es', target: 'en' };
  const shown = translationDisplay('Hola amigos', translation, false);
  assert.equal(shown.text, 'Hello friends');
  assert.equal(shown.note?.label, 'Translated from Spanish · Show original');
  const original = translationDisplay('Hola amigos', translation, true);
  assert.equal(original.text, 'Hola amigos');
  assert.equal(original.note?.label, 'Original in Spanish · Show English');
  assert.deepEqual(translationDisplay('Hola amigos', undefined, false), { text: 'Hola amigos' });
  assert.deepEqual(translationDisplay('Hola', { text: 'Hola', source: 'es', target: 'en' }, false), { text: 'Hola' });

  let showing: Set<string> = new Set();
  showing = toggleOriginal(showing, 'post-1');
  assert.ok(showing.has('post-1'));
  showing = toggleOriginal(showing, 'post-1');
  assert.ok(!showing.has('post-1'));
});

test('preferences default to automatic English and reject unknown languages', () => {
  assert.deepEqual(parseTranslationPreferences(undefined), { auto: true, target: 'en' });
  assert.deepEqual(parseTranslationPreferences({ auto: false, target: 'xx' }), { auto: false, target: 'en' });
  assert.deepEqual(parseTranslationPreferences({ target: 'es' }), { auto: true, target: 'es' });
});

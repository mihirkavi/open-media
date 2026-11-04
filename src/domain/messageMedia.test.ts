import assert from 'node:assert/strict';
import test from 'node:test';

import {
  avatarExpressions, avatarStickerURL, fluentCommit, gifURL, jumboEmojiCount, mediaPreview, newAvatarSeed, parseMessageMedia,
  stickerURL, withSkinTone,
} from './messageMedia';
import { emojiGroups, searchEmoji, searchStickers, stickerCategories } from './messageMediaCatalog';

test('the emoji catalog covers every group with skin tones where they apply', () => {
  assert.deepEqual(emojiGroups.map((group) => group.name), ['Smileys', 'People', 'Animals & nature', 'Food & drink', 'Travel & places', 'Activities', 'Objects', 'Symbols', 'Flags']);
  assert.ok(emojiGroups.reduce((sum, group) => sum + group.emoji.length, 0) > 1800);
  const wave = emojiGroups[1].emoji.find((row) => row[1] === 'waving hand')!;
  assert.equal(withSkinTone(wave, 0), '👋');
  assert.equal(withSkinTone(wave, 3), '👋🏽');
  const grin = emojiGroups[0].emoji[0];
  assert.equal(withSkinTone(grin, 5), grin[0], 'emoji without tones stay as they are');
});

test('emoji search matches word starts in names and keywords, names first', () => {
  assert.equal(searchEmoji('red heart')[0][0], '❤️');
  assert.ok(searchEmoji('hea').some((row) => row[0] === '❤️'));
  assert.ok(searchEmoji('pizza').some((row) => row[0] === '🍕'));
  assert.deepEqual(searchEmoji('   '), []);
  assert.deepEqual(searchEmoji('zzqx'), []);
});

test('one to three emoji alone are drawn large; anything else is text', () => {
  assert.equal(jumboEmojiCount('😂'), 1);
  assert.equal(jumboEmojiCount(' 🔥🔥 '), 2);
  assert.equal(jumboEmojiCount('👍🏽❤️🇮🇳'), 3);
  assert.equal(jumboEmojiCount('👩‍👩‍👧'), 1, 'a family is one emoji');
  assert.equal(jumboEmojiCount('😂😂😂😂'), 0);
  assert.equal(jumboEmojiCount('ok 👍'), 0);
  assert.equal(jumboEmojiCount('1'), 0);
  assert.equal(jumboEmojiCount(''), 0);
});

test('stickers come from a pinned Fluent Emoji commit and read back as stickers', () => {
  assert.ok(stickerCategories.length >= 8);
  const [path] = stickerCategories[0].stickers[0];
  const url = stickerURL(path);
  assert.ok(url.startsWith(`https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@${fluentCommit}/assets/`));
  assert.ok(url.includes('Grinning%20face/3D/grinning_face_3d.png'));
  assert.deepEqual(parseMessageMedia(url), { kind: 'sticker', url, displayUrl: url, aspectRatio: 1, label: 'Grinning face sticker' });
  assert.ok(searchStickers('cat').length > 0);
  // A different commit or repository is just a link.
  assert.equal(parseMessageMedia(url.replace(fluentCommit, 'main')), undefined);
});

test('avatar stickers use a device seed and only the expression options', () => {
  const seed = newAvatarSeed(() => 0.5);
  assert.match(seed, /^[a-z0-9]{12}$/);
  const url = avatarStickerURL('abc123def456', avatarExpressions[1]);
  assert.equal(url, 'https://api.dicebear.com/9.x/avataaars/png?seed=abc123def456&eyes=hearts&mouth=smile&eyebrows=raisedExcitedNatural&size=256');
  assert.equal(parseMessageMedia(url)?.label, 'Avatar sticker: Love it');
  assert.throws(() => avatarStickerURL('Not A Seed'));
  assert.equal(parseMessageMedia(`${url}&backgroundColor=ff0000`), undefined, 'unknown options are not drawn');
  assert.equal(parseMessageMedia('https://api.dicebear.com/9.x/avataaars/png?seed=user@example.com'), undefined);
});

test('GIPHY links carry their size and are drawn only from GIPHY', () => {
  const url = gifURL({ id: 'l0MYt5jPR6QX5pnqM', title: 'Wave', width: 200, height: 150 });
  assert.equal(url, 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif#200x150');
  assert.deepEqual(parseMessageMedia(url), { kind: 'gif', url, displayUrl: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif', aspectRatio: 200 / 150, label: 'GIF' });
  const sticker = gifURL({ id: 'abcd1234', title: '', width: 200, height: 200 }, 'sticker');
  assert.equal(parseMessageMedia(sticker)?.kind, 'sticker');
  assert.equal(parseMessageMedia('https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif')?.aspectRatio, 1);
  assert.throws(() => gifURL({ id: '../x', title: '', width: 1, height: 1 }));
});

test('other links, text around a link and look-alike hosts stay text', () => {
  for (const body of [
    'https://example.com/cat.gif',
    'look https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    'https://media.giphy.com.evil.test/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    'http://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    'https://api.dicebear.com/9.x/avataaars/svg?seed=abc123def456',
    'hello',
  ]) assert.equal(parseMessageMedia(body), undefined, body);
});

test('media read as words in previews and quotes', () => {
  assert.equal(mediaPreview(gifURL({ id: 'l0MYt5jPR6QX5pnqM', title: '', width: 2, height: 1 })), 'GIF');
  assert.equal(mediaPreview(stickerURL(stickerCategories[0].stickers[0][0])), 'Sticker');
  assert.equal(mediaPreview(avatarStickerURL('abc123def456')), 'Avatar sticker');
  assert.equal(mediaPreview('hi'), undefined);
});

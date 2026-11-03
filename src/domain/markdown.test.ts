import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanPostMarkdown, inlineText, isNumericCell, looksLikeMarkdown, parseInline, parseMarkdown, previewBlocks, tidyBlocks } from './markdown';

// The shape of a real SplinterBoost daily report on Hive.
const report = `![image.png](https://i.imgur.com/SYZprka.png)

---

## Daily Splinterboost Report for 11/1/2026

---

|Bot Owned HP|Total Delegated HP|AVG Daily HIVE Distributed|APR %|
|---|---|---|---|
|8211.171 HIVE|223557.011 HIVE|51.989 HIVE|8.488219|

---

*By delegating you HP to the @SplinterBoost bot you are helping to support the community!*

|Account|Delegated HP
|---|---|
|@crypt0gnome|39583.35 HIVE|
|@kolbjorn|27171.09 HIVE|`;

test('a Hive report keeps its heading, tables, rules and emphasis, without the image', () => {
  const blocks = parseMarkdown(cleanPostMarkdown(report));
  assert.deepEqual(blocks.map((block) => block.kind), ['rule', 'heading', 'rule', 'table', 'rule', 'paragraph', 'table']);
  const [, heading, , stats, , note, accounts] = blocks;
  assert.equal(heading.kind === 'heading' && heading.level, 2);
  assert.equal(heading.kind === 'heading' && inlineText(heading.content), 'Daily Splinterboost Report for 11/1/2026');
  assert.ok(stats.kind === 'table' && stats.header.length === 4 && stats.rows.length === 1);
  assert.equal(stats.kind === 'table' && inlineText(stats.rows[0][2]), '51.989 HIVE');
  assert.equal(note.kind === 'paragraph' && note.content[0].kind, 'em');
  assert.ok(accounts.kind === 'table' && accounts.header.length === 2 && accounts.rows.length === 2);
});

test('HTML that Hive authors mix in becomes structure, and photo-only lines are dropped', () => {
  const html = '<center>https://images.hive.blog/DQm/photo.jpg\n<p></p>\nHello <b>everyone</b>!<br>Second line</center>\n<h3>Winners</h3><a href="https://peakd.com/x">the post</a> &amp; more';
  const blocks = parseMarkdown(cleanPostMarkdown(html));
  assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'heading', 'paragraph']);
  assert.equal(blocks[0].kind === 'paragraph' && inlineText(blocks[0].content), 'Hello everyone!\nSecond line');
  assert.equal(blocks[2].kind === 'paragraph' && blocks[2].content[0].kind, 'link');
  assert.equal(blocks[2].kind === 'paragraph' && inlineText(blocks[2].content), 'the post & more');
  assert.doesNotMatch(cleanPostMarkdown('<script>alert(1)</script>Hi'), /alert/);
});

test('lists, quotes, code and inline styles', () => {
  const blocks = parseMarkdown('1. First\n2. Second **bold**\n\n- one\n- two\n\n> quoted\n> text\n\n```\nconst a = 1;\n```');
  assert.deepEqual(blocks.map((block) => block.kind), ['list', 'list', 'quote', 'code']);
  assert.ok(blocks[0].kind === 'list' && blocks[0].ordered && blocks[0].items.length === 2);
  assert.equal(blocks[2].kind === 'quote' && inlineText(blocks[2].content), 'quoted\ntext');
  assert.deepEqual(parseInline('a **b** *c* ~~d~~ `e` [f](https://x.y)').map((part) => part.kind), ['text', 'strong', 'text', 'em', 'text', 'strike', 'text', 'code', 'text', 'link']);
  // Underscores inside names are not emphasis, and links must be https.
  assert.equal(inlineText(parseInline('@user_name_here and snake_case_word')), '@user_name_here and snake_case_word');
  assert.deepEqual(parseInline('[x](javascript:alert(1))').map((part) => part.kind), ['text']);
});

test('plain text is recognised as such, and numbers are right-aligned cells', () => {
  assert.equal(looksLikeMarkdown('GM 👋, today I made stir-fried noodles.\nSo good! #food'), false);
  assert.equal(looksLikeMarkdown('## Title\n\nBody'), true);
  assert.equal(isNumericCell(parseInline('8211.171 HIVE')), true);
  assert.equal(isNumericCell(parseInline('8.48%')), true);
  assert.equal(isNumericCell(parseInline('@crypt0gnome')), false);
});

test('long posts are cut at a line break and marked', () => {
  const long = Array.from({ length: 200 }, (_, index) => `Line ${index}`).join('\n');
  const cut = cleanPostMarkdown(long, 100);
  assert.ok(cut.length < 110);
  assert.match(cut, /\n\n…$/);
});

test('rules are tidied and a collapsed post shows its opening blocks', () => {
  const blocks = tidyBlocks(parseMarkdown(cleanPostMarkdown(report)), 'SplinterBoost Daily Report 11/1/2026');
  assert.deepEqual(blocks.map((block) => block.kind), ['table', 'paragraph', 'table']);
  assert.deepEqual(tidyBlocks(parseMarkdown('## Other heading\n\nOne\n\n---\n\nTwo'), 'A title').map((block) => block.kind), ['heading', 'paragraph', 'rule', 'paragraph']);
  // An event description that opens with its title in bold: the repeat goes, the rest stays.
  const event = '**Atheist Community Members—Please vote this week!**\nPlease vote well before Election Day (Tuesday November 3).';
  assert.equal(looksLikeMarkdown(event), true);
  assert.deepEqual(tidyBlocks(parseMarkdown(event), 'Atheist Community Members—Please vote this week!'), [{ kind: 'paragraph', content: [{ kind: 'text', text: 'Please vote well before Election Day (Tuesday November 3).' }] }]);
  // Bold that starts a sentence, or doesn't repeat the title, is kept.
  assert.equal(tidyBlocks(parseMarkdown('**Note:** doors open at 6'), 'Book club').length, 1);
  assert.equal(inlineText((tidyBlocks(parseMarkdown('**Note:** doors open at 6'), 'Book club')[0] as { content: Parameters<typeof inlineText>[0] }).content), 'Note: doors open at 6');
  const short = previewBlocks(parseMarkdown('One short paragraph.'));
  assert.equal(short.more, false);
  const long = previewBlocks(parseMarkdown(Array.from({ length: 12 }, (_, index) => `Paragraph ${index} ${'word '.repeat(20)}`).join('\n\n')));
  assert.ok(long.more && long.blocks.length >= 1 && long.blocks.length < 12);
});

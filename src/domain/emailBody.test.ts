import assert from 'node:assert/strict';
import test from 'node:test';

import { emailPreview, formatEmailBody } from './emailBody';

test('turns "Label ( url )" into tappable words', () => {
  const { segments, plain } = formatEmailBody('Shop by type\nSparkling\tSparkling\n ( https://clicks.vivino.com/f/a/B2rx~~/AAA~&lid=jn8 )\nRose Rosé ( https://clicks.vivino.com/f/a/wKS~&lid=zeq )');
  assert.equal(plain, 'Shop by type\nSparkling\nRosé');
  const links = segments.filter((segment) => segment.url);
  assert.equal(links.length, 2);
  assert.equal(links[1].text, 'Rosé');
  assert.match(links[1].url!, /^https:\/\/clicks\.vivino\.com\//);
  assert.ok(!plain.includes('http'));
});

test('labels bare and unlabeled links by domain', () => {
  const { segments } = formatEmailBody('Read more: https://www.example.com/a/b?c=1.');
  assert.deepEqual(segments, [{ text: 'Read more: ' }, { text: 'example.com ↗', url: 'https://www.example.com/a/b?c=1' }, { text: '.' }]);
});

test('drops quoted reply history', () => {
  const body = 'Sounds good!\n\nOn Thu, Oct 1, 2026 at 10:00 AM Ana <ana@example.com> wrote:\n> Lunch Thursday?\n> Noon?';
  const result = formatEmailBody(body);
  assert.equal(result.plain, 'Sounds good!');
  assert.equal(result.hadQuotedHistory, true);
  assert.equal(formatEmailBody('Yes\n\n> earlier line\n> more').plain, 'Yes');
});

test('removes invisible characters and layout spacing', () => {
  const { plain } = formatEmailBody('Hello​ there͏   friend\n\n\n\n\nBye');
  assert.equal(plain, 'Hello there friend\n\nBye');
});

test('previews use the first readable line', () => {
  assert.equal(emailPreview('​\n\nHey! Want lunch? ( https://x.example/y )\nMore'), 'Hey! Want lunch?');
  assert.equal(emailPreview('', 'Subject'), 'Subject');
});

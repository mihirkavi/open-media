import assert from 'node:assert/strict';
import test from 'node:test';

import { displayUrl, mentionRef, tokenizeRichText } from './richText';

const kinds = (text: string) => tokenizeRichText(text).map((token) => token.kind === 'text' ? token.text : `${token.kind}:${token.kind === 'link' ? token.url : token.kind === 'mention' ? token.handle : token.tag}`);

test('links, mentions and hashtags are picked out of plain text', () => {
  assert.deepEqual(kinds('Thanks @maya for #OpenSource tips: https://example.com/guide!'), ['Thanks ', 'mention:maya', ' for ', 'hashtag:OpenSource', ' tips: ', 'link:https://example.com/guide', '!']);
  assert.deepEqual(kinds('Plain text stays one run.'), ['Plain text stays one run.']);
  assert.deepEqual(kinds(''), ['']);
});

test('sentence punctuation is not part of a link, but balanced brackets are', () => {
  assert.deepEqual(kinds('See https://example.com/a.'), ['See ', 'link:https://example.com/a', '.']);
  assert.deepEqual(kinds('(see https://example.com/a)'), ['(see ', 'link:https://example.com/a', ')']);
  assert.deepEqual(kinds('https://en.wikipedia.org/wiki/Foo_(bar)'), ['link:https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(kinds('www.example.org, then'), ['link:https://www.example.org', ', then']);
});

test('lookalikes stay text', () => {
  assert.deepEqual(kinds('mail me at ada@example.com'), ['mail me at ada@example.com'], 'an email address is not a mention');
  assert.deepEqual(kinds('we were #1 on v1.2 e.g.'), ['we were #1 on v1.2 e.g.']);
  assert.deepEqual(kinds('javascript:alert(1) ftp://x.com'), ['javascript:alert(1) ftp://x.com']);
  assert.deepEqual(kinds('https://example.com/#section and @bob.'), ['link:https://example.com/#section', ' and ', 'mention:bob', '.'], 'a fragment is not a hashtag, a trailing period is not part of a handle');
});

test('Lens and other network mentions keep their form', () => {
  assert.deepEqual(kinds('Thanks @lens/0xjavi you da bestest'), ['Thanks ', 'mention:lens/0xjavi', ' you da bestest']);
  assert.deepEqual(mentionRef('lens/0xjavi', 'lens'), { kind: 'network', network: 'lens', handle: '0xjavi' });
  assert.deepEqual(mentionRef('dwr.eth', 'farcaster'), { kind: 'network', network: 'farcaster', handle: 'dwr.eth' });
  assert.deepEqual(mentionRef('Maya', 'open-media'), { kind: 'open_media', handle: 'maya' });
  assert.equal(mentionRef('maya', 'events'), undefined, 'event descriptions have no network to resolve a handle on');
});

test('long links are shortened to the domain and path', () => {
  assert.equal(displayUrl('https://www.example.com/'), 'example.com');
  assert.equal(displayUrl('https://www.example.com/a/very/long/path/that/keeps/going?x=1'), 'example.com/a/very/long/path/th…');
  assert.equal(displayUrl('https://example.com/a').length <= 32, true);
});

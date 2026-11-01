import assert from 'node:assert/strict';
import test from 'node:test';

import { highlightTerms, snippetAround, splitHighlights } from './searchHighlight';

test('search words are marked wherever the search matched them, ignoring case', () => {
  const terms = highlightTerms(['#Dinner', 'cook', 'a']);
  assert.deepEqual(terms, ['dinner', 'cook']);
  assert.deepEqual(splitHighlights('Family DINNER, then cooking', terms), [
    { text: 'Family ', match: false }, { text: 'DINNER', match: true }, { text: ', then ', match: false },
    { text: 'cooking', match: true },
  ]);
});

test('text without matches, or a search without words, stays one plain piece', () => {
  assert.deepEqual(splitHighlights('Hello there', ['dinner']), [{ text: 'Hello there', match: false }]);
  assert.deepEqual(splitHighlights('Hello there', []), [{ text: 'Hello there', match: false }]);
  assert.deepEqual(splitHighlights('a+b (c)', highlightTerms(['+b', '(c)'])), [{ text: 'a', match: false }, { text: '+b', match: true }, { text: ' ', match: false }, { text: '(c)', match: true }]);
});

test('a long text is cut around its first match, on word boundaries', () => {
  const text = 'We talked about the trip for a long time and then, much later in the evening, somebody finally asked who was coming to dinner on Friday at the new place on Valencia street.';
  const snippet = snippetAround(text, ['dinner'], 60);
  assert.match(snippet, /^….*dinner.*…$/);
  assert.ok(snippet.length <= 62);
  assert.equal(snippetAround('Short text', ['dinner']), 'Short text');
  assert.match(snippetAround(text, ['zebra'], 40), /^We talked about the trip for a long time…$/);
});

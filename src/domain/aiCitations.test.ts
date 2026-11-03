import assert from 'node:assert/strict';
import test from 'node:test';

import { citedAnswer } from './aiCitations';

const sent = Array.from({ length: 15 }, (_, index) => `post-${index + 1}`);

test('citations are renumbered in the order they first appear', () => {
  const result = citedAnswer('Some mention it, like [3] and [6]. Posts [10] and [14] agree, as does [3].', sent);
  assert.deepEqual(result.sources, ['post-3', 'post-6', 'post-10', 'post-14']);
  assert.deepEqual(result.pieces, [
    { text: 'Some mention it, like' }, { cite: 1, postId: 'post-3' }, { text: ' and' }, { cite: 2, postId: 'post-6' },
    { text: '. Posts' }, { cite: 3, postId: 'post-10' }, { text: ' and' }, { cite: 4, postId: 'post-14' },
    { text: ' agree, as does' }, { cite: 1, postId: 'post-3' }, { text: '.' },
  ]);
});

test('a marker with several posts becomes one citation each', () => {
  const result = citedAnswer('Cooking videos [2, 5][5].', sent);
  assert.deepEqual(result.pieces, [{ text: 'Cooking videos' }, { cite: 1, postId: 'post-2' }, { cite: 2, postId: 'post-5' }, { cite: 2, postId: 'post-5' }, { text: '.' }]);
});

test('markers that point at no post are dropped, and plain text stays whole', () => {
  assert.deepEqual(citedAnswer('Nothing here [40].', sent), { pieces: [{ text: 'Nothing here.' }], sources: [] });
  assert.deepEqual(citedAnswer('No citations at all.', sent), { pieces: [{ text: 'No citations at all.' }], sources: [] });
});

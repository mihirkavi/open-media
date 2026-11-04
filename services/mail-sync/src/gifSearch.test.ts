import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGifQuery, searchGifs } from './gifSearch.js';

const giphy = (data: unknown[]) => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetcher };
};

test('GIF queries are trimmed, bounded and default to GIFs', () => {
  assert.deepEqual(parseGifQuery(new URL('https://x.test/v1/media/gifs?q=%20thank%20%20you%20&offset=30')), { query: 'thank you', offset: 30, kind: 'gifs' });
  assert.deepEqual(parseGifQuery(new URL('https://x.test/v1/media/gifs?kind=stickers&offset=-5')), { query: '', offset: 0, kind: 'stickers' });
  assert.equal(parseGifQuery(new URL('https://x.test/v1/media/gifs?offset=99999')).offset, 450);
  assert.throws(() => parseGifQuery(new URL(`https://x.test/v1/media/gifs?q=${'a'.repeat(61)}`)));
});

test('no key means GIF search is off, and the key never leaves the server answer', async () => {
  await assert.rejects(searchGifs({}, 'hi'));
  const { calls, fetcher } = giphy([
    { id: 'l0MYt5jPR6QX5pnqM', title: 'Happy Dance GIF by Studio', images: { fixed_width: { width: '200', height: '150' } } },
    { id: '../evil', title: 'x', images: { fixed_width: { width: '200', height: '150' } } },
    { id: 'abcd1234', title: 'no size' },
  ]);
  const gifs = await searchGifs({ GIPHY_API_KEY: 'secret-key' }, 'dance', 0, 'gifs', fetcher);
  assert.deepEqual(gifs, [{ id: 'l0MYt5jPR6QX5pnqM', title: 'Happy Dance', width: 200, height: 150 }]);
  assert.ok(calls[0].startsWith('https://api.giphy.com/v1/gifs/search?'));
  assert.ok(calls[0].includes('rating=pg-13'));
  assert.equal(JSON.stringify(gifs).includes('secret-key'), false);
});

test('an empty search is trending, and stickers use GIPHY’s sticker endpoints', async () => {
  const { calls, fetcher } = giphy([]);
  await searchGifs({ GIPHY_API_KEY: 'k' }, '', 0, 'gifs', fetcher);
  await searchGifs({ GIPHY_API_KEY: 'k' }, 'cat', 30, 'stickers', fetcher);
  assert.ok(calls[0].startsWith('https://api.giphy.com/v1/gifs/trending?'));
  assert.ok(calls[1].startsWith('https://api.giphy.com/v1/stickers/search?'));
  assert.ok(calls[1].includes('offset=30'));
});

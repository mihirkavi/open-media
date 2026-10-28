import assert from 'node:assert/strict';
import test from 'node:test';

import { webMcpRequestUrl, webMcpTools } from './webMcpTools';

test('WebMCP tools read the public API with the agent’s input', () => {
  const tool = (name: string) => webMcpTools.find((item) => item.name === name)!;
  assert.equal(webMcpRequestUrl('https://api.test/', tool('search_open_media'), { query: 'ethereum on lens' }), 'https://api.test/v1/search?q=ethereum+on+lens');
  assert.equal(webMcpRequestUrl('https://api.test', tool('get_open_media_profile'), { handle: 'a/b' }), 'https://api.test/v1/profiles/a%2Fb');
  assert.equal(webMcpRequestUrl('https://api.test', tool('get_open_media_feed'), { mode: 'raw', sources: '' }), 'https://api.test/v1/feed?mode=raw');
  assert.equal(webMcpRequestUrl('https://api.test', tool('get_open_media_feed'), { lens: 'relevant' }), 'https://api.test/v1/feed?lens=relevant');
  assert.equal(webMcpRequestUrl('https://api.test', tool('list_open_media_feed_lenses'), { query: 'videos' }), 'https://api.test/v1/lenses?q=videos');
  assert.ok(webMcpTools.every((item) => item.description.length >= 20 && /^[a-z_]+$/.test(item.name)));
});

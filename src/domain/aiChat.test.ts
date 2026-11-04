import assert from 'node:assert/strict';
import test from 'node:test';

import { looksLikeAsk } from './aiChat';

test('questions and requests go to Open Media AI; names and keywords stay a search', () => {
  for (const ask of ['Catch me up', 'what does my conversation with Sam look like', 'set my theme to dark', 'any news about lens?', 'Summarize my inbox', 'show me what I missed today']) assert.equal(looksLikeAsk(ask), true, ask);
  for (const search of ['sam', 'ethereum on lens', 'videos about cooking today', 'dark mode', '#hive', '']) assert.equal(looksLikeAsk(search), false, search);
});

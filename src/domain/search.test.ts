import assert from 'node:assert/strict';
import test from 'node:test';

import { mockConversations } from '../data/mockData';
import { mockPosts } from '../data/mockPosts';
import { universalSearch } from './search';
import { searchSettings } from './settings';

test('settings accept natural language queries', () => assert.equal(searchSettings('use chronological feed')[0]?.route, 'feed'));
test('universal search spans settings, messages, and posts', () => {
  assert.equal(universalSearch('dark mode', mockPosts, mockConversations)[0]?.kind, 'setting');
  assert.ok(universalSearch('Maya', mockPosts, mockConversations).some((result) => result.kind === 'conversation'));
  assert.ok(universalSearch('protocol', mockPosts, mockConversations).some((result) => result.kind === 'post'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { networkConnectors } from '../../../src/connectors/networkFeeds';
import { SocialPost } from '../../../src/domain/posts';
import { feed } from './agentApi';

const now = Date.now();
function post(id: string, source: string, minutes: number): SocialPost {
  return {
    id, author: { id, displayName: id, handle: `@${id}`, initials: 'X' }, body: '', kind: 'text', createdAt: new Date(now - minutes * 60_000).toISOString(), topics: [],
    provenance: { connectorId: source }, relevance: { followsAuthor: false, selectedInterestMatches: [] },
  };
}

// Hive pages cover minutes, Farcaster pages cover days, as on the live networks.
const pages: Record<string, Record<string, { posts: SocialPost[]; cursor?: string }>> = {
  hive: { first: { posts: [post('h1', 'hive', 1), post('h2', 'hive', 5)], cursor: 'h-2' }, 'h-2': { posts: [post('h3', 'hive', 10), post('h4', 'hive', 600)], cursor: undefined } },
  farcaster: { first: { posts: [post('f1', 'farcaster', 3), post('f2', 'farcaster', 300), post('f3', 'farcaster', 3000)], cursor: 'f-2' }, 'f-2': { posts: [post('f4', 'farcaster', 4000)], cursor: undefined } },
};

test('Raw pages through the networks in time order, never jumping back for one of them', async (t) => {
  const asked: string[] = [];
  for (const connector of networkConnectors) {
    if (!pages[connector.id]) continue;
    t.mock.method(connector as unknown as { fetchFeed: (cursor?: string) => Promise<unknown> }, 'fetchFeed', async (cursor?: string) => { asked.push(`${connector.id}:${cursor ?? 'first'}`); return pages[connector.id][cursor ?? 'first']; });
  }
  const env = {} as Parameters<typeof feed>[0];
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 6; page += 1) {
    const result = await feed(env, 'https://example.test', { sources: ['hive', 'farcaster'], cursor });
    seen.push(...result.data.map((item) => item.id.split(':').pop()!));
    cursor = result.nextCursor ?? undefined;
    if (!cursor) break;
  }
  // Every post exactly once, newest first across both networks and every page.
  assert.deepEqual(seen, ['h1', 'f1', 'h2', 'h3', 'f2', 'h4', 'f3', 'f4']);
  // Farcaster's first page was asked again while Hive caught up, never skipped past.
  assert.ok(asked.filter((call) => call === 'farcaster:first').length >= 2);
});

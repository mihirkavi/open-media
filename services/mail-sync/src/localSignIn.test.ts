import assert from 'node:assert/strict';
import test from 'node:test';

import { latestSignInCode } from './localSignIn.js';

test('returns the newest code sent after the request, not an older one', async () => {
  const fakeInbox = async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes('/search')) {
      return Response.json({ messages: [
        { ID: 'old', Created: '2026-10-16T10:00:00Z' },
        { ID: 'new', Created: '2026-10-16T10:05:00Z' },
      ] });
    }
    return Response.json({ Text: href.endsWith('/new') ? 'Type this code: 482913' : 'Type this code: 111111' });
  };
  assert.equal(await latestSignInCode('http://inbox', 'me@x.com', new Date('2026-10-16T10:04:59Z'), fakeInbox as typeof fetch), '482913');
  assert.equal(await latestSignInCode('http://inbox', 'me@x.com', new Date('2026-10-16T10:10:00Z'), fakeInbox as typeof fetch), undefined);
});

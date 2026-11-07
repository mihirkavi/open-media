import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignInHandoff, latestSignInCode } from './localSignIn.js';

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
  assert.equal(await latestSignInCode('http://inbox', 'me@x.com', new Date('2026-10-16T10:20:00Z'), fakeInbox as typeof fetch), undefined);
  // Docker's clock can lag the Mac's: an email stamped a few minutes before the request still counts.
  assert.equal(await latestSignInCode('http://inbox', 'me@x.com', new Date('2026-10-16T10:08:00Z'), fakeInbox as typeof fetch), '482913');
});

test('sign-in link handoff is taken once and expires', () => {
  let clock = 0;
  const handoff = createSignInHandoff(1000, () => clock);
  assert.equal(handoff.take(), undefined);
  assert.equal(handoff.put('short'), false);
  assert.equal(handoff.put('bad code with spaces'), false);
  assert.equal(handoff.put('0b9c6c1e-5f3a-4c1e-9d7a-2a1f0e9b8c7d'), true);
  assert.equal(handoff.take(), '0b9c6c1e-5f3a-4c1e-9d7a-2a1f0e9b8c7d');
  assert.equal(handoff.take(), undefined);
  handoff.put('0b9c6c1e-5f3a-4c1e-9d7a-2a1f0e9b8c7d');
  clock = 1001;
  assert.equal(handoff.take(), undefined);
});

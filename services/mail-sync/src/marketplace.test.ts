import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkListing, confirmEvidence, fetchPublicPage, isPublicHost, PendingListing, readEvidence, runMarketplaceJobs } from './marketplace.js';
import { jwkThumbprint, parseSignatureInput, verifyWebBotAuth } from './webBotAuth.js';

const publicDns = async () => ['93.184.216.34'];
const listing = (change: Partial<PendingListing> = {}): PendingListing => ({
  postId: '11111111-1111-4111-8111-111111111111', authorId: '22222222-2222-4222-8222-222222222222', updatedAt: '2026-10-26T10:00:00.000Z', linkedAccounts: 0,
  kind: 'product', title: 'Walnut lamp', body: 'Handmade walnut lamp.', priceMinor: 12000, currency: 'USD', authorAgeDays: 90, authorVerified: false, ...change,
});

test('a plain listing from an established seller is clear', async () => {
  const outcome = await checkListing({ SUPABASE_URL: 'http://db.test' }, listing(), { resolve: publicDns });
  assert.equal(outcome.state, 'clear');
  assert.equal(outcome.notice, undefined);
});

test('brand impersonation and direct downloads are held with a statement of reasons', async () => {
  const outcome = await checkListing({ SUPABASE_URL: 'http://db.test' }, listing({ title: 'Free app', body: 'Get it at https://paypal-verify.help/app.exe', priceMinor: 0 }), { resolve: publicDns });
  assert.equal(outcome.state, 'held');
  assert.deepEqual(outcome.reasons.map((reason) => reason.code).sort(), ['brand_impersonation', 'download_link']);
  assert.match(outcome.notice!, /Only you can see your listing “Free app”/);
  assert.match(outcome.notice!, /post the listing again with the change/);
});

test('Google Web Risk matches hold the listing; the model only asks for a closer look', async () => {
  const fetchImpl = (async (url: string) => {
    if (String(url).startsWith('https://webrisk.googleapis.com/')) return Response.json(String(url).includes('bad.example') ? { threat: { threatTypes: ['SOCIAL_ENGINEERING'] } } : {});
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  const env = { SUPABASE_URL: 'http://db.test', WEB_RISK_API_KEY: 'test-key', AI: { run: async () => ({ response: 'unsafe\nS2' }) } };
  const held = await checkListing(env, listing({ body: 'See https://bad.example/deal' }), { fetch: fetchImpl, resolve: publicDns });
  assert.equal(held.state, 'held');
  assert.match(held.reasons[0].message, /phishing/);
  const review = await checkListing(env, listing({ body: 'See https://good.example/lamp' }), { fetch: fetchImpl, resolve: publicDns });
  assert.equal(review.state, 'review');
  assert.equal(review.reasons[0].code, 'content_model');
  assert.ok(review.claims.length >= 1, 'a closer look comes with claims for verified people to check');
});

test('short links are followed and their destination checked', async () => {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'HEAD' && String(url).startsWith('https://bit.ly/')) return new Response(null, { status: 301, headers: { location: 'https://files.example/setup.exe' } });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  const outcome = await checkListing({ SUPABASE_URL: 'http://db.test' }, listing({ body: 'Download https://bit.ly/abc' }), { fetch: fetchImpl, resolve: publicDns });
  assert.equal(outcome.state, 'held');
  assert.ok(outcome.reasons.some((reason) => reason.code === 'download_link'));
});

test('a new seller’s paid listing gets a closer look without a message', async () => {
  const outcome = await checkListing({ SUPABASE_URL: 'http://db.test' }, listing({ authorAgeDays: 1 }), { resolve: publicDns });
  assert.equal(outcome.state, 'review');
  assert.equal(outcome.notice, undefined);
});

test('pages are fetched only from public hosts over https, following checked redirects', async () => {
  assert.equal(await isPublicHost('localhost', publicDns), false);
  assert.equal(await isPublicHost('10.0.0.1', publicDns), false);
  assert.equal(await isPublicHost('internal.example', async () => ['10.1.2.3']), false);
  assert.equal(await fetchPublicPage('http://example.com/', { resolve: publicDns }), undefined);
  const fetchImpl = (async (url: string) => String(url) === 'https://a.example/start'
    ? new Response(null, { status: 302, headers: { location: 'https://b.example/page' } })
    : new Response('<html><body>Sunrise <b>yoga</b>, May&nbsp;4 at Dolores Park</body></html>')) as typeof fetch;
  const page = await fetchPublicPage('https://a.example/start', { fetch: fetchImpl, resolve: publicDns });
  assert.equal(page?.url, 'https://b.example/page');
  const toPrivate = (async () => new Response(null, { status: 302, headers: { location: 'https://metadata.internal/' } })) as unknown as typeof fetch;
  assert.equal(await fetchPublicPage('https://a.example/start', { fetch: toPrivate, resolve: async (host) => host === 'metadata.internal' ? ['169.254.169.254'] : ['93.184.216.34'] }), undefined);
});

test('evidence counts only when the cited page contains the quote', async () => {
  const fetchImpl = (async () => new Response('<p>Sunrise <b>yoga</b>, May&nbsp;4 — Dolores Park</p>')) as unknown as typeof fetch;
  assert.deepEqual(readEvidence([{ url: 'http://insecure.example', quote: 'long enough quote' }, { url: 'https://ok.example', quote: 'short' }]), []);
  assert.equal(await confirmEvidence([{ url: 'https://events.example/yoga', quote: 'Sunrise yoga, May 4' }], { fetch: fetchImpl, resolve: publicDns }), true);
  assert.equal(await confirmEvidence([{ url: 'https://events.example/yoga', quote: 'Sunset yoga, June 9' }], { fetch: fetchImpl, resolve: publicDns }), false);
});

test('the minute job checks pending listings, records them and delivers notices', async () => {
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const name = String(url).split('/rpc/')[1];
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ name, body });
    if (name === 'open_media_pending_listing_checks') return Response.json([listing({ body: 'Replica watches, AAA quality' })]);
    if (name === 'open_media_record_listing_check') return Response.json(true);
    if (name === 'open_media_high_volume_sellers') return Response.json([]);
    return Response.json(name === 'open_media_deliver_notices' ? 1 : 0);
  }) as typeof fetch;
  const done = await runMarketplaceJobs({ SUPABASE_URL: 'http://db.test', SUPABASE_SECRET_KEY: 'secret' }, { fetch: fetchImpl, resolve: publicDns });
  assert.deepEqual(done, { checked: 1, notices: 1, confirmed: 0, sellers: 0 });
  const recorded = calls.find((call) => call.name === 'open_media_record_listing_check')!.body;
  assert.equal(recorded.p_state, 'held');
  assert.equal(recorded.p_updated_at, '2026-10-26T10:00:00.000Z');
  assert.match(String(recorded.p_notice), /replica/i);
  assert.equal(await runMarketplaceJobs({ SUPABASE_URL: 'http://db.test' }).then((result) => result.checked), 0, 'nothing runs without the service key');
});

test('Web Bot Auth: a correctly signed request verifies; tampering or a wrong key does not', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as { kty: string; crv: string; x: string };
  const keyid = await jwkThumbprint(jwk);
  const now = new Date('2026-10-26T10:00:00Z');
  const created = Math.floor(now.getTime() / 1000);
  const params = `("@authority" "signature-agent");created=${created};expires=${created + 300};keyid="${keyid}";alg="ed25519";nonce="abc";tag="web-bot-auth"`;
  const agentHeader = '"https://agent.example"';
  const base = `"@authority": api.openmedia.site\n"signature-agent": ${agentHeader}\n"@signature-params": ${params}`;
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(base)))));
  const directory = (async (url: string) => String(url) === 'https://agent.example/.well-known/http-message-signatures-directory' ? Response.json({ keys: [jwk] }) : new Response('no', { status: 404 })) as typeof fetch;
  const signed = (headers: Record<string, string>) => new Request('https://api.openmedia.site/v1/me/listings', { method: 'POST', headers: { 'signature-agent': agentHeader, 'signature-input': `sig1=${params}`, signature: `sig1=:${signature}:`, ...headers } });

  assert.equal(parseSignatureInput(`sig1=${params}`)?.params.tag, 'web-bot-auth');
  assert.deepEqual(await verifyWebBotAuth(signed({}), { fetch: directory, resolve: publicDns, now: () => now }), { agent: 'https://agent.example' });
  assert.equal(await verifyWebBotAuth(new Request('https://evil.example/v1/me/listings', { headers: { 'signature-agent': agentHeader, 'signature-input': `sig1=${params}`, signature: `sig1=:${signature}:` } }), { fetch: directory, resolve: publicDns, now: () => now }), undefined, 'a signature for another host does not verify');
  assert.equal(await verifyWebBotAuth(signed({}), { fetch: directory, resolve: publicDns, now: () => new Date(now.getTime() + 600_000) }), undefined, 'expired signatures do not verify');
  assert.equal(await verifyWebBotAuth(new Request('https://api.openmedia.site/'), { fetch: directory }), undefined, 'unsigned requests are simply unsigned');
});

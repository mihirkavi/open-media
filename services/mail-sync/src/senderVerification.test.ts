import assert from 'node:assert/strict';
import test from 'node:test';

import { checkMarkCertificatePem, receivedDmarc, verifySender } from './senderVerification.js';

const auth = (line: string) => ({ key: 'authentication-results', line: `Authentication-Results: ${line}` });

/** Fake DNS-over-HTTPS and certificate host. */
function fakeNetwork(records: Record<string, string>, markCertificate = false) {
  return async (url: string) => {
    if (url.endsWith('.pem')) return new Response(markCertificate ? 'not a real certificate' : '', { status: markCertificate ? 200 : 404 });
    const name = new URL(url).searchParams.get('name')!;
    const data = records[name];
    return Response.json({ Answer: data ? [{ type: 16, data: `"${data}"` }] : [] });
  };
}

test('reads DMARC only from the topmost Authentication-Results header', () => {
  assert.deepEqual(receivedDmarc([auth('mx.icloud.com; spf=pass; dmarc=pass (p=REJECT) header.from=News.Vivino.com'), auth('evil; dmarc=fail header.from=x.com')]), { result: 'pass', domain: 'news.vivino.com' });
  assert.deepEqual(receivedDmarc([auth('mx.icloud.com; dmarc=fail header.from=paypal.com'), auth('forged; dmarc=pass header.from=paypal.com')]), { result: 'fail', domain: 'paypal.com' });
  assert.equal(receivedDmarc([]), undefined);
});

test('requires DMARC pass for the exact From domain', async () => {
  const network = fakeNetwork({ '_dmarc.brand.example': 'v=DMARC1; p=reject', 'default._bimi.brand.example': 'v=BIMI1; l=https://brand.example/logo.svg; a=https://brand.example/vmc.pem' });
  assert.deepEqual(await verifySender('news@brand.example', [auth('mx; dmarc=pass header.from=other.example')], network), { verified: false });
  assert.deepEqual(await verifySender('news@brand.example', [auth('mx; dmarc=fail header.from=brand.example')], network), { verified: false });
});

test('requires an enforced DMARC policy and a valid mark certificate', async () => {
  const relaxed = fakeNetwork({ '_dmarc.relaxed.example': 'v=DMARC1; p=none', 'default._bimi.relaxed.example': 'v=BIMI1; l=https://relaxed.example/logo.svg; a=https://relaxed.example/vmc.pem' });
  assert.deepEqual(await verifySender('a@relaxed.example', [auth('mx; dmarc=pass header.from=relaxed.example')], relaxed), { verified: false });
  // A BIMI record without a mark certificate (logo only) is not shown as verified.
  const logoOnly = fakeNetwork({ '_dmarc.logo.example': 'v=DMARC1; p=quarantine', 'default._bimi.logo.example': 'v=BIMI1; l=https://logo.example/logo.svg' });
  assert.deepEqual(await verifySender('a@logo.example', [auth('mx; dmarc=pass header.from=logo.example')], logoOnly), { verified: false });
  // An unparseable certificate is rejected.
  const badCertificate = fakeNetwork({ '_dmarc.bad.example': 'v=DMARC1; p=reject', 'default._bimi.bad.example': 'v=BIMI1; l=https://bad.example/logo.svg; a=https://bad.example/vmc.pem' }, true);
  assert.deepEqual(await verifySender('a@bad.example', [auth('mx; dmarc=pass header.from=bad.example')], badCertificate), { verified: false });
});

test('mark certificate checks reject non-certificates', () => {
  assert.equal(checkMarkCertificatePem('', ['brand.example']), false);
  assert.equal(checkMarkCertificatePem('-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----', ['brand.example']), false);
});

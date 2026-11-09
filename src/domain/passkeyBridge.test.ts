import assert from 'node:assert/strict';
import test from 'node:test';

import { optionsToJSON, base64UrlFromBytes, bytesFromBase64Url, credentialToJSON, passkeyBridgeSite, passkeyBridgeURL, publicKeyFromJSON, readBridgeRequest, readBridgeResponse, encodeBridge } from './passkeyBridge';

test('base64url round-trips bytes the way WebAuthn writes them', () => {
  for (let length = 0; length < 40; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + length) & 255);
    assert.deepEqual(bytesFromBase64Url(base64UrlFromBytes(bytes)), bytes);
  }
  assert.equal(base64UrlFromBytes(Uint8Array.from([251, 255])), '-_8');
  assert.equal(Buffer.from(bytesFromBase64Url('-_8')).toString('hex'), 'fbff');
  assert.equal(base64UrlFromBytes(Buffer.from('any carnal pleas')), Buffer.from('any carnal pleas').toString('base64url'));
});

test('the bridge site is openmedia.site in production and localhost in development', () => {
  assert.deepEqual(passkeyBridgeSite('https://api.openmedia.site'), { rpId: 'openmedia.site', rpOrigins: ['https://openmedia.site'], webOrigin: 'https://openmedia.site' });
  assert.equal(passkeyBridgeSite('http://127.0.0.1:8787').rpId, 'localhost');
});

test('the page reads the request from the fragment, names and all', () => {
  const request = { v: 1 as const, kind: 'create' as const, publicKey: { challenge: 'AQID', user: { id: 'BAU', name: 'Āsha 🌸', displayName: 'Āsha 🌸' }, rp: { id: 'openmedia.site', name: 'Open Media' } } };
  const url = passkeyBridgeURL('https://openmedia.site', request);
  assert.ok(url.startsWith('https://openmedia.site/passkey#'));
  assert.deepEqual(readBridgeRequest(new URL(url).hash), request);
  assert.equal(readBridgeRequest('#not-json'), undefined);
  assert.equal(readBridgeRequest(`#${encodeBridge({ v: 1, ok: false, error: 'x' })}`), undefined);
});

test('the app accepts only openmedia://passkey answers', () => {
  const answer = { v: 1 as const, ok: true as const, credential: { id: 'abc', type: 'public-key' } };
  assert.deepEqual(readBridgeResponse(`openmedia://passkey#${encodeBridge(answer)}`), answer);
  assert.equal(readBridgeResponse(`https://evil.example/passkey#${encodeBridge(answer)}`), undefined);
  assert.deepEqual(readBridgeResponse(`openmedia://passkey#${encodeBridge({ v: 1, ok: false, error: 'NotAllowedError' })}`), { v: 1, ok: false, error: 'NotAllowedError' });
});

test('options become bytes for the browser, and credentials become JSON for Supabase', () => {
  const create = publicKeyFromJSON('create', { challenge: 'AQID', user: { id: 'BAU', name: 'a' }, excludeCredentials: [{ id: 'Bgc', type: 'public-key' }] });
  assert.deepEqual(Array.from(create.challenge as Uint8Array), [1, 2, 3]);
  assert.deepEqual(Array.from((create.user as { id: Uint8Array }).id), [4, 5]);
  assert.deepEqual(Array.from((create.excludeCredentials as { id: Uint8Array }[])[0].id), [6, 7]);
  const request = publicKeyFromJSON('request', { challenge: 'AQID', allowCredentials: [{ id: 'CAk', type: 'public-key' }] });
  assert.deepEqual(Array.from((request.allowCredentials as { id: Uint8Array }[])[0].id), [8, 9]);

  const buffer = (...values: number[]) => Uint8Array.from(values).buffer;
  const assertion = credentialToJSON({ id: 'cred', type: 'public-key', authenticatorAttachment: 'platform', response: { clientDataJSON: buffer(1), authenticatorData: buffer(2), signature: buffer(3), userHandle: buffer(4) }, getClientExtensionResults: () => ({}) });
  assert.deepEqual(assertion, { id: 'cred', rawId: 'cred', type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw', userHandle: 'BA' } });
  const attestation = credentialToJSON({ id: 'new', type: 'public-key', response: { clientDataJSON: buffer(1), attestationObject: buffer(5), getTransports: () => ['internal'] } });
  assert.deepEqual(attestation.response, { clientDataJSON: 'AQ', attestationObject: 'BQ', transports: ['internal'] });
  assert.deepEqual(credentialToJSON({ id: 'x', type: 'public-key', response: { clientDataJSON: buffer(1) }, toJSON: () => ({ native: true }) }), { native: true });
});

test('options Supabase already decoded go back to the JSON the server sent', () => {
  const decoded = { challenge: Uint8Array.from([1, 2, 3]).buffer, user: { id: Uint8Array.from([4, 5]), name: 'a' }, allowCredentials: [{ id: Uint8Array.from([6, 7]).buffer, type: 'public-key', transports: ['internal'] }], timeout: 300000, rp: { id: 'openmedia.site' } };
  assert.deepEqual(optionsToJSON(decoded), { challenge: 'AQID', user: { id: 'BAU', name: 'a' }, allowCredentials: [{ id: 'Bgc', type: 'public-key', transports: ['internal'] }], timeout: 300000, rp: { id: 'openmedia.site' } });
  const json = optionsToJSON(decoded) as Record<string, unknown>;
  assert.deepEqual(Array.from(publicKeyFromJSON('request', json).challenge as Uint8Array), [1, 2, 3]);
});

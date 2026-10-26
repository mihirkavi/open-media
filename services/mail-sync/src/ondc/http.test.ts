import assert from 'node:assert/strict';
import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { CatalogStore, QuoteItem } from './catalog.js';
import { authorizationHeader, generateOndcKeys, parseAuthorization, verifyAuthorization } from './crypto.js';
import { handleOndcRequest, Lookup, OndcEnv } from './http.js';

const seller = generateOndcKeys();
const buyer = generateOndcKeys();
const env: OndcEnv = {
  SUPABASE_URL: 'http://db.test', SUPABASE_SECRET_KEY: 'sb_secret_test', ONDC_SUBSCRIBER_ID: 'ondc.openmedia.test', ONDC_UNIQUE_KEY_ID: 'om-key-1',
  ONDC_SIGNING_PRIVATE_KEY: seller.signingPrivate, ONDC_ENCRYPTION_PRIVATE_KEY: seller.encryptionPrivate, ONDC_REQUEST_ID: 'req-123', ONDC_ENVIRONMENT: 'preprod',
};
const now = Date.parse('2026-10-25T10:00:00.000Z');
const registry: Lookup = async (subscriberId, keyId) => {
  if (subscriberId === 'buyer.example.test' && keyId === 'b1') return { signingPublicKey: buyer.signingPublic, subscriberUrl: 'https://buyer.example.test/ondc' };
  if (subscriberId === 'ondc.openmedia.test' && keyId === 'om-key-1') return { signingPublicKey: seller.signingPublic, subscriberUrl: 'https://ondc.openmedia.test/ondc' };
  return undefined;
};

const store: CatalogStore = {
  id: '7c1d2e3f-0000-4000-8000-000000000001', storeName: 'Asha Handlooms', category: 'ONDC:RET12', building: '12 MG Road', locality: 'Ashok Nagar', city: 'Bengaluru', state: 'Karnataka',
  areaCode: '560001', stdCode: '080', gps: '12.971600,77.594600', phone: '9876543210', email: 'asha@example.test', timeToShip: 'P3D', returnable: true, returnWindow: 'P7D', cancellable: true,
  updatedAt: '2026-10-25T09:00:00.000Z', handle: 'ashaweaves', avatarUrl: null,
};
const saree = { id: 'd4000000-0000-4000-8000-0000000000e1', title: 'Cotton saree', body: 'Hand-woven, natural dyes', priceMinor: 250000, availability: 'available' as const, createdAt: '2026-10-24T09:00:00.000Z', updatedAt: '2026-10-24T09:00:00.000Z', posterPath: null };

function context(action: string, extra: Record<string, unknown> = {}) {
  return { domain: 'ONDC:RET12', country: 'IND', city: 'std:080', action, core_version: '1.2.0', bap_id: 'buyer.example.test', bap_uri: 'https://buyer.example.test/ondc', transaction_id: 'a4b24113-7c05-495b-9249-f33482bf3493', message_id: 'e4f781c2-c926-4801-a7eb-7f44e740ee67', timestamp: new Date(now - 1000).toISOString(), ttl: 'PT30S', ...extra };
}

/** A buyer app's signed request, a fake database and a capture of the callback the seller app sends back. */
async function exchange(action: string, message: object, options: { sign?: boolean; key?: string; contextExtra?: Record<string, unknown> } = {}) {
  const body = JSON.stringify({ context: context(action, options.contextExtra), message });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.sign !== false) headers.authorization = authorizationHeader(body, { subscriberId: 'buyer.example.test', uniqueKeyId: 'b1', privateKey: options.key ?? buyer.signingPrivate }, Math.floor(now / 1000));
  const calls: { url: string; body: string; authorization: string | null }[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/open_media_ondc_catalog')) {
      const args = JSON.parse(String(init?.body));
      return Response.json(args.p_std_code === '080' && args.p_category === 'ONDC:RET12' ? [{ ...store, items: [saree] }] : []);
    }
    if (url.endsWith('/rest/v1/rpc/open_media_ondc_items')) return Response.json(JSON.parse(String(init?.body)).p_item_ids.includes(saree.id) ? [{ ...saree, storeId: store.id, store } satisfies QuoteItem] : []);
    calls.push({ url, body: String(init?.body), authorization: new Headers(init?.headers).get('authorization') });
    return new Response('{"message":{"ack":{"status":"ACK"}}}');
  }) as typeof fetch;
  const response = await handleOndcRequest(new Request(`https://ondc.openmedia.test/ondc/${action}`, { method: 'POST', headers, body }), env, { fetch: fakeFetch, lookup: registry, now: () => now });
  return { response: response!, status: response!.status, sync: await response!.json() as { message: { ack: { status: string } }; error?: { code: string } }, calls };
}

test('a signed search is ACKed and answered with a signed on_search catalog', async () => {
  const { status, sync, calls } = await exchange('search', { intent: { item: { descriptor: { name: 'saree' } }, fulfillment: { type: 'Delivery' } } });
  assert.equal(status, 200);
  assert.equal(sync.message.ack.status, 'ACK');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://buyer.example.test/ondc/on_search');
  const header = parseAuthorization(calls[0].authorization)!;
  assert.equal(header.subscriberId, 'ondc.openmedia.test');
  assert.ok(verifyAuthorization(header, calls[0].body, seller.signingPublic, Math.floor(now / 1000)), 'the buyer app can verify our callback');
  const callback = JSON.parse(calls[0].body);
  assert.equal(callback.context.action, 'on_search');
  assert.equal(callback.context.bpp_uri, 'https://ondc.openmedia.test/ondc');
  assert.equal(callback.context.message_id, 'e4f781c2-c926-4801-a7eb-7f44e740ee67', 'the callback answers the same message');
  const provider = callback.message.catalog['bpp/providers'][0];
  assert.equal(provider.descriptor.name, 'Asha Handlooms');
  assert.equal(provider.locations[0].address.area_code, '560001');
  assert.deepEqual(provider.items[0].price, { currency: 'INR', value: '2500.00', maximum_value: '2500.00' });
  assert.equal(provider.items[0]['@ondc/org/contact_details_consumer_care'], 'Asha Handlooms,asha@example.test,9876543210');
  assert.equal(provider.items[0].quantity.available.count, '99');
});

test('select is quoted, and over-ordering or unknown items are answered with ONDC error codes', async () => {
  const quoted = await exchange('select', { order: { provider: { id: store.id }, items: [{ id: saree.id, quantity: { count: 2 } }] } });
  const order = JSON.parse(quoted.calls[0].body).message.order;
  assert.equal(order.quote.price.value, '5000.00');
  assert.equal(order.quote.breakup.find((line: { '@ondc/org/title_type': string }) => line['@ondc/org/title_type'] === 'delivery').price.value, '0.00');
  const tooMany = JSON.parse((await exchange('select', { order: { provider: { id: store.id }, items: [{ id: saree.id, quantity: { count: 50 } }] } })).calls[0].body);
  assert.equal(tooMany.error.code, '40002');
  const unknown = JSON.parse((await exchange('select', { order: { provider: { id: store.id }, items: [{ id: 'd4000000-0000-4000-8000-0000000000ff', quantity: { count: 1 } }] } })).calls[0].body);
  assert.equal(unknown.error.code, '30004');
});

test('unsigned, forged and misdirected requests are refused before any work; orders are not accepted yet', async () => {
  for (const options of [{ sign: false }, { key: generateOndcKeys().signingPrivate }]) {
    const refused = await exchange('search', { intent: {} }, options);
    assert.equal(refused.status, 401);
    assert.equal(refused.sync.error?.code, '10001');
    assert.equal(refused.calls.length, 0);
  }
  const elsewhere = await exchange('search', { intent: {} }, { contextExtra: { bap_uri: 'https://attacker.example.test/ondc' } });
  assert.equal(elsewhere.status, 401, 'callbacks only go to the buyer app’s registered host');
  const stale = await exchange('search', { intent: {} }, { contextExtra: { timestamp: new Date(now - 60_000).toISOString() } });
  assert.equal(stale.sync.error?.code, '30022');
  const food = await exchange('search', { intent: {} }, { contextExtra: { domain: 'ONDC:RET10' } });
  assert.equal(food.status, 400);
  const confirm = await exchange('confirm', { order: {} });
  assert.equal(confirm.sync.message.ack.status, 'NACK');
  assert.equal(confirm.sync.error?.code, '40001');
  assert.equal(confirm.calls.length, 0);
});

test('registry onboarding: participant info, site verification and the on_subscribe challenge', async () => {
  const info = await (await handleOndcRequest(new Request('https://ondc.openmedia.test/ondc'), env))!.json() as { configured: boolean; signingPublicKey: string; bppUri: string };
  assert.equal(info.configured, true);
  assert.equal(info.signingPublicKey, seller.signingPublic);
  assert.equal(info.bppUri, 'https://ondc.openmedia.test/ondc');
  const page = await (await handleOndcRequest(new Request('https://ondc.openmedia.test/ondc-site-verification.html'), env))!.text();
  const signed = page.match(/content="([^"]+)"/)![1];
  const { ed25519 } = await import('@noble/curves/ed25519');
  assert.ok(ed25519.verify(Buffer.from(signed, 'base64'), new TextEncoder().encode('req-123'), Buffer.from(seller.signingPublic, 'base64')), 'the request_id is signed without hashing');

  // Pretend to be the registry, with a key pair of our own standing in for ONDC's pre-production key.
  const registryKeys = generateKeyPairSync('x25519');
  const crypto = await import('./crypto.js');
  (crypto.ondcRegistryKeys as { preprod: string }).preprod = registryKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const shared = diffieHellman({ privateKey: registryKeys.privateKey, publicKey: createPublicKey({ key: Buffer.from(seller.encryptionPublic, 'base64'), format: 'der', type: 'spki' }) });
  const cipher = createCipheriv('aes-256-ecb', shared, Buffer.alloc(0));
  const challenge = Buffer.concat([cipher.update('registry-challenge-42'), cipher.final()]).toString('base64');
  const answer = await handleOndcRequest(new Request('https://ondc.openmedia.test/ondc/on_subscribe', { method: 'POST', body: JSON.stringify({ subscriber_id: 'ondc.openmedia.test', challenge }) }), env);
  assert.deepEqual(await answer!.json(), { answer: 'registry-challenge-42' });

  const unconfigured = await handleOndcRequest(new Request('https://x.test/ondc/search', { method: 'POST', body: '{}' }), { SUPABASE_URL: 'http://db.test' });
  assert.equal(unconfigured!.status, 503);
  assert.equal(await handleOndcRequest(new Request('https://x.test/ondc-site-verification.html'), { SUPABASE_URL: 'http://db.test' }).then((r) => r!.status), 404);
});

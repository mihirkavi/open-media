/**
 * End-to-end check of the ONDC seller app against a real database (ADR 0015), usually the local
 * stack. A buyer app with fresh keys sends signed search and select requests to the real handler;
 * the registry lookup is simulated and the buyer app's callbacks are captured and verified, while
 * catalog and quote reads go to SUPABASE_URL with SUPABASE_SECRET_KEY. Prints counts and codes only.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=… npm run ondc:e2e -- std:080 ONDC:RET16
 */
import { authorizationHeader, generateOndcKeys, parseAuthorization, verifyAuthorization } from '../src/ondc/crypto.js';
import { handleOndcRequest, Lookup } from '../src/ondc/http.js';

const [city = 'std:080', domain = 'ONDC:RET16'] = process.argv.slice(2);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
const seller = generateOndcKeys(); const buyer = generateOndcKeys();
const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY, ONDC_SUBSCRIBER_ID: 'seller.e2e.test', ONDC_UNIQUE_KEY_ID: 's1', ONDC_SIGNING_PRIVATE_KEY: seller.signingPrivate, ONDC_ENCRYPTION_PRIVATE_KEY: seller.encryptionPrivate };
const lookup: Lookup = async (id) => (id === 'buyer.e2e.test' ? { signingPublicKey: buyer.signingPublic, subscriberUrl: 'https://buyer.e2e.test/ondc' } : undefined);

async function send(action: string, message: object) {
  const body = JSON.stringify({ context: { domain, country: 'IND', city, action, core_version: '1.2.0', bap_id: 'buyer.e2e.test', bap_uri: 'https://buyer.e2e.test/ondc', transaction_id: crypto.randomUUID(), message_id: crypto.randomUUID(), timestamp: new Date().toISOString(), ttl: 'PT30S' }, message });
  let callback: { body: string; authorization: string | null } | undefined;
  const capture = (async (input: string | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://buyer.e2e.test/')) { callback = { body: String(init?.body), authorization: new Headers(init?.headers).get('authorization') }; return new Response('{}'); }
    return fetch(input, init);
  }) as typeof fetch;
  const response = await handleOndcRequest(new Request(`https://seller.e2e.test/ondc/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeader(body, { subscriberId: 'buyer.e2e.test', uniqueKeyId: 'b1', privateKey: buyer.signingPrivate }) }, body }), env, { fetch: capture, lookup });
  const ack = (await response!.json() as { message: { ack: { status: string } } }).message.ack.status;
  const signed = callback ? verifyAuthorization(parseAuthorization(callback.authorization)!, callback.body, seller.signingPublic) : false;
  return { ack, signed, callback: callback ? JSON.parse(callback.body) : undefined };
}

const search = await send('search', { intent: { fulfillment: { type: 'Delivery' } } });
const providers = search.callback?.message?.catalog?.['bpp/providers'] ?? [];
console.log(`search: ${search.ack}, on_search signed: ${search.signed}, providers: ${providers.length}, items: ${providers.reduce((sum: number, p: { items: unknown[] }) => sum + p.items.length, 0)}`);
const first = providers[0];
if (first?.items?.length) {
  const select = await send('select', { order: { provider: { id: first.id, locations: [{ id: first.locations[0].id }] }, items: [{ id: first.items[0].id, location_id: first.locations[0].id, quantity: { count: 2 } }] } });
  console.log(`select: ${select.ack}, on_select signed: ${select.signed}, quote: ₹${select.callback?.message?.order?.quote?.price?.value}, error: ${select.callback?.error?.code ?? 'none'}`);
}
const confirm = await send('confirm', { order: {} });
console.log(`confirm: ${confirm.ack} (orders are phase 2)`);

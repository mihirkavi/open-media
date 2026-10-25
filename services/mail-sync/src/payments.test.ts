import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { privateKeyToAccount } from 'viem/accounts';

import { erc20TransferTopic, paymentChains, walletLinkMessage } from '../../../src/domain/payments';
import { availableChains, cardPaymentsConfigured, checkOnchainPayment, handlePaymentsWebhook, linkWallet, PaymentsEnv } from './payments.js';

const secret = 'whsec_payments';
const env: PaymentsEnv = { SUPABASE_URL: 'http://db.test', SUPABASE_SECRET_KEY: 'sb_secret_test', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PAYMENTS_WEBHOOK_SECRET: secret, BASE_SEPOLIA_RPC_URL: 'http://chain.test' };
const user = '6f1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d11';
const intentId = '9a1c2a0e-6b1d-4c39-9d7e-2f4b8a1c0d22';
const sign = (body: string, at = Math.floor(Date.now() / 1000)) => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
const payerKey = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const strangerKey = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const seller = '0xabcdef0000000000000000000000000000000001';
const txHash = `0x${'ab'.repeat(32)}`;

interface Call { url: string; body: Record<string, unknown> | string | undefined }

/** A fake network: Stripe, the database's service functions and a Base Sepolia node. */
function network(routes: { stripe?: (url: string) => object; rpc?: (name: string, body: Record<string, unknown>) => unknown; chain?: (method: string, params: unknown[]) => unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : undefined;
    const body = raw?.startsWith('{') ? JSON.parse(raw) as Record<string, unknown> : raw;
    calls.push({ url, body });
    if (url.startsWith('https://api.stripe.com')) return Response.json(routes.stripe?.(url) ?? {});
    if (url.startsWith('http://db.test/rest/v1/rpc/')) return Response.json(routes.rpc?.(url.split('/').pop()!, body as Record<string, unknown>) ?? null);
    if (url === 'http://chain.test') {
      const { method, params } = body as { method: string; params: unknown[] };
      return Response.json({ jsonrpc: '2.0', id: 1, result: routes.chain?.(method, params) ?? null });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { impl, calls, recorded: () => calls.filter((call) => call.url.endsWith('/open_media_record_payment_event')).map((call) => call.body as Record<string, unknown>) };
}

test('no live money until the owner turns it on', () => {
  assert.equal(cardPaymentsConfigured(env), true);
  assert.equal(cardPaymentsConfigured({ ...env, STRIPE_SECRET_KEY: 'sk_live_x' }), false);
  assert.equal(cardPaymentsConfigured({ ...env, STRIPE_SECRET_KEY: 'sk_live_x', PAYMENTS_LIVE: '1' }), true);
  assert.deepEqual(availableChains(env), ['base-sepolia']);
  assert.deepEqual(availableChains({ ...env, PAYMENTS_LIVE: '1' }), ['base', 'base-sepolia']);
  assert.deepEqual(availableChains({ SUPABASE_URL: 'x' }), []);
});

test('a wallet links only with a fresh signature from that wallet for this account', async () => {
  const now = Date.parse('2026-10-25T18:00:00.000Z');
  const message = walletLinkMessage(user, 'base-sepolia', payerKey.address, '2026-10-25T17:58:00.000Z');
  const signature = await payerKey.signMessage({ message });
  const ok = network({ rpc: () => ({ id: 'w1', chain: 'base-sepolia', address: payerKey.address.toLowerCase() }) });
  await linkWallet(env, user, { message, signature }, ok.impl, now);
  assert.deepEqual(ok.calls[0]?.body, { p_user: user, p_chain: 'base-sepolia', p_address: payerKey.address.toLowerCase() });

  const none = network({});
  await assert.rejects(linkWallet(env, '00000000-0000-4000-8000-000000000000', { message, signature }, none.impl, now), /not Open Media’s wallet message/);
  await assert.rejects(linkWallet(env, user, { message, signature: await strangerKey.signMessage({ message }) }, none.impl, now), /did not sign/);
  await assert.rejects(linkWallet(env, user, { message, signature }, none.impl, now + 20 * 60_000), /too old/);
  const mainnet = walletLinkMessage(user, 'base', payerKey.address, '2026-10-25T17:58:00.000Z');
  await assert.rejects(linkWallet(env, user, { message: mainnet, signature: await payerKey.signMessage({ message: mainnet }) }, none.impl, now), /not available/);
  assert.equal(none.calls.length, 0);
});

const cardDetails = { id: intentId, payerId: user, status: 'awaiting_payer', amountMinor: 2500, currency: 'USD', platformFeeMinor: 0, providerReference: 'cs_test_1', stripeAccountId: 'acct_test123', title: 'Desk' };
const completed = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid' } } });

test('a forged webhook is refused before anything is read', async () => {
  const fake = network({});
  await assert.rejects(handlePaymentsWebhook(env, completed, sign(completed).replace(/v1=./, 'v1=0'), fake.impl), /Signature check failed/);
  await assert.rejects(handlePaymentsWebhook(env, completed, null, fake.impl), /Signature check failed/);
  assert.equal(fake.calls.length, 0);
});

test('a card payment is confirmed only when Stripe itself says it was paid in full', async () => {
  const paid = network({ stripe: () => ({ id: 'cs_test_1', payment_status: 'paid', amount_total: 2500, currency: 'usd', metadata: { open_media_intent_id: intentId } }), rpc: (name) => name === 'open_media_card_payment_details' ? cardDetails : { changed: true } });
  assert.equal((await handlePaymentsWebhook(env, completed, sign(completed), paid.impl)).status, 'confirmed');
  assert.deepEqual(paid.recorded().map((call) => [call.p_status, call.p_source]), [['confirmed', 'stripe_webhook']]);

  const unpaid = network({ stripe: () => ({ id: 'cs_test_1', payment_status: 'unpaid', amount_total: 2500, currency: 'usd', metadata: { open_media_intent_id: intentId } }), rpc: () => cardDetails });
  await handlePaymentsWebhook(env, completed, sign(completed), unpaid.impl);
  assert.equal(unpaid.recorded().length, 0, 'the event body alone never confirms');

  const short = network({ stripe: () => ({ id: 'cs_test_1', payment_status: 'paid', amount_total: 100, currency: 'usd', metadata: { open_media_intent_id: intentId } }), rpc: () => cardDetails });
  await handlePaymentsWebhook(env, completed, sign(completed), short.impl);
  assert.equal(short.recorded().length, 0, 'a smaller amount is not this payment');
});

test('an expired old checkout does not fail a payment that moved to a new one', async () => {
  const expired = JSON.stringify({ id: 'evt_2', type: 'checkout.session.expired', data: { object: { id: 'cs_old' } } });
  const fake = network({ stripe: () => ({ id: 'cs_old', status: 'expired', payment_status: 'unpaid', metadata: { open_media_intent_id: intentId } }), rpc: () => cardDetails });
  await handlePaymentsWebhook(env, expired, sign(expired), fake.impl);
  assert.equal(fake.recorded().length, 0);
});

function chainWith(options: { from?: string; to?: string; amount?: bigint; status?: string; head?: number; chainId?: string; blockTime?: number }) {
  const pad = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
  return (method: string) => {
    if (method === 'eth_chainId') return options.chainId ?? '0x14a34';
    if (method === 'eth_blockNumber') return `0x${(options.head ?? 110).toString(16)}`;
    if (method === 'eth_getBlockByNumber') return { timestamp: `0x${Math.floor((options.blockTime ?? Date.parse('2026-10-25T18:05:00Z')) / 1000).toString(16)}` };
    if (method === 'eth_getTransactionReceipt') return {
      status: options.status ?? '0x1', blockNumber: '0x64',
      logs: [{ address: paymentChains['base-sepolia'].usdc, topics: [erc20TransferTopic, pad(options.from ?? payerKey.address), pad(options.to ?? seller)], data: `0x${(options.amount ?? 25_000_000n).toString(16).padStart(64, '0')}` }],
    };
    return null;
  };
}

const onchain = { id: intentId, payerId: user, status: 'submitted', chain: 'base-sepolia', amountMinor: 25_000_000, recipientAddress: seller, txHash, createdAt: '2026-10-25T18:00:00Z', payerAddresses: [payerKey.address.toLowerCase()] };

test('USDC is confirmed only from the chain: right token, sender, recipient, amount and depth', async () => {
  const good = network({ rpc: (name) => name === 'open_media_onchain_payment_check' ? onchain : { changed: true }, chain: chainWith({}) });
  assert.equal((await checkOnchainPayment(env, intentId, user, good.impl)).status, 'confirmed');
  assert.deepEqual(good.recorded().map((call) => [call.p_status, call.p_source]), [['confirmed', 'chain']]);

  const shallow = network({ rpc: () => onchain, chain: chainWith({ head: 100 }) });
  assert.equal((await checkOnchainPayment(env, intentId, user, shallow.impl)).status, 'submitted');
  assert.equal(shallow.recorded().length, 0);

  for (const [label, options] of [
    ['someone else’s wallet', { from: strangerKey.address }],
    ['a different recipient', { to: '0x1111111111111111111111111111111111111111' }],
    ['too little', { amount: 24_999_999n }],
    ['a reverted transaction', { status: '0x0' }],
    ['a transfer from before the payment started', { blockTime: Date.parse('2026-10-25T17:00:00Z') }],
  ] as const) {
    const bad = network({ rpc: (name) => name === 'open_media_onchain_payment_check' ? onchain : { changed: true }, chain: chainWith(options) });
    assert.equal((await checkOnchainPayment(env, intentId, user, bad.impl)).status, 'failed', label);
    assert.deepEqual(bad.recorded().map((call) => call.p_status), ['failed'], label);
  }

  const wrongNode = network({ rpc: () => onchain, chain: chainWith({ chainId: '0x2105' }) });
  await assert.rejects(checkOnchainPayment(env, intentId, user, wrongNode.impl), /misconfigured/);
  await assert.rejects(checkOnchainPayment(env, intentId, '00000000-0000-4000-8000-000000000000', good.impl), /not found/);
});

/**
 * Payments (ADR 0013, phase 5): Stripe Connect for cards and USDC on Base for wallets.
 *
 * Open Media never holds money. A card payment is a Stripe Checkout destination charge that pays
 * the seller's Express account; a USDC payment goes from the payer's wallet straight to the
 * seller's. A payment is confirmed only from evidence this Worker checked: a signed Stripe webhook
 * (re-read from Stripe), or the transaction read from the chain.
 *
 * Off until the operator sets STRIPE_SECRET_KEY, STRIPE_PAYMENTS_WEBHOOK_SECRET and
 * SUPABASE_SECRET_KEY (cards) or SUPABASE_SECRET_KEY alone (USDC on Base Sepolia). Live money is
 * refused until PAYMENTS_LIVE=1: a live Stripe key turns card payments off, and Base mainnet
 * stays unavailable.
 */
import { recoverMessageAddress } from 'viem';

import { erc20TransferTopic, isPaymentChain, parseWalletLinkMessage, PaymentChain, paymentChains } from '../../../src/domain/payments';
import { validStripeSignature } from './verification.js';

export interface PaymentsEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  /** Signing secret of the webhook endpoint for /v1/payments/stripe/webhook (platform events). */
  STRIPE_PAYMENTS_WEBHOOK_SECRET?: string;
  /** Signing secret of a Connect webhook endpoint (account.updated), when Stripe gives it its own. */
  STRIPE_CONNECT_WEBHOOK_SECRET?: string;
  /** Where Stripe sends people back, for example https://openmedia.app/. */
  PAYMENTS_RETURN_URL?: string;
  BASE_RPC_URL?: string;
  BASE_SEPOLIA_RPC_URL?: string;
  /** "1" only after the owner approves live keys and Base mainnet. */
  PAYMENTS_LIVE?: string;
}

type Fetch = typeof fetch;
const stripeApi = 'https://api.stripe.com/v1';
const linkMessageMaxAgeMs = 10 * 60 * 1000;

export class PaymentsError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function liveAllowed(env: PaymentsEnv): boolean {
  return env.PAYMENTS_LIVE === '1';
}

function stripeKeyIsLive(env: PaymentsEnv): boolean {
  return /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '');
}

export function cardPaymentsConfigured(env: PaymentsEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PAYMENTS_WEBHOOK_SECRET && env.SUPABASE_SECRET_KEY && (!stripeKeyIsLive(env) || liveAllowed(env)));
}

export function availableChains(env: PaymentsEnv): PaymentChain[] {
  if (!env.SUPABASE_SECRET_KEY) return [];
  return liveAllowed(env) ? ['base', 'base-sepolia'] : ['base-sepolia'];
}

/** What this server can do, for the app and agents. */
export function paymentsAvailability(env: PaymentsEnv) {
  return {
    card: cardPaymentsConfigured(env),
    cardTestMode: cardPaymentsConfigured(env) && !stripeKeyIsLive(env),
    chains: availableChains(env),
    live: liveAllowed(env),
    note: liveAllowed(env) ? 'Payments move real money.' : 'Test mode: Stripe test cards and USDC on Base Sepolia only. No real money moves.',
  };
}

function rpcUrl(env: PaymentsEnv, chain: PaymentChain): string {
  return chain === 'base' ? env.BASE_RPC_URL || 'https://mainnet.base.org' : env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
}

// ─── Stripe and the database (service role) ───────────────────────────────────

async function stripe<T>(env: PaymentsEnv, fetchImpl: Fetch, method: 'GET' | 'POST', path: string, form?: Record<string, string>, idempotencyKey?: string): Promise<T> {
  const response = await fetchImpl(`${stripeApi}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new PaymentsError(502, 'provider_error', 'Stripe did not accept the request. Try again shortly.');
  return body;
}

export async function serviceRpc<T = unknown>(env: PaymentsEnv, fetchImpl: Fetch, name: string, args: Record<string, unknown>): Promise<T> {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) throw new PaymentsError(503, 'not_configured', 'Payments are not available on this server yet.');
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = (() => { try { return JSON.parse(text) as { message?: string; code?: string }; } catch { return {}; } })();
    if (detail.code === '23505' || detail.code === '22023' || detail.code === '54000') throw new PaymentsError(409, 'refused', detail.message ?? 'Open Media refused that request.');
    if (detail.code === 'P0002') throw new PaymentsError(404, 'not_found', 'Payment not found.');
    throw new PaymentsError(502, 'storage_error', 'Could not record the payment.');
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ─── Receiving card payments: Stripe Connect Express ─────────────────────────

interface StripeAccount { id: string; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean; livemode?: boolean; metadata?: Record<string, string> }

async function saveAccount(env: PaymentsEnv, fetchImpl: Fetch, userId: string, account: StripeAccount) {
  await serviceRpc(env, fetchImpl, 'open_media_set_payment_account', {
    p_user: userId, p_stripe_account_id: account.id, p_charges_enabled: account.charges_enabled === true,
    p_payouts_enabled: account.payouts_enabled === true, p_details_submitted: account.details_submitted === true, p_livemode: account.livemode === true,
  });
}

/** Creates the person's Express account the first time, then returns a Stripe onboarding link. */
export async function startPayoutOnboarding(env: PaymentsEnv, userId: string, existingAccountId: string | null, fetchImpl: Fetch = fetch): Promise<{ url: string; accountId: string }> {
  if (!cardPaymentsConfigured(env)) throw new PaymentsError(503, 'not_configured', 'Card payments are not available on this server yet.');
  let accountId = existingAccountId;
  if (!accountId) {
    const account = await stripe<StripeAccount>(env, fetchImpl, 'POST', '/accounts', {
      type: 'express',
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
      'metadata[open_media_user_id]': userId,
    }, `open-media-account-${userId}`);
    await saveAccount(env, fetchImpl, userId, account);
    accountId = account.id;
  }
  const base = (env.PAYMENTS_RETURN_URL ?? '').replace(/\/$/, '') || 'https://openmedia.app';
  const link = await stripe<{ url: string }>(env, fetchImpl, 'POST', '/account_links', {
    account: accountId, type: 'account_onboarding',
    refresh_url: `${base}/#payments`, return_url: `${base}/#payments`,
  });
  return { url: link.url, accountId };
}

export async function refreshPayoutAccount(env: PaymentsEnv, userId: string, accountId: string, fetchImpl: Fetch = fetch): Promise<StripeAccount> {
  if (!cardPaymentsConfigured(env)) throw new PaymentsError(503, 'not_configured', 'Card payments are not available on this server yet.');
  const account = await stripe<StripeAccount>(env, fetchImpl, 'GET', `/accounts/${encodeURIComponent(accountId)}`);
  if (account.metadata?.open_media_user_id && account.metadata.open_media_user_id !== userId) throw new PaymentsError(403, 'refused', 'That Stripe account belongs to someone else.');
  await saveAccount(env, fetchImpl, userId, account);
  return account;
}

// ─── Paying by card: Stripe Checkout destination charges ─────────────────────

interface CardDetails { id: string; payerId: string; status: string; amountMinor: number; currency: string; platformFeeMinor: number; providerReference: string | null; stripeAccountId: string | null; title: string }
interface CheckoutSession { id: string; url?: string | null; status?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string>; payment_intent?: string | null; livemode?: boolean }

/** Returns Stripe's hosted page for this payment. Card details are typed only on Stripe's page. */
export async function startCardCheckout(env: PaymentsEnv, intentId: string, payerId: string, fetchImpl: Fetch = fetch): Promise<{ checkoutUrl: string }> {
  if (!cardPaymentsConfigured(env)) throw new PaymentsError(503, 'not_configured', 'Card payments are not available on this server yet.');
  const details = await serviceRpc<CardDetails | null>(env, fetchImpl, 'open_media_card_payment_details', { p_intent_id: intentId });
  if (!details || details.payerId !== payerId) throw new PaymentsError(404, 'not_found', 'Payment not found.');
  if (!['created', 'awaiting_payer'].includes(details.status)) throw new PaymentsError(409, 'refused', 'This payment is already finished.');
  if (!details.stripeAccountId) throw new PaymentsError(409, 'refused', 'This seller does not accept card payments right now.');
  if (details.providerReference) {
    const existing = await stripe<CheckoutSession>(env, fetchImpl, 'GET', `/checkout/sessions/${encodeURIComponent(details.providerReference)}`);
    if (existing.status === 'open' && existing.url) return { checkoutUrl: existing.url };
  }
  const base = (env.PAYMENTS_RETURN_URL ?? '').replace(/\/$/, '') || 'https://openmedia.app';
  const session = await stripe<CheckoutSession>(env, fetchImpl, 'POST', '/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': details.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(details.amountMinor),
    'line_items[0][price_data][product_data][name]': details.title.slice(0, 120) || 'Open Media payment',
    'payment_intent_data[transfer_data][destination]': details.stripeAccountId,
    ...(details.platformFeeMinor > 0 ? { 'payment_intent_data[application_fee_amount]': String(details.platformFeeMinor) } : {}),
    'payment_intent_data[metadata][open_media_intent_id]': details.id,
    'metadata[open_media_intent_id]': details.id,
    client_reference_id: details.id,
    success_url: `${base}/#payments`,
    cancel_url: `${base}/#payments`,
  }, `open-media-checkout-${details.id}-${details.providerReference ?? 'first'}`);
  if (!session.url) throw new PaymentsError(502, 'provider_error', 'Stripe did not return a payment page.');
  await serviceRpc(env, fetchImpl, 'open_media_record_payment_event', {
    p_intent_id: details.id, p_status: 'awaiting_payer', p_source: 'server', p_provider_reference: session.id, p_evidence: { checkoutSession: session.id },
  });
  return { checkoutUrl: session.url };
}

/** Handles one signed Stripe webhook. Each event is re-read from Stripe before it changes anything. */
export async function handlePaymentsWebhook(env: PaymentsEnv, body: string, signature: string | null, fetchImpl: Fetch = fetch, nowSeconds?: number): Promise<{ received: true; status?: string }> {
  if (!cardPaymentsConfigured(env)) throw new PaymentsError(503, 'not_configured', 'Card payments are not available on this server yet.');
  const secrets = [env.STRIPE_PAYMENTS_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((secret): secret is string => Boolean(secret));
  if (!secrets.some((secret) => validStripeSignature(body, signature, secret, nowSeconds))) throw new PaymentsError(400, 'bad_signature', 'Signature check failed.');
  const event = JSON.parse(body) as { id?: string; type?: string; data?: { object?: { id?: string; payment_intent?: string; refunded?: boolean } } };
  const object = event.data?.object;
  if (!object?.id) return { received: true };

  if (event.type === 'account.updated') {
    const account = await stripe<StripeAccount>(env, fetchImpl, 'GET', `/accounts/${encodeURIComponent(object.id)}`);
    const userId = account.metadata?.open_media_user_id;
    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) await saveAccount(env, fetchImpl, userId, account);
    return { received: true };
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded'
    || event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const session = await stripe<CheckoutSession>(env, fetchImpl, 'GET', `/checkout/sessions/${encodeURIComponent(object.id)}`);
    const intentId = session.metadata?.open_media_intent_id;
    if (!intentId) return { received: true };
    const details = await serviceRpc<CardDetails | null>(env, fetchImpl, 'open_media_card_payment_details', { p_intent_id: intentId });
    if (!details) return { received: true };
    if (session.livemode && !liveAllowed(env)) return { received: true };
    let status: 'confirmed' | 'failed' | undefined;
    if (session.payment_status === 'paid' && session.amount_total === details.amountMinor && session.currency?.toUpperCase() === details.currency) status = 'confirmed';
    else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') status = 'failed';
    if (!status) return { received: true };
    // An expired old session must not fail a payment that moved to a newer one.
    if (status === 'failed' && details.providerReference && details.providerReference !== session.id) return { received: true };
    await serviceRpc(env, fetchImpl, 'open_media_record_payment_event', {
      p_intent_id: intentId, p_status: status, p_source: 'stripe_webhook', p_provider_reference: session.id,
      p_evidence: { event: event.id ?? null, checkoutSession: session.id, paymentIntent: session.payment_intent ?? null, amountTotal: session.amount_total ?? null },
    });
    return { received: true, status };
  }

  if (event.type === 'charge.refunded' && object.payment_intent) {
    const intent = await stripe<{ id: string; metadata?: Record<string, string>; latest_charge?: { refunded?: boolean } | string | null }>(env, fetchImpl, 'GET', `/payment_intents/${encodeURIComponent(object.payment_intent)}?expand[]=latest_charge`);
    const intentId = intent.metadata?.open_media_intent_id;
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (!intentId || charge?.refunded !== true) return { received: true };
    await serviceRpc(env, fetchImpl, 'open_media_record_payment_event', {
      p_intent_id: intentId, p_status: 'refunded', p_source: 'stripe_webhook', p_evidence: { event: event.id ?? null, paymentIntent: intent.id },
    });
    return { received: true, status: 'refunded' };
  }
  return { received: true };
}

// ─── Wallets ─────────────────────────────────────────────────────────────────

/** Links a wallet after checking the person signed Open Media's message with it, just now. */
export async function linkWallet(env: PaymentsEnv, userId: string, input: { message?: unknown; signature?: unknown }, fetchImpl: Fetch = fetch, now = Date.now()) {
  if (typeof input.message !== 'string' || typeof input.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) {
    throw new PaymentsError(400, 'bad_request', 'Send the signed message and its signature.');
  }
  const parsed = parseWalletLinkMessage(input.message);
  if (!parsed || parsed.userId !== userId) throw new PaymentsError(400, 'bad_request', 'That is not Open Media’s wallet message for this account.');
  if (!availableChains(env).includes(parsed.chain)) throw new PaymentsError(409, 'refused', `${paymentChains[parsed.chain].name} payments are not available on this server.`);
  const issued = Date.parse(parsed.issuedAt);
  if (!Number.isFinite(issued) || now - issued > linkMessageMaxAgeMs || issued - now > 60_000) throw new PaymentsError(400, 'expired', 'The signed message is too old. Sign a new one.');
  let signer: string;
  try { signer = (await recoverMessageAddress({ message: input.message, signature: input.signature as `0x${string}` })).toLowerCase(); }
  catch { throw new PaymentsError(400, 'bad_signature', 'The signature could not be checked.'); }
  if (signer !== parsed.address) throw new PaymentsError(400, 'bad_signature', 'This wallet did not sign the message.');
  return serviceRpc(env, fetchImpl, 'open_media_add_wallet', { p_user: userId, p_chain: parsed.chain, p_address: parsed.address });
}

// ─── Paying with USDC: reading the chain ─────────────────────────────────────

interface OnchainCheck { id: string; payerId: string; status: string; chain: string; amountMinor: number; recipientAddress: string; txHash: string | null; createdAt: string; payerAddresses: string[] }
interface Receipt { status?: string; blockNumber?: string; logs?: { address: string; topics: string[]; data: string }[] }

async function chainRpc<T>(env: PaymentsEnv, chain: PaymentChain, fetchImpl: Fetch, method: string, params: unknown[]): Promise<T> {
  const response = await fetchImpl(rpcUrl(env, chain), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json().catch(() => ({})) as { result?: T; error?: unknown };
  if (!response.ok || body.error !== undefined) throw new PaymentsError(502, 'chain_unavailable', 'Could not reach the network. Try again shortly.');
  return body.result as T;
}

function topicAddress(topic: string | undefined): string {
  return topic ? `0x${topic.slice(-40)}`.toLowerCase() : '';
}

/**
 * Checks the payer's transaction on the chain: it succeeded, it is a USDC transfer from one of the
 * payer's own verified wallets to the seller's address for at least the amount, it happened after
 * the payment was started, and enough blocks have followed it. Only then is the payment confirmed.
 */
export async function checkOnchainPayment(env: PaymentsEnv, intentId: string, payerId: string, fetchImpl: Fetch = fetch): Promise<{ status: string; detail: string }> {
  const intent = await serviceRpc<OnchainCheck | null>(env, fetchImpl, 'open_media_onchain_payment_check', { p_intent_id: intentId });
  if (!intent || intent.payerId !== payerId) throw new PaymentsError(404, 'not_found', 'Payment not found.');
  if (intent.status === 'confirmed') return { status: 'confirmed', detail: 'Paid.' };
  if (intent.status !== 'submitted' || !intent.txHash) return { status: intent.status, detail: 'Send the transaction hash first.' };
  if (!isPaymentChain(intent.chain) || !availableChains(env).includes(intent.chain)) throw new PaymentsError(409, 'refused', 'Payments on this network are not available on this server.');
  const chain = paymentChains[intent.chain];
  const chainId = await chainRpc<string>(env, intent.chain, fetchImpl, 'eth_chainId', []);
  if (Number(chainId) !== chain.chainId) throw new PaymentsError(502, 'chain_unavailable', 'The network endpoint is misconfigured.');
  const receipt = await chainRpc<Receipt | null>(env, intent.chain, fetchImpl, 'eth_getTransactionReceipt', [intent.txHash]);
  if (!receipt?.blockNumber) return { status: 'submitted', detail: 'The transaction is not in a block yet.' };

  const fail = async (reason: string) => {
    await serviceRpc(env, fetchImpl, 'open_media_record_payment_event', { p_intent_id: intent.id, p_status: 'failed', p_source: 'chain', p_evidence: { txHash: intent.txHash, reason } });
    return { status: 'failed', detail: reason };
  };
  if (receipt.status !== '0x1') return fail('The transaction failed on the network.');
  const payers = new Set(intent.payerAddresses.map((address) => address.toLowerCase()));
  const paid = (receipt.logs ?? []).some((log) => log.address.toLowerCase() === chain.usdc
    && log.topics[0]?.toLowerCase() === erc20TransferTopic
    && payers.has(topicAddress(log.topics[1]))
    && topicAddress(log.topics[2]) === intent.recipientAddress.toLowerCase()
    && BigInt(log.data) >= BigInt(intent.amountMinor));
  if (!paid) {
    return fail(payers.size
      ? 'This transaction does not send the full amount of USDC from your linked wallet to the seller.'
      : 'Link the wallet you paid from first, so Open Media can tell the payment is yours.');
  }
  const block = await chainRpc<{ timestamp: string } | null>(env, intent.chain, fetchImpl, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block || Number(block.timestamp) * 1000 < Date.parse(intent.createdAt) - 60_000) return fail('This transaction happened before the payment was started.');
  const head = await chainRpc<string>(env, intent.chain, fetchImpl, 'eth_blockNumber', []);
  const depth = Number(BigInt(head) - BigInt(receipt.blockNumber)) + 1;
  if (depth < chain.confirmations) return { status: 'submitted', detail: `Waiting for the network to settle (${depth} of ${chain.confirmations} blocks).` };
  await serviceRpc(env, fetchImpl, 'open_media_record_payment_event', {
    p_intent_id: intent.id, p_status: 'confirmed', p_source: 'chain', p_provider_reference: intent.txHash,
    p_evidence: { txHash: intent.txHash, block: receipt.blockNumber, chainId: chain.chainId },
  });
  return { status: 'confirmed', detail: 'Paid.' };
}


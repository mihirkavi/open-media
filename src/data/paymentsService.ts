import { request } from '../connectors/mailApiConnector';
import { OnchainTransfer, Payment, PaymentChain, PaymentContextType, PaymentRail } from '../domain/payments';

/**
 * Payments through the Open Media service (ADR 0013, phase 5). The service creates Stripe
 * checkout pages and reads the chain; the database decides who is paid and how much.
 */
export interface PaymentSetup {
  card: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; livemode: boolean } | null;
  wallets: { id: string; chain: PaymentChain; address: string; verifiedAt: string }[];
  fees: Record<string, number>;
  tipsEnabled: boolean;
  available: { card: boolean; cardTestMode: boolean; chains: PaymentChain[]; live: boolean; note: string };
}

export interface PaymentOptions { card: boolean; chains: PaymentChain[]; priceMinor: number | null; currency: string; available: boolean; platformFeeBps: number; testMode: boolean }
export type PaymentWithTransfer = Payment & { transfer?: OnchainTransfer };

export function loadPaymentSetup(): Promise<PaymentSetup> {
  return request<PaymentSetup>('/v1/me/payments/setup', {}, 'Could not load your payment settings.');
}

export function startPayouts(): Promise<{ url: string }> {
  return request<{ url: string }>('/v1/me/payments/payouts', { method: 'POST', body: {} }, 'Stripe setup could not start.');
}

export function refreshPayouts(): Promise<PaymentSetup> {
  return request<PaymentSetup>('/v1/me/payments/payouts/refresh', { method: 'POST', body: {} }, 'Could not check with Stripe.');
}

export function linkWallet(message: string, signature: string): Promise<{ id: string }> {
  return request<{ id: string }>('/v1/me/wallets', { method: 'POST', body: { message, signature } }, 'The wallet could not be linked.');
}

export async function removeWallet(id: string): Promise<void> {
  await request(`/v1/me/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'The wallet could not be removed.');
}

export function loadPaymentOptions(postId: string): Promise<PaymentOptions> {
  return request<PaymentOptions>(`/v1/me/listings/${encodeURIComponent(postId)}/payment-options`, {}, 'Payment options are unavailable right now.');
}

export async function loadMyPayments(): Promise<Payment[]> {
  const result = await request<Payment[]>('/v1/me/payments', {}, 'Could not load your payments.');
  return Array.isArray(result) ? result : [];
}

export interface PostPaymentOptions { card: boolean; chains: PaymentChain[]; tipsEnabled: boolean; paid: { priceMinor: number; currency: string; unlocked: boolean } | null; fees: Record<string, number>; testMode: boolean }

export function loadPostPaymentOptions(postId: string): Promise<PostPaymentOptions> {
  return request<PostPaymentOptions>(`/v1/me/posts/${encodeURIComponent(postId)}/payment-options`, {}, 'Payment options are unavailable right now.');
}

/** Starts paying for a listing, a tip (the one amount the payer chooses) or a paid post. */
export function payFor(contextType: PaymentContextType, postId: string, rail: PaymentRail, chain: PaymentChain | null, idempotencyKey: string, amountMinor?: number): Promise<{ payment: PaymentWithTransfer; checkoutUrl?: string }> {
  return request('/v1/me/payments', { method: 'POST', body: { contextType, contextId: postId, rail, ...(chain ? { chain } : {}), idempotencyKey, ...(contextType === 'tip' ? { amountMinor } : {}) } }, 'The payment could not start.');
}

export function setTipsEnabled(enabled: boolean): Promise<{ tipsEnabled: boolean }> {
  return request('/v1/me/payments/tips', { method: 'PUT', body: { enabled } }, 'Could not change tips.');
}

export function loadPaidContent(postId: string): Promise<{ priceMinor: number; currency: string; unlocked: boolean; body: string | null }> {
  return request(`/v1/me/posts/${encodeURIComponent(postId)}/paid`, {}, 'Could not load the post.');
}

export function submitTransaction(paymentId: string, txHash: string): Promise<{ payment: PaymentWithTransfer; detail?: string }> {
  return request(`/v1/me/payments/${encodeURIComponent(paymentId)}/transaction`, { method: 'POST', body: { txHash } }, 'Could not check the transaction.');
}

export function checkPayment(paymentId: string): Promise<{ payment: PaymentWithTransfer; detail?: string }> {
  return request(`/v1/me/payments/${encodeURIComponent(paymentId)}/check`, { method: 'POST', body: {} }, 'Could not check the payment.');
}

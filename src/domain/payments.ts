/**
 * Payments shared by the app and the Worker (ADR 0013, phase 5). Open Media never holds money:
 * cards go through Stripe to the seller's Stripe account, and USDC goes wallet to wallet on Base.
 * Status only moves forward from evidence the server checked; this file only describes, formats
 * and encodes.
 */

export type PaymentChain = 'base' | 'base-sepolia';
export type PaymentRail = 'card' | 'onchain';
export type PaymentStatus = 'created' | 'awaiting_payer' | 'submitted' | 'confirmed' | 'failed' | 'refunded';
export type PaymentContextType = 'listing' | 'tip' | 'paid_post';

export interface ChainInfo {
  id: PaymentChain;
  name: string;
  chainId: number;
  /** Circle's USDC contract on this chain (6 decimals), checked against the chain on 2026-10-25. */
  usdc: string;
  explorer: string;
  /** Blocks after the payment's block before the Worker treats it as final. */
  confirmations: number;
  testnet: boolean;
}

export const paymentChains: Record<PaymentChain, ChainInfo> = {
  'base-sepolia': { id: 'base-sepolia', name: 'Base Sepolia (test network)', chainId: 84532, usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', explorer: 'https://sepolia.basescan.org', confirmations: 2, testnet: true },
  base: { id: 'base', name: 'Base', chainId: 8453, usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', explorer: 'https://basescan.org', confirmations: 6, testnet: false },
};

export const usdcDecimals = 6;
/** keccak256("Transfer(address,address,uint256)") */
export const erc20TransferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface Payment {
  id: string;
  direction: 'sent' | 'received';
  payer: string | null;
  recipient: string | null;
  amountMinor: number;
  currency: string;
  rail: PaymentRail;
  provider: 'stripe' | PaymentChain;
  context: { type: PaymentContextType; id: string; title: string | null };
  platformFeeMinor: number;
  providerFeeEstimateMinor: number | null;
  status: PaymentStatus;
  recipientAddress: string | null;
  txHash: string | null;
  createdAt: string;
  confirmedAt: string | null;
  events: { status: PaymentStatus; source: string; at: string }[];
}

export function isPaymentChain(value: unknown): value is PaymentChain {
  return value === 'base' || value === 'base-sepolia';
}

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Money in words people read: "$25.00", "€9.50", "25.00 USDC". */
export function formatMoney(amountMinor: number, currency: string): string {
  if (currency === 'USDC') {
    const whole = amountMinor / 10 ** usdcDecimals;
    return `${whole.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`;
  }
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100); }
  catch { return `${(amountMinor / 100).toFixed(2)} ${currency}`; }
}

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  created: 'Started',
  awaiting_payer: 'Waiting for payment',
  submitted: 'Checking the payment',
  confirmed: 'Paid',
  failed: 'Not paid',
  refunded: 'Refunded',
};

/** Stripe's standard US card fee (2.9% + 30¢), the same estimate the database stores. */
export function cardFeeEstimateMinor(amountMinor: number, currency: string): number | null {
  return currency === 'USD' ? Math.ceil(amountMinor * 0.029) + 30 : null;
}

/** The price of a listing as it would be charged on each rail, before any payment exists. */
export function listingCharge(priceMinor: number, currency: string, rail: PaymentRail, chain: PaymentChain | null, platformFeeBps: number) {
  if (rail === 'onchain') return { amountMinor: priceMinor * 10 ** (usdcDecimals - 2), currency: 'USDC', rail, provider: chain ?? 'base-sepolia', platformFeeMinor: 0, providerFeeEstimateMinor: null };
  return { amountMinor: priceMinor, currency, rail, provider: 'stripe' as const, platformFeeMinor: Math.floor((priceMinor * platformFeeBps) / 10000), providerFeeEstimateMinor: cardFeeEstimateMinor(priceMinor, currency) };
}

/**
 * What the confirmation sheet shows before anyone pays: who gets it, how much, Open Media's fee
 * and the provider's. Card fees are an estimate of Stripe's standard rate; on-chain network fees
 * are paid by the payer's wallet and shown there.
 */
export function paymentBreakdown(payment: Pick<Payment, 'amountMinor' | 'currency' | 'rail' | 'provider' | 'platformFeeMinor' | 'providerFeeEstimateMinor' | 'recipient'>) {
  const lines = [
    { label: 'To', value: payment.recipient ? `@${payment.recipient}` : 'the seller' },
    { label: 'Amount', value: formatMoney(payment.amountMinor, payment.currency) },
    { label: 'Open Media fee', value: payment.platformFeeMinor ? formatMoney(payment.platformFeeMinor, payment.currency) : 'None' },
  ];
  if (payment.rail === 'card') {
    lines.push({ label: 'Card processing (paid by the seller)', value: payment.providerFeeEstimateMinor !== null ? `About ${formatMoney(payment.providerFeeEstimateMinor, payment.currency)}` : 'Set by Stripe' });
    lines.push({ label: 'Paid with', value: 'Card, on Stripe’s secure page' });
  } else {
    const chain = isPaymentChain(payment.provider) ? paymentChains[payment.provider] : undefined;
    lines.push({ label: 'Network fee', value: 'Shown by your wallet' });
    lines.push({ label: 'Paid with', value: `USDC on ${chain?.name ?? 'Base'}, from your wallet` });
  }
  return lines;
}

/**
 * The message a wallet signs to prove its owner links it to this Open Media account. The Worker
 * rebuilds it, checks the time and recovers the signer; nothing else is accepted.
 */
export function walletLinkMessage(userId: string, chain: PaymentChain, address: string, issuedAt: string): string {
  return [
    'Link this wallet to Open Media',
    '',
    'Signing proves you control this wallet. It costs nothing and does not allow any payment.',
    '',
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Network: ${paymentChains[chain].name}`,
    `Issued: ${issuedAt}`,
  ].join('\n');
}

export function parseWalletLinkMessage(message: string): { userId: string; address: string; chain: PaymentChain; issuedAt: string } | undefined {
  const field = (name: string) => message.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1]?.trim();
  const userId = field('Account');
  const address = field('Wallet');
  const network = field('Network');
  const issuedAt = field('Issued');
  const chain = (Object.keys(paymentChains) as PaymentChain[]).find((id) => paymentChains[id].name === network);
  if (!userId || !address || !chain || !issuedAt || !isAddress(address)) return undefined;
  if (message !== walletLinkMessage(userId, chain, address, issuedAt)) return undefined;
  return { userId, address: address.toLowerCase(), chain, issuedAt };
}

/** Calldata for USDC's transfer(to, amount): the payer's wallet sends it straight to the seller. */
export function erc20TransferData(to: string, amount: bigint): string {
  if (!isAddress(to)) throw new Error('Not a wallet address.');
  if (amount <= 0n) throw new Error('Amount must be positive.');
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`;
}

export interface OnchainTransfer {
  chain: PaymentChain;
  chainId: number;
  token: string;
  to: string;
  amount: string;
  data: string;
}

export function onchainTransfer(payment: Pick<Payment, 'provider' | 'recipientAddress' | 'amountMinor'>): OnchainTransfer | undefined {
  if (!isPaymentChain(payment.provider) || !payment.recipientAddress) return undefined;
  const chain = paymentChains[payment.provider];
  const amount = BigInt(payment.amountMinor);
  return { chain: chain.id, chainId: chain.chainId, token: chain.usdc, to: payment.recipientAddress, amount: amount.toString(), data: erc20TransferData(payment.recipientAddress, amount) };
}

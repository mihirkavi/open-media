import assert from 'node:assert/strict';
import test from 'node:test';

import { erc20TransferData, formatMoney, listingCharge, onchainTransfer, parseWalletLinkMessage, paymentBreakdown, walletLinkMessage } from './payments';

const user = '0b6f2a9e-1c51-4d6c-9c4b-5f2d3c1a7e10';
const wallet = '0xAbCdEf0000000000000000000000000000000001';

test('money reads the way people expect', () => {
  assert.equal(formatMoney(2500, 'USD'), '$25.00');
  assert.equal(formatMoney(25_000_000, 'USDC'), '25.00 USDC');
  assert.equal(formatMoney(1_500_001, 'USDC'), '1.500001 USDC');
});

test('a wallet link message round-trips and rejects edits', () => {
  const message = walletLinkMessage(user, 'base-sepolia', wallet, '2026-10-25T18:00:00.000Z');
  assert.deepEqual(parseWalletLinkMessage(message), { userId: user, address: wallet.toLowerCase(), chain: 'base-sepolia', issuedAt: '2026-10-25T18:00:00.000Z' });
  assert.equal(parseWalletLinkMessage(message.replace('does not allow', 'allows')), undefined);
  assert.equal(parseWalletLinkMessage(message.replace('Base Sepolia (test network)', 'Ethereum')), undefined);
});

test('USDC transfer calldata matches transfer(address,uint256)', () => {
  assert.equal(
    erc20TransferData(wallet, 25_000_000n),
    // Same as viem's encodeFunctionData for transfer(address,uint256).
    '0xa9059cbb000000000000000000000000abcdef000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000017d7840',
  );
  assert.throws(() => erc20TransferData('0x1234', 1n));
  assert.throws(() => erc20TransferData(wallet, 0n));
});

test('an on-chain payment becomes a transfer to the seller on the right chain', () => {
  const transfer = onchainTransfer({ provider: 'base-sepolia', recipientAddress: wallet.toLowerCase(), amountMinor: 25_000_000 });
  assert.equal(transfer?.chainId, 84532);
  assert.equal(transfer?.token, '0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  assert.equal(transfer?.amount, '25000000');
  assert.equal(onchainTransfer({ provider: 'stripe', recipientAddress: null, amountMinor: 2500 }), undefined);
});

test('the confirmation sheet names the recipient, the amount and every fee', () => {
  const lines = paymentBreakdown({ amountMinor: 2500, currency: 'USD', rail: 'card', provider: 'stripe', platformFeeMinor: 0, providerFeeEstimateMinor: 103, recipient: 'seller' });
  assert.deepEqual(lines.map((line) => line.value).slice(0, 4), ['@seller', '$25.00', 'None', 'About $1.03']);
});

test('the preview charges what the database will: cents by card, USDC base units on-chain', () => {
  assert.deepEqual(listingCharge(2500, 'USD', 'card', null, 0), { amountMinor: 2500, currency: 'USD', rail: 'card', provider: 'stripe', platformFeeMinor: 0, providerFeeEstimateMinor: 103 });
  assert.equal(listingCharge(2500, 'USD', 'onchain', 'base-sepolia', 500).amountMinor, 25_000_000);
  assert.equal(listingCharge(2500, 'USD', 'onchain', 'base-sepolia', 500).platformFeeMinor, 0, 'no Open Media fee wallet to wallet');
  assert.equal(listingCharge(2500, 'EUR', 'card', null, 500).providerFeeEstimateMinor, null);
  assert.equal(listingCharge(2500, 'EUR', 'card', null, 500).platformFeeMinor, 125);
});

import { Platform } from 'react-native';

import { OnchainTransfer, PaymentChain, paymentChains, walletLinkMessage } from '../../domain/payments';

/**
 * The person's own browser wallet (MetaMask, Coinbase Wallet, Rabby…), found through EIP-6963 with
 * window.ethereum as a fallback. Open Media never sees keys or seed phrases: the wallet shows every
 * signature and transfer to the person, who approves or declines it there. Web only for now; phones
 * need WalletConnect, which needs Open Media's own project id.
 */
interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
interface Announced { info: { name: string; rdns: string }; provider: Eip1193 }

export class WalletError extends Error {}

export function browserWalletsSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

async function discover(): Promise<{ name: string; provider: Eip1193 } | undefined> {
  if (!browserWalletsSupported()) return undefined;
  const found: Announced[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<Announced>).detail;
    if (detail?.provider && !found.some((item) => item.info.rdns === detail.info?.rdns)) found.push(detail);
  };
  window.addEventListener('eip6963:announceProvider', listener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.removeEventListener('eip6963:announceProvider', listener);
  if (found[0]) return { name: found[0].info.name, provider: found[0].provider };
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return injected ? { name: 'your browser wallet', provider: injected } : undefined;
}

export interface ConnectedWallet { name: string; address: string; provider: Eip1193 }

export async function connectBrowserWallet(): Promise<ConnectedWallet> {
  const wallet = await discover();
  if (!wallet) throw new WalletError(browserWalletsSupported() ? 'No browser wallet found. Install one (for example Coinbase Wallet or MetaMask) and try again.' : 'Wallets work in the web app for now.');
  const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }).catch(() => { throw new WalletError('The wallet didn’t connect.'); }) as string[];
  if (!accounts?.[0]) throw new WalletError('Your wallet didn’t share an address.');
  return { name: wallet.name, address: accounts[0].toLowerCase(), provider: wallet.provider };
}

function utf8Hex(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Asks the wallet to sign Open Media's link message, proving the person controls it. Costs nothing. */
export async function signWalletLink(wallet: ConnectedWallet, userId: string, chain: PaymentChain): Promise<{ message: string; signature: string }> {
  const message = walletLinkMessage(userId, chain, wallet.address, new Date().toISOString());
  const signature = await wallet.provider.request({ method: 'personal_sign', params: [utf8Hex(message), wallet.address] })
    .catch(() => { throw new WalletError('The signature was declined in your wallet.'); }) as string;
  return { message, signature };
}

async function useChain(wallet: ConnectedWallet, chain: PaymentChain): Promise<void> {
  const info = paymentChains[chain];
  const chainId = `0x${info.chainId.toString(16)}`;
  try {
    await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw new WalletError(`Switch your wallet to ${info.name} and try again.`);
    await wallet.provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId, chainName: info.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: [chain === 'base' ? 'https://mainnet.base.org' : 'https://sepolia.base.org'], blockExplorerUrls: [info.explorer],
    }] }).catch(() => { throw new WalletError(`Add ${info.name} to your wallet and try again.`); });
  }
}

/** Sends the USDC transfer the server described, from the person's wallet straight to the seller. */
export async function sendUsdcTransfer(wallet: ConnectedWallet, transfer: OnchainTransfer): Promise<string> {
  await useChain(wallet, transfer.chain);
  const hash = await wallet.provider.request({ method: 'eth_sendTransaction', params: [{ from: wallet.address, to: transfer.token, data: transfer.data, value: '0x0' }] })
    .catch(() => { throw new WalletError('The payment was declined in your wallet.'); }) as string;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new WalletError('Your wallet didn’t return a transaction.');
  return hash.toLowerCase();
}

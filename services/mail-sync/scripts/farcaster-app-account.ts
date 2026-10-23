/**
 * Sets up Open Media's own Farcaster account (the "app FID") that signs key requests, so people can
 * connect Farcaster for cross-posting. Run it yourself, step by step:
 *
 *   npx tsx scripts/farcaster-app-account.ts create     # new custody wallet, saved in macOS Keychain
 *   npx tsx scripts/farcaster-app-account.ts status     # address, ETH balance, registration price, FID
 *   npx tsx scripts/farcaster-app-account.ts register   # pays the IdGateway price from that wallet (you send ETH to it first)
 *   npx tsx scripts/farcaster-app-account.ts secrets    # stores FARCASTER_APP_FID and FARCASTER_APP_MNEMONIC on the Worker
 *
 * The mnemonic never prints and never touches the repository: it lives in the Keychain item
 * `open-media-farcaster-app` and goes to the Worker through `wrangler secret put` on stdin.
 * Contracts: https://docs.farcaster.xyz/reference/contracts/deployments (OP Mainnet).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, formatEther, http, parseAbi } from 'viem';
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import { optimism } from 'viem/chains';

const keychainService = 'open-media-farcaster-app';
const idGateway = '0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69' as const;
const idRegistry = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b' as const;
const gatewayAbi = parseAbi(['function price() view returns (uint256)', 'function register(address recovery) payable returns (uint256 fid, uint256 overpayment)']);
const registryAbi = parseAbi(['function idOf(address owner) view returns (uint256)']);
const rpc = http(process.env.OPTIMISM_RPC_URL ?? 'https://mainnet.optimism.io');
const publicClient = createPublicClient({ chain: optimism, transport: rpc });

function readMnemonic(): string | undefined {
  try { return execFileSync('security', ['find-generic-password', '-s', keychainService, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; }
}

function requireMnemonic(): string {
  const mnemonic = readMnemonic();
  if (!mnemonic) throw new Error(`No app wallet yet. Run: npx tsx scripts/farcaster-app-account.ts create`);
  return mnemonic;
}

async function status() {
  const account = mnemonicToAccount(requireMnemonic());
  const [balance, price, fid] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: idGateway, abi: gatewayAbi, functionName: 'price' }),
    publicClient.readContract({ address: idRegistry, abi: registryAbi, functionName: 'idOf', args: [account.address] }),
  ]);
  console.log(`Custody address (OP Mainnet): ${account.address}`);
  console.log(`Balance: ${formatEther(balance)} ETH · Registration price: ${formatEther(price)} ETH (plus a little gas)`);
  console.log(fid > 0n ? `Registered FID: ${fid}` : 'Not registered yet. Send at least the price plus ~0.0005 ETH on OP Mainnet to the address above, then run register.');
  return { account, balance, price, fid };
}

async function main() {
  const command = process.argv[2];
  if (command === 'create') {
    if (readMnemonic()) throw new Error('An app wallet already exists in the Keychain; refusing to replace it.');
    const mnemonic = generateMnemonic(english);
    execFileSync('security', ['add-generic-password', '-s', keychainService, '-a', 'custody', '-w', mnemonic]);
    console.log(`Created and saved to Keychain item "${keychainService}". Address: ${mnemonicToAccount(mnemonic).address}`);
    return;
  }
  if (command === 'status') { await status(); return; }
  if (command === 'register') {
    const { account, balance, price, fid } = await status();
    if (fid > 0n) { console.log('Already registered; nothing to do.'); return; }
    if (balance <= price) throw new Error('Not enough ETH on OP Mainnet yet for the price plus gas.');
    const wallet = createWalletClient({ account, chain: optimism, transport: rpc });
    const hash = await wallet.writeContract({ address: idGateway, abi: gatewayAbi, functionName: 'register', args: [account.address], value: price });
    console.log(`Submitted: https://optimistic.etherscan.io/tx/${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    await status();
    return;
  }
  if (command === 'secrets') {
    const { fid } = await status();
    if (fid === 0n) throw new Error('Register the FID first.');
    for (const [name, value] of [['FARCASTER_APP_FID', fid.toString()], ['FARCASTER_APP_MNEMONIC', requireMnemonic()]] as const) {
      const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
      if (result.status !== 0) throw new Error(`wrangler secret put ${name} failed.`);
    }
    console.log('Done. The app now offers “Connect Farcaster” (check /v1/cross-posting/status).');
    return;
  }
  console.log('Usage: npx tsx scripts/farcaster-app-account.ts <create|status|register|secrets>');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

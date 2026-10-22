import { Platform } from 'react-native';

import { deviceSecretStorage } from '../../auth/supabase';
import { CrossPostContent } from '../../domain/crossPosting';
import { isPubliclyReachableUrl } from '../../domain/postVideo';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * Lens: the person signs Lens's "Sign in with Ethereum" message in their browser wallet, which
 * gives Open Media a revocable Lens session (no keys). Post text is stored on Grove, Lens's public
 * storage, and the post itself is a Lens Chain transaction the wallet approves and pays for in GHO
 * (a fraction of a cent) unless Lens sponsors it. A video is uploaded to Grove too (immutable, at
 * most 125 MB) and posted as Lens video metadata. Web only for now: phones need a wallet connector.
 *
 * App identity: EXPO_PUBLIC_LENS_APP_ADDRESS, falling back to Lens's public test app, which Lens
 * provides for development. Register Open Media's own Lens app before launch.
 */
const api = 'https://api.lens.xyz/graphql';
const grove = 'https://api.grove.storage/?chain_id=232';
const lensChainId = 232;
const publicTestApp = '0x8A5Cc31180c37078e1EbA2A23c861Acf351a97cE';
const sessionKey = 'open-media.network.lens';

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
interface StoredLens { owner: string; account: string; username: string; refreshToken: string }

function wallet(): Eip1193 | undefined {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? (window as unknown as { ethereum?: Eip1193 }).ethereum : undefined;
}

function appAddress() {
  const configured = process.env.EXPO_PUBLIC_LENS_APP_ADDRESS;
  return configured && /^0x[0-9a-fA-F]{40}$/.test(configured) ? configured : publicTestApp;
}

async function gql<T>(query: string, variables: Record<string, unknown>, accessToken?: string): Promise<T> {
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const body = await response.json() as { data?: T; errors?: { message: string }[] };
  if (!body.data) throw new PublishingError(body.errors?.[0]?.message ? `Lens: ${body.errors[0].message}` : 'Lens didn’t respond. Try again.');
  return body.data;
}

async function load(): Promise<StoredLens | undefined> {
  try { return JSON.parse((await deviceSecretStorage().getItem(sessionKey)) ?? 'null') ?? undefined; } catch { return undefined; }
}

function toAccount(stored: StoredLens): NetworkAccount {
  return { network: 'lens', handle: `@${stored.username}`, profileURL: `https://hey.xyz/u/${encodeURIComponent(stored.username)}` };
}

/** Exchanges the stored refresh token for a fresh 10-minute access token (and a new refresh token). */
async function accessToken(stored: StoredLens): Promise<string> {
  const data = await gql<{ refresh: { __typename: string; accessToken?: string; refreshToken?: string } }>(
    'mutation Refresh($request: RefreshRequest!) { refresh(request: $request) { __typename ... on AuthenticationTokens { accessToken refreshToken } } }',
    { request: { refreshToken: stored.refreshToken } },
  );
  if (!data.refresh.accessToken || !data.refresh.refreshToken) throw new PublishingError('Your Lens session expired. Reconnect Lens in Settings.');
  await deviceSecretStorage().setItem(sessionKey, JSON.stringify({ ...stored, refreshToken: data.refresh.refreshToken }));
  return data.refresh.accessToken;
}

const hexQuantity = (value: unknown) => typeof value === 'string' && value.startsWith('0x') ? value : `0x${BigInt(String(value ?? 0)).toString(16)}`;

export const lensPublisher: PublishingConnector = {
  id: 'lens',
  revokeHint: 'Open Media holds a Lens session, not your keys. Your wallet approves each post; disconnecting ends the session on this device.',

  async availability() {
    if (Platform.OS !== 'web') return { available: false, setup: 'device', reason: 'For now, connect Lens from Open Media on the web with a browser wallet.' };
    return wallet() ? { available: true } : { available: false, setup: 'device', reason: 'Add a browser wallet (such as MetaMask or Rabby) to post to Lens.' };
  },

  async account() {
    const stored = await load();
    return stored ? toAccount(stored) : undefined;
  },

  async connect() {
    const provider = wallet();
    if (!provider) throw new PublishingError('Add a browser wallet to connect Lens.');
    const [owner] = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    if (!owner) throw new PublishingError('Your wallet didn’t share an address.');
    const available = await gql<{ accountsAvailable: { items: { __typename: string; account: { address: string; username?: { localName: string } | null }; permissions?: { canExecuteTransactions: boolean } }[] } }>(
      'query Accounts($request: AccountsAvailableRequest!) { accountsAvailable(request: $request) { items { __typename ... on AccountOwned { account { address username { localName } } } ... on AccountManaged { account { address username { localName } } permissions { canExecuteTransactions } } } } }',
      { request: { managedBy: owner, includeOwned: true, pageSize: 'TEN' } },
    );
    const choice = available.accountsAvailable.items.find((item) => item.__typename === 'AccountOwned' || item.permissions?.canExecuteTransactions);
    if (!choice) throw new PublishingError('This wallet has no Lens account. Create one at hey.xyz, then connect again.');
    const role = choice.__typename === 'AccountOwned' ? { accountOwner: { app: appAddress(), account: choice.account.address, owner } } : { accountManager: { app: appAddress(), account: choice.account.address, manager: owner } };
    const { challenge } = await gql<{ challenge: { id: string; text: string } }>('mutation Challenge($request: ChallengeRequest!) { challenge(request: $request) { id text } }', { request: role });
    const signature = await provider.request({ method: 'personal_sign', params: [challenge.text, owner] }).catch(() => { throw new PublishingError('The sign-in was declined in your wallet.'); }) as string;
    const { authenticate } = await gql<{ authenticate: { __typename: string; refreshToken?: string; reason?: string } }>(
      'mutation Authenticate($request: SignedAuthChallenge!) { authenticate(request: $request) { __typename ... on AuthenticationTokens { refreshToken } ... on WrongSignerError { reason } ... on ExpiredChallengeError { reason } ... on ForbiddenError { reason } } }',
      { request: { id: challenge.id, signature } },
    );
    if (!authenticate.refreshToken) throw new PublishingError(`Lens didn’t sign you in${authenticate.reason ? `: ${authenticate.reason}` : '.'}`);
    const stored = { owner, account: choice.account.address, username: choice.account.username?.localName ?? choice.account.address, refreshToken: authenticate.refreshToken };
    await deviceSecretStorage().setItem(sessionKey, JSON.stringify(stored));
    return toAccount(stored);
  },

  async disconnect() {
    await deviceSecretStorage().removeItem(sessionKey);
  },

  async publish(content, idempotencyKey) {
    const stored = await load();
    const provider = wallet();
    if (!stored) throw new PublishingError('Connect Lens in Settings → Cross-posting.');
    if (!provider) throw new PublishingError('Your browser wallet isn’t available.');
    const token = await accessToken(stored);

    const metadata = content.video ? await videoMetadata(content, idempotencyKey) : { $schema: 'https://json-schemas.lens.dev/posts/text-only/3.0.0.json', lens: { id: uuidFrom(idempotencyKey), content: content.text, locale: 'en', mainContentFocus: 'TEXT_ONLY' } };
    const uri = await groveUpload(JSON.stringify(metadata), 'application/json');

    const { post } = await gql<{ post: { __typename: string; hash?: string; reason?: string; raw?: Record<string, unknown> } }>(
      'mutation Post($request: CreatePostRequest!) { post(request: $request) { __typename ... on PostResponse { hash } ... on SelfFundedTransactionRequest { reason raw { to from data value gasLimit maxFeePerGas maxPriorityFeePerGas chainId } } ... on SponsoredTransactionRequest { reason } ... on TransactionWillFail { reason } ... on PostOperationValidationFailed { reason } } }',
      { request: { contentUri: uri } }, token,
    );
    let hash = post.hash;
    if (post.__typename === 'SelfFundedTransactionRequest' && post.raw) {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${lensChainId.toString(16)}` }] }).catch(async () => {
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${lensChainId.toString(16)}`, chainName: 'Lens Chain', nativeCurrency: { name: 'GHO', symbol: 'GHO', decimals: 18 }, rpcUrls: ['https://rpc.lens.xyz'], blockExplorerUrls: ['https://explorer.lens.xyz'] }] });
      });
      const raw = post.raw;
      hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: raw.from, to: raw.to, data: raw.data, value: hexQuantity(raw.value), gas: hexQuantity(raw.gasLimit), maxFeePerGas: hexQuantity(raw.maxFeePerGas), maxPriorityFeePerGas: hexQuantity(raw.maxPriorityFeePerGas) }] })
        .catch((error: { code?: number }) => { throw new PublishingError(error?.code === 4001 ? 'The Lens post was declined in your wallet.' : 'Your wallet couldn’t send the Lens post. You need a little GHO on Lens Chain for fees.'); }) as string;
    } else if (!hash) {
      throw new PublishingError(post.__typename === 'SponsoredTransactionRequest' ? 'Lens asked for a sponsored transaction, which Open Media doesn’t support yet.' : `Lens didn’t accept the post${post.reason ? `: ${post.reason}` : '.'}`);
    }

    // Wait briefly for indexing so the link points at the post itself.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const status = await gql<{ transactionStatus: { __typename: string; reason?: string } }>('query Status($request: TransactionStatusRequest!) { transactionStatus(request: $request) { __typename ... on FailedTransactionStatus { reason } } }', { request: { txHash: hash } }).catch(() => undefined);
      if (status?.transactionStatus.__typename === 'FailedTransactionStatus') throw new PublishingError(`The Lens post failed${status.transactionStatus.reason ? `: ${status.transactionStatus.reason}` : '.'}`);
      if (status?.transactionStatus.__typename === 'FinishedTransactionStatus') {
        const found = await gql<{ post: { slug?: string } | null }>('query Post($request: PostRequest!) { post(request: $request) { ... on Post { slug } } }', { request: { txHash: hash } }).catch(() => undefined);
        if (found?.post?.slug) return { externalId: hash!, url: `https://hey.xyz/posts/${found.post.slug}` };
        break;
      }
    }
    return { externalId: hash!, url: `https://explorer.lens.xyz/tx/${hash}` };
  },
};

/** One-step immutable Grove upload; returns the `lens://` URI. */
async function groveUpload(body: BodyInit, contentType: string): Promise<string> {
  const upload = await fetch(grove, { method: 'POST', headers: { 'content-type': contentType }, body });
  const { uri } = await upload.json().catch(() => ({})) as { uri?: string };
  if (!upload.ok || !uri?.startsWith('lens://')) throw new PublishingError(contentType.startsWith('video/') ? 'Lens storage didn’t accept the video. Try again.' : 'Lens storage didn’t accept the post. Try again.');
  return uri;
}

/** Lens video metadata (posts/video/3.0.0): the file goes to Grove; Open Media's public URL is the fallback. */
async function videoMetadata(content: CrossPostContent, idempotencyKey: string) {
  const video = content.video!;
  const item = video.bytes ? await groveUpload(video.bytes as unknown as BodyInit, video.contentType) : video.url;
  return {
    $schema: 'https://json-schemas.lens.dev/posts/video/3.0.0.json',
    lens: {
      id: uuidFrom(idempotencyKey),
      locale: 'en',
      mainContentFocus: 'SHORT_VIDEO',
      ...(content.text ? { content: content.text } : {}),
      video: {
        item,
        type: video.contentType,
        duration: Math.max(1, Math.round(video.durationSeconds)),
        altTag: video.altText,
        ...(video.posterUrl && isPubliclyReachableUrl(video.posterUrl) ? { cover: video.posterUrl } : {}),
      },
    },
  };
}

/** Stable UUID-shaped id from the idempotency key, as Lens metadata requires a UUID. */
function uuidFrom(key: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; round < 4; round += 1) {
    for (const char of `${round}:${key}`) { a = Math.imul(a ^ char.charCodeAt(0), 16777619) >>> 0; b = Math.imul(b + char.charCodeAt(0), 2246822519) >>> 0; }
    hex.push(((a ^ b) >>> 0).toString(16).padStart(8, '0'));
  }
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

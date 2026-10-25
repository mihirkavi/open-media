/**
 * Open Media SDK: a typed client for the Open Media API.
 *
 * Public data (the mixed feed, cross-network search, posts, profiles, timelines and events) needs
 * no key. Account calls need the person's own access token, copied from the app (Settings, then
 * Developers and agents), and act only as that person.
 *
 * Docs: https://convo-mail-sync.convo-mail-sync.workers.dev/docs
 */

export const defaultBaseUrl = 'https://convo-mail-sync.convo-mail-sync.workers.dev';

export type Network = 'open-media' | 'farcaster' | 'lens' | 'hive' | 'deso';
export type FeedMode = 'raw' | 'relevant';

export interface Post {
  id: string;
  network: Network;
  author: { name: string; handle: string; avatarUrl: string | null };
  title: string | null;
  text: string;
  createdAt: string;
  url: string | null;
  media: { type: 'image' | 'video'; url: string; posterUrl: string | null; durationSeconds: number | null; altText: string | null }[];
  engagement: { replies: number; reposts: number; likes: number } | null;
  why: { used: string[]; filters: string[]; notUsed: string[] };
  listing?: Record<string, unknown>;
}

export interface FeedPage { data: Post[]; unavailable: string[]; nextCursor: string | null; next: string | null }

export interface OpenMediaOptions {
  /** API origin. Defaults to the public Open Media API. */
  baseUrl?: string;
  /** The person's access token, for account calls. */
  token?: string;
  /** A fetch implementation (defaults to the global fetch). */
  fetch?: typeof fetch;
  /** How many times to retry a 429 after waiting Retry-After seconds (default 2). */
  maxRetries?: number;
  /** User-Agent suffix identifying your app or agent. */
  userAgent?: string;
}

/** An API error with the server's machine-readable code. */
export class OpenMediaError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'OpenMediaError';
  }
}

type Query = Record<string, string | number | undefined | null>;

export class OpenMedia {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly userAgent: string;

  constructor(options: OpenMediaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = options.maxRetries ?? 2;
    this.userAgent = ['open-media-sdk/0.1.0', options.userAgent].filter(Boolean).join(' ');
  }

  // ─── Public: no key ────────────────────────────────────────────────────────

  /** The mixed feed across Open Media and the open networks, with “why” reasons. */
  feed(options: { sources?: Network[]; mode?: FeedMode; kind?: 'feed' | 'clips'; cursor?: string } = {}): Promise<FeedPage> {
    return this.get('/v1/feed', { sources: options.sources?.join(','), mode: options.mode, kind: options.kind, cursor: options.cursor });
  }

  /** Plain-language search across public posts on every network, plus matching settings. */
  search(query: string): Promise<Record<string, unknown>> {
    return this.get('/v1/search', { q: query });
  }

  /** One public Open Media post. */
  post(id: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/posts/${encodeURIComponent(id)}`);
  }

  /** A public Open Media profile with recent posts. */
  profile(handle: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/profiles/${encodeURIComponent(handle.replace(/^@/, ''))}`);
  }

  /** One person's public posts in one timeline. */
  timeline(network: Network, handle: string, cursor?: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/people/${network}/${encodeURIComponent(handle.replace(/^@/, ''))}`, { cursor });
  }

  /** Upcoming public events in the San Francisco Bay Area, with official registration links. */
  events(options: { area?: string; days?: number; query?: string; limit?: number } = {}): Promise<Record<string, unknown>> {
    return this.get('/v1/events/upcoming', { area: options.area, days: options.days, q: options.query, limit: options.limit });
  }

  /** Every network and exactly what works today. */
  networks(): Promise<Record<string, unknown>> {
    return this.get('/v1/networks');
  }

  /** Mission, principles, roadmap, honest status and every agent interface. */
  about(): Promise<Record<string, unknown>> {
    return this.get('/v1/about');
  }

  // ─── The person's account: needs their token ───────────────────────────────

  me(): Promise<Record<string, unknown>> {
    return this.get('/v1/me');
  }

  /** Publishes a public post. Pass the same idempotencyKey when retrying. */
  publish(text: string, options: { idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
    return this.send('POST', '/v1/me/posts', { text }, options.idempotencyKey);
  }

  deletePost(id: string): Promise<Record<string, unknown>> {
    return this.send('DELETE', `/v1/me/posts/${encodeURIComponent(id)}`);
  }

  conversations(): Promise<Record<string, unknown>> {
    return this.get('/v1/me/conversations');
  }

  sendMessage(conversationId: string, text: string): Promise<Record<string, unknown>> {
    return this.send('POST', `/v1/me/conversations/${encodeURIComponent(conversationId)}/messages`, { text });
  }

  /** Offers a product or service as a public post with a price, e.g. price "25" or "25.50". */
  publishListing(listing: { kind: 'product' | 'service'; title: string; price?: string; currency?: string; location?: string; remote?: boolean; text?: string }, options: { idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
    return this.send('POST', '/v1/me/listings', listing, options.idempotencyKey);
  }

  /** Publishes a post with a free preview and a paid part. priceMinor is in cents. */
  publishPaidPost(post: { preview: string; paidText: string; priceMinor: number; currency?: string }, options: { idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
    return this.send('POST', '/v1/me/paid-posts', post, options.idempotencyKey);
  }

  /** The person's payments, payout setup and whether this server is in test mode. */
  paymentSetup(): Promise<Record<string, unknown>> {
    return this.get('/v1/me/payments/setup');
  }

  payments(limit = 50): Promise<unknown[]> {
    return this.get('/v1/me/payments', { limit });
  }

  /**
   * Starts a payment. Show the person who is paid, the amount and the fees first (getPaymentOptions)
   * and only call this once they agreed. Card returns checkoutUrl for them to open; USDC returns the
   * transfer for their own wallet. Nothing is paid until Stripe or the network confirms it.
   */
  startPayment(payment: { contextType: 'listing' | 'tip' | 'paid_post'; contextId: string; rail: 'card' | 'onchain'; chain?: 'base' | 'base-sepolia'; amountMinor?: number }, options: { idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
    return this.send('POST', '/v1/me/payments', payment, options.idempotencyKey);
  }

  getPaymentOptions(postId: string, kind: 'listing' | 'post' = 'listing'): Promise<Record<string, unknown>> {
    return this.get(kind === 'listing' ? `/v1/me/listings/${encodeURIComponent(postId)}/payment-options` : `/v1/me/posts/${encodeURIComponent(postId)}/payment-options`);
  }

  payment(id: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/me/payments/${encodeURIComponent(id)}`);
  }

  exportData(): Promise<Record<string, unknown>> {
    return this.get('/v1/me/export');
  }

  // ─── Plumbing ──────────────────────────────────────────────────────────────

  private get<T>(path: string, query: Query = {}): Promise<T> {
    return this.request<T>('GET', path, query);
  }

  private send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>(method, path, {}, body, idempotencyKey);
  }

  private async request<T>(method: string, path: string, query: Query, body?: unknown, idempotencyKey?: string): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': this.userAgent };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    // A write gets one key for all its retries, so a retry never creates a second post or payment.
    if (method !== 'GET') headers['idempotency-key'] = idempotencyKey ?? globalThis.crypto.randomUUID();
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      const payload = text ? safeJson(text) : null;
      if (response.ok) return payload as T;
      const retryAfter = Number(response.headers.get('retry-after') ?? '') || undefined;
      if (response.status === 429 && attempt < this.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, (retryAfter ?? 1) * 1000));
        continue;
      }
      const error = (payload as { error?: { code?: string; message?: string } | string } | null)?.error;
      const code = typeof error === 'object' && error?.code ? error.code : `http_${response.status}`;
      const message = typeof error === 'object' && error?.message ? error.message : typeof error === 'string' ? error : `Open Media answered ${response.status}.`;
      throw new OpenMediaError(response.status, code, message, retryAfter);
    }
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

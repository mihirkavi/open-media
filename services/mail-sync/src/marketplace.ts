/**
 * Marketplace trust jobs (ADR 0016), run by the Worker every minute and by agent routes.
 *
 * - Background checks: each pending listing gets the published rules (src/domain/listingSafety),
 *   link resolution and Google Web Risk, and Llama Guard on Workers AI. The outcome and a
 *   statement of reasons go to the database, which tells the seller in Messages.
 * - Notices: queued statements of reasons become messages from the Open Media account.
 * - Large sellers: details are copied from Stripe and confirmed by a reply in Messages.
 * - Evidence: a verifier's cited pages are fetched and their quotes confirmed before a vote counts.
 *
 * All database calls here use the service role and security-definer functions; nothing reads
 * tables directly.
 */
import { lookup } from 'node:dns/promises';

import {
  CheckReason, extractLinks, guardReasons, isShortener, linkReasons, linkReputationReason, ListingForCheck, normaliseForQuote, ruleReasons, shortReason, stateFor,
  statementOfReasons, VerificationClaim, verificationClaims,
} from '../../../src/domain/listingSafety';
import { isPublicAddress } from './networkSafety.js';

export interface MarketplaceEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** Google Cloud Web Risk API key. Without it, link reputation is skipped (the other checks still run). */
  WEB_RISK_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
}

type Fetch = typeof fetch;
type Resolve = (host: string) => Promise<string[]>;
export interface MarketplaceDeps { fetch?: Fetch; resolve?: Resolve; now?: () => Date }

const guardModel = '@cf/meta/llama-guard-3-8b';
const defaultResolve: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((answer) => answer.address);

export class MarketplaceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function marketplaceConfigured(env: MarketplaceEnv): boolean {
  return Boolean(env.SUPABASE_SECRET_KEY);
}

/** Calls a service-role database function. Database refusals keep their plain-language message. */
export async function serviceRpc<T>(env: MarketplaceEnv, name: string, args: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<T> {
  if (!env.SUPABASE_SECRET_KEY) throw new MarketplaceError(503, 'unavailable', 'This part of Open Media is not configured here.');
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = (() => { try { return JSON.parse(text) as { message?: string; code?: string }; } catch { return {}; } })();
    const status = detail.code === '42501' ? 403 : detail.code === 'P0002' ? 404 : detail.code === '22023' ? 400 : detail.code === '54000' ? 429 : detail.code === '23505' ? 409 : 502;
    throw new MarketplaceError(status, status === 502 ? 'upstream_unavailable' : 'refused', status === 502 ? `${name} failed. Try again shortly.` : detail.message ?? 'Refused.');
  }
  return (text ? JSON.parse(text) : null) as T;
}

// Safe fetching of public pages ────────────────────────────────────────────────

/** True when every address the host resolves to is public. Bare IPs and local names never are. */
export async function isPublicHost(host: string, resolve: Resolve = defaultResolve): Promise<boolean> {
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^\[?[\d.:a-f]+\]?$/i.test(host)) return false;
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every(isPublicAddress);
  } catch { return false; }
}

/** Fetches a public https page, following up to three redirects that are each checked, with a size and time limit. */
export async function fetchPublicPage(url: string, deps: MarketplaceDeps = {}, maxBytes = 1_000_000): Promise<{ url: string; status: number; text: string } | undefined> {
  const fetchImpl = deps.fetch ?? fetch;
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return undefined; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return undefined;
    if (!(await isPublicHost(parsed.hostname, deps.resolve))) return undefined;
    const response = await fetchImpl(parsed.toString(), {
      redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'OpenMediaListingCheck/1.0 (+https://api.openmedia.site/policies/listings)', accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    }).catch(() => undefined);
    if (!response) return undefined;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return undefined;
      current = new URL(location, parsed).toString();
      continue;
    }
    const reader = response.body?.getReader();
    if (!reader) return { url: current, status: response.status, text: '' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < maxBytes) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const bytes = new Uint8Array(Math.min(size, maxBytes));
    let offset = 0;
    for (const chunk of chunks) { const part = chunk.subarray(0, Math.max(0, bytes.length - offset)); bytes.set(part, offset); offset += part.byteLength; }
    return { url: current, status: response.status, text: new TextDecoder().decode(bytes) };
  }
  return undefined;
}

/** Where a short link really goes, without loading the destination. */
export async function resolveShortLink(url: string, deps: MarketplaceDeps = {}): Promise<string | undefined> {
  const fetchImpl = deps.fetch ?? fetch;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return undefined; }
  if (!(await isPublicHost(parsed.hostname, deps.resolve))) return undefined;
  const response = await fetchImpl(parsed.toString(), { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  const location = response?.headers.get('location');
  if (!location) return undefined;
  try { return new URL(location, parsed).toString(); } catch { return undefined; }
}

// Link reputation and the content model ─────────────────────────────────────────

/** Google Web Risk: the threats a link is listed for, or none. Skipped without a key. */
export async function webRiskThreats(env: MarketplaceEnv, url: string, fetchImpl: Fetch = fetch): Promise<string[]> {
  if (!env.WEB_RISK_API_KEY) return [];
  const query = new URLSearchParams({ uri: url, key: env.WEB_RISK_API_KEY });
  for (const threat of ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']) query.append('threatTypes', threat);
  const response = await fetchImpl(`https://webrisk.googleapis.com/v1/uris:search?${query}`, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  if (!response?.ok) return [];
  const body = await response.json().catch(() => ({})) as { threat?: { threatTypes?: string[] } };
  return body.threat?.threatTypes ?? [];
}

/** Llama Guard's verdict as text ("safe" or "unsafe\nS2,S8"). Errors count as safe: the model is only a signal. */
export async function guardVerdict(env: MarketplaceEnv, listing: Pick<ListingForCheck, 'title' | 'body'>): Promise<string> {
  if (!env.AI) return 'safe';
  try {
    const result = await env.AI.run(guardModel, {
      messages: [{ role: 'user', content: `Someone wants to publish this marketplace listing. Classify it.\n\nTitle: ${listing.title.slice(0, 200)}\n\nDescription: ${listing.body.slice(0, 3000)}` }],
      max_tokens: 20,
    });
    const answer = (result as { response?: unknown })?.response ?? result;
    if (typeof answer === 'string') return answer;
    if (answer && typeof answer === 'object' && 'safe' in answer) {
      const verdict = answer as { safe?: boolean; categories?: string[] };
      return verdict.safe === false ? `unsafe\n${(verdict.categories ?? []).join(',')}` : 'safe';
    }
    return 'safe';
  } catch { return 'safe'; }
}

// The background check ──────────────────────────────────────────────────────────

export interface PendingListing extends ListingForCheck { postId: string; authorId: string; updatedAt: string; linkedAccounts: number }

export interface CheckOutcome { state: 'clear' | 'review' | 'held'; reasons: CheckReason[]; notice?: string; claims: VerificationClaim[] }

/** Every check for one listing: rules, link resolution and reputation, then the content model. */
export async function checkListing(env: MarketplaceEnv, listing: PendingListing, deps: MarketplaceDeps = {}): Promise<CheckOutcome> {
  const fetchImpl = deps.fetch ?? fetch;
  const reasons = ruleReasons(listing);
  const links = extractLinks(`${listing.title}\n${listing.body}`);
  const destinations = new Set(links);
  for (const link of links.filter(isShortener)) {
    const target = await resolveShortLink(link, deps);
    if (target) { destinations.add(target); for (const reason of linkReasons(target)) if (!reasons.some((known) => known.code === reason.code)) reasons.push(reason); }
  }
  for (const url of destinations) {
    const threats = await webRiskThreats(env, url, fetchImpl);
    if (threats.length) reasons.push(linkReputationReason(url, threats));
  }
  if (!reasons.some((reason) => reason.severity === 'hold')) reasons.push(...guardReasons(await guardVerdict(env, listing)));
  const state = stateFor(reasons);
  const notice = state === 'clear' ? undefined
    // A closer look that only reflects a new account or an unsigned agent needs no message.
    : state === 'review' && reasons.every((reason) => reason.code === 'new_seller' || reason.code === 'unsigned_agent') ? undefined
    : statementOfReasons(listing.title, state, reasons);
  return { state, reasons, notice, claims: state === 'review' ? verificationClaims(listing) : [] };
}

/** Checks pending listings, delivers notices and confirms seller replies. Returns what it did. */
export async function runMarketplaceJobs(env: MarketplaceEnv, deps: MarketplaceDeps = {}): Promise<{ checked: number; notices: number; confirmed: number; sellers: number }> {
  if (!marketplaceConfigured(env)) return { checked: 0, notices: 0, confirmed: 0, sellers: 0 };
  const fetchImpl = deps.fetch ?? fetch;
  let checked = 0;
  const pending = await serviceRpc<PendingListing[]>(env, 'open_media_pending_listing_checks', { p_limit: 20 }, fetchImpl);
  for (const listing of pending) {
    try {
      const outcome = await checkListing(env, listing, deps);
      const recorded = await serviceRpc<boolean>(env, 'open_media_record_listing_check', {
        p_post_id: listing.postId, p_updated_at: listing.updatedAt, p_state: outcome.state,
        p_reasons: outcome.reasons, p_notice: outcome.notice ?? null, p_claims: outcome.claims,
      }, fetchImpl);
      if (recorded) checked += 1;
    } catch (error) {
      console.error(JSON.stringify({ event: 'listing_check_failed', postId: listing.postId, message: error instanceof Error ? error.message : 'unknown' }));
    }
  }
  const sellers = await requestSellerDisclosures(env, fetchImpl).catch((error) => { console.error(JSON.stringify({ event: 'seller_disclosure_failed', message: error instanceof Error ? error.message : 'unknown' })); return 0; });
  const confirmed = await serviceRpc<number>(env, 'open_media_confirm_seller_replies', {}, fetchImpl);
  const notices = await serviceRpc<number>(env, 'open_media_deliver_notices', { p_limit: 100 }, fetchImpl);
  return { checked, notices, confirmed, sellers };
}

// Large sellers (US INFORM Consumers Act) ───────────────────────────────────────

interface HighVolumeSeller { userId: string; sales: number; grossUsd: number; stripeAccountId: string | null }

/** Copies a large seller's business details from their Stripe account, if they have one. */
export async function stripeSellerDetails(env: MarketplaceEnv, accountId: string, fetchImpl: Fetch = fetch): Promise<Record<string, string | undefined>> {
  if (!env.STRIPE_SECRET_KEY) return {};
  const response = await fetchImpl(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!response.ok) return {};
  const account = await response.json() as {
    business_profile?: { name?: string; support_email?: string; support_phone?: string; support_address?: Record<string, string | null> };
    company?: { name?: string; address?: Record<string, string | null> };
    individual?: { first_name?: string; last_name?: string; address?: Record<string, string | null> };
    email?: string;
  };
  const address = account.business_profile?.support_address ?? account.company?.address ?? account.individual?.address;
  const line = address ? [address.line1, address.line2, address.city, address.state, address.postal_code, address.country].filter(Boolean).join(', ') : undefined;
  const person = [account.individual?.first_name, account.individual?.last_name].filter(Boolean).join(' ');
  return {
    name: account.business_profile?.name ?? account.company?.name ?? (person || undefined),
    address: line || undefined,
    email: account.business_profile?.support_email ?? account.email,
    phone: account.business_profile?.support_phone,
  };
}

export async function requestSellerDisclosures(env: MarketplaceEnv, fetchImpl: Fetch = fetch): Promise<number> {
  const sellers = await serviceRpc<HighVolumeSeller[]>(env, 'open_media_high_volume_sellers', {}, fetchImpl);
  for (const seller of sellers) {
    const details = seller.stripeAccountId ? await stripeSellerDetails(env, seller.stripeAccountId, fetchImpl) : {};
    await serviceRpc(env, 'open_media_request_seller_disclosure', { p_user: seller.userId, p_details: details }, fetchImpl);
  }
  return sellers.length;
}

// Evidence for verification ─────────────────────────────────────────────────────

export interface Evidence { url: string; quote: string }

/** Reads up to five {url, quote} items. Quotes must be short exact text from the page. */
export function readEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((item) => {
    const url = typeof (item as Evidence)?.url === 'string' ? (item as Evidence).url.trim() : '';
    const quote = typeof (item as Evidence)?.quote === 'string' ? (item as Evidence).quote.trim() : '';
    if (!/^https:\/\//i.test(url) || url.length > 2000 || quote.length < 8 || quote.length > 300) return [];
    return [{ url, quote }];
  });
}

/** True when at least one cited page loads and contains its quote. */
export async function confirmEvidence(evidence: Evidence[], deps: MarketplaceDeps = {}): Promise<boolean> {
  for (const item of evidence) {
    const page = await fetchPublicPage(item.url, deps);
    if (page && page.status < 400 && normaliseForQuote(page.text).includes(normaliseForQuote(item.quote))) return true;
  }
  return false;
}

export function shortCheckReason(reasons: CheckReason[]): string {
  return shortReason(reasons);
}

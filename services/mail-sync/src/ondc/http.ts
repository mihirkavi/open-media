/**
 * Open Media's ONDC seller app endpoints (ADR 0015, phase 1).
 *
 * - GET  /ondc                          what this participant is and whether it is configured
 * - GET  /ondc-site-verification.html   the signed request_id the registry checks
 * - POST /ondc/on_subscribe             answers the registry's encrypted challenge
 * - POST /ondc/{action}                 Beckn actions from buyer apps (bpp_uri = https://{subscriber_id}/ondc)
 *
 * Every Beckn request must be signed by a participant listed in the ONDC registry, and its bap_uri
 * must be on that participant's registered host, so callbacks only ever go back to the buyer app
 * that asked. search and select are ACKed at once and answered by signed on_search and on_select
 * callbacks. Order actions get a NACK with 40001 until phase 2, so no buyer app can place an order
 * Open Media cannot fulfil.
 */
import { ondcCategories } from '../../../../src/domain/ondc';
import { iconUrl } from '../agentSite.js';
import { CatalogStore, ImageUrls, onSearchCatalog, onSelectOrder, OndcError, QuoteItem, SelectedItem } from './catalog.js';
import { authorizationHeader, decryptChallenge, encryptionPublicKey, OndcKeyError, ondcRegistryKeys, parseAuthorization, ParsedAuthorization, SignerKey, signingPublicKey, signPlain, verifyAuthorization } from './crypto.js';

export interface OndcEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  ONDC_SUBSCRIBER_ID?: string;
  ONDC_UNIQUE_KEY_ID?: string;
  ONDC_SIGNING_PRIVATE_KEY?: string;
  ONDC_ENCRYPTION_PRIVATE_KEY?: string;
  ONDC_REQUEST_ID?: string;
  ONDC_ENVIRONMENT?: string;
}

type Fetch = typeof fetch;
export interface Participant { signingPublicKey: string; subscriberUrl?: string }
export type Lookup = (subscriberId: string, uniqueKeyId: string) => Promise<Participant | undefined>;
export interface OndcDeps { fetch?: Fetch; lookup?: Lookup; now?: () => number; waitUntil?: (promise: Promise<unknown>) => void }

interface Config extends SignerKey { encryptionPrivateKey: string; requestId?: string; environment: 'preprod' | 'prod' }

export const coreVersion = '1.2.0';
const beckn = new Set(['search', 'select', 'init', 'confirm', 'status', 'track', 'cancel', 'update', 'rating', 'support']);
const answered = new Set(['search', 'select']);
const registryOrigins = { preprod: 'https://preprod.registry.ondc.org', prod: 'https://prod.registry.ondc.org' } as const;

export function isOndcPath(path: string): boolean {
  return path === '/ondc' || path === '/ondc-site-verification.html' || path.startsWith('/ondc/');
}

function config(env: OndcEnv): Config | undefined {
  if (!env.ONDC_SUBSCRIBER_ID || !env.ONDC_UNIQUE_KEY_ID || !env.ONDC_SIGNING_PRIVATE_KEY || !env.ONDC_ENCRYPTION_PRIVATE_KEY) return undefined;
  return {
    subscriberId: env.ONDC_SUBSCRIBER_ID, uniqueKeyId: env.ONDC_UNIQUE_KEY_ID, privateKey: env.ONDC_SIGNING_PRIVATE_KEY,
    encryptionPrivateKey: env.ONDC_ENCRYPTION_PRIVATE_KEY, requestId: env.ONDC_REQUEST_ID, environment: env.ONDC_ENVIRONMENT === 'prod' ? 'prod' : 'preprod',
  };
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
const ack = () => json({ message: { ack: { status: 'ACK' } } });
const nack = (status: number, error: OndcError) => json({ message: { ack: { status: 'NACK' } }, error }, status);

// ─── Registry ────────────────────────────────────────────────────────────────

const lookupCache = new Map<string, { participant: Participant | undefined; until: number }>();

/** Looks a participant's signing key up in the ONDC registry (v2.0, signed), cached for an hour. */
export function registryLookup(cfg: Config, fetchImpl: Fetch, now: () => number): Lookup {
  return async (subscriberId, uniqueKeyId) => {
    const cacheKey = `${cfg.environment}|${subscriberId}|${uniqueKeyId}`;
    const cached = lookupCache.get(cacheKey);
    if (cached && cached.until > now()) return cached.participant;
    const body = JSON.stringify({ subscriber_id: subscriberId, ukId: uniqueKeyId, country: 'IND' });
    const response = await fetchImpl(`${registryOrigins[cfg.environment]}/v2.0/lookup`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeader(body, cfg, Math.floor(now() / 1000)) }, body,
    });
    if (!response.ok) throw new Error(`ONDC registry lookup answered ${response.status}`);
    const entries = await response.json() as { ukId?: string; unique_key_id?: string; signing_public_key?: string; subscriber_url?: string; valid_until?: string; status?: string }[];
    const entry = (Array.isArray(entries) ? entries : []).find((item) => (item.ukId ?? item.unique_key_id) === uniqueKeyId && item.signing_public_key
      && (!item.valid_until || Date.parse(item.valid_until) > now()) && (!item.status || item.status === 'SUBSCRIBED'));
    const participant = entry ? { signingPublicKey: entry.signing_public_key!, subscriberUrl: entry.subscriber_url } : undefined;
    if (lookupCache.size >= 1000) lookupCache.delete(lookupCache.keys().next().value!);
    lookupCache.set(cacheKey, { participant, until: now() + (participant ? 60 * 60 * 1000 : 60 * 1000) });
    return participant;
  };
}

// ─── Requests ────────────────────────────────────────────────────────────────

interface Context {
  domain: string; country: string; city: string; action: string; core_version: string; bap_id: string; bap_uri: string;
  transaction_id: string; message_id: string; timestamp: string; ttl?: string; bpp_id?: string; bpp_uri?: string;
}

/** ISO 8601 durations as ONDC uses them (PT30S, P1D); anything else counts as thirty seconds. */
function durationMs(value: string | undefined): number {
  const match = value?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 30_000;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000 || 30_000;
}

function checkContext(context: Partial<Context> | undefined, action: string, cfg: Config, now: number): OndcError | undefined {
  if (!context || typeof context !== 'object') return { type: 'CONTEXT-ERROR', code: '30000', message: 'context is required.' };
  for (const field of ['domain', 'country', 'city', 'action', 'core_version', 'bap_id', 'bap_uri', 'transaction_id', 'message_id', 'timestamp'] as const) {
    if (typeof context[field] !== 'string' || !context[field]) return { type: 'CONTEXT-ERROR', code: '30000', message: `context.${field} is required.` };
  }
  if (context.action !== action) return { type: 'CONTEXT-ERROR', code: '30000', message: `context.action must be ${action}.` };
  if (context.country !== 'IND') return { type: 'CONTEXT-ERROR', code: '30000', message: 'Open Media sells in India only (country IND).' };
  if (context.core_version !== coreVersion) return { type: 'CONTEXT-ERROR', code: '30000', message: `Open Media supports core_version ${coreVersion}.` };
  if (!(context.domain! in ondcCategories)) return { type: 'CONTEXT-ERROR', code: '30000', message: `Open Media sells in ${Object.keys(ondcCategories).join(', ')}.` };
  if (context.bpp_id && context.bpp_id !== cfg.subscriberId) return { type: 'CONTEXT-ERROR', code: '30000', message: 'This request is for another seller app.' };
  const sent = Date.parse(context.timestamp!);
  if (!Number.isFinite(sent) || sent > now + 60_000) return { type: 'CONTEXT-ERROR', code: '30000', message: 'context.timestamp is not valid.' };
  if (sent + durationMs(context.ttl) < now) return { type: 'CONTEXT-ERROR', code: '30022', message: 'This request has expired (context.ttl).' };
  return undefined;
}

async function verifySender(request: Request, body: string, context: Context, lookup: Lookup, now: number): Promise<OndcError | Participant> {
  const failed: OndcError = { type: 'POLICY-ERROR', code: '10001', message: 'Cannot verify the signature for this request.' };
  const sender = parseAuthorization(request.headers.get('authorization'));
  if (!sender || sender.subscriberId !== context.bap_id) return failed;
  const checks: ParsedAuthorization[] = [sender];
  const gateway = request.headers.get('x-gateway-authorization');
  if (gateway) {
    const parsed = parseAuthorization(gateway);
    if (!parsed) return failed;
    checks.push(parsed);
  }
  let participant: Participant | undefined;
  for (const check of checks) {
    const found = await lookup(check.subscriberId, check.uniqueKeyId).catch(() => undefined);
    if (!found || !verifyAuthorization(check, body, found.signingPublicKey, Math.floor(now / 1000))) return failed;
    if (check === sender) participant = found;
  }
  // Callbacks go only to the host the buyer app registered.
  let bapHost: string;
  try {
    const bap = new URL(context.bap_uri);
    if (bap.protocol !== 'https:') return { type: 'CONTEXT-ERROR', code: '30000', message: 'bap_uri must be https.' };
    bapHost = bap.host;
  } catch { return { type: 'CONTEXT-ERROR', code: '30000', message: 'bap_uri is not a URL.' }; }
  const registeredHost = participant!.subscriberUrl ? (() => { try { return new URL(participant!.subscriberUrl!).host; } catch { return undefined; } })() : context.bap_id;
  if (bapHost !== registeredHost) return { ...failed, message: 'bap_uri is not on the buyer app’s registered host.' };
  return participant!;
}

// ─── Data ────────────────────────────────────────────────────────────────────

async function serviceRpc<T>(env: OndcEnv, fetchImpl: Fetch, name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY!, 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} answered ${response.status}`);
  return await response.json() as T;
}

function images(env: OndcEnv): ImageUrls {
  return {
    poster: (path) => `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/post-videos/${path.split('/').map(encodeURIComponent).join('/')}`,
    fallback: iconUrl,
  };
}

// ─── Callbacks ───────────────────────────────────────────────────────────────

async function sendCallback(cfg: Config, context: Context, action: string, payload: { message?: object; error?: OndcError }, fetchImpl: Fetch, now: number): Promise<void> {
  const body = JSON.stringify({
    context: { ...context, action: `on_${action}`, bpp_id: cfg.subscriberId, bpp_uri: `https://${cfg.subscriberId}/ondc`, timestamp: new Date(now).toISOString() },
    ...(payload.message ? { message: payload.message } : {}),
    ...(payload.error ? { error: payload.error } : {}),
  });
  const url = `${context.bap_uri.replace(/\/+$/, '')}/on_${action}`;
  const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeader(body, cfg, Math.floor(now / 1000)) }, body });
  console.log(JSON.stringify({ event: 'ondc_callback', action: `on_${action}`, bap: context.bap_id, status: response.status, transaction: context.transaction_id }));
}

async function answerSearch(env: OndcEnv, cfg: Config, context: Context, message: { intent?: { item?: { descriptor?: { name?: string } } } }, fetchImpl: Fetch, now: number) {
  const stdCode = context.city.replace(/^std:/, '');
  const query = message.intent?.item?.descriptor?.name?.trim().slice(0, 80) || null;
  const stores = await serviceRpc<CatalogStore[]>(env, fetchImpl, 'open_media_ondc_catalog', { p_std_code: stdCode, p_category: context.domain, p_query: query, p_limit: 200 });
  await sendCallback(cfg, context, 'search', { message: { catalog: onSearchCatalog(Array.isArray(stores) ? stores : [], images(env)) } }, fetchImpl, now);
}

async function answerSelect(env: OndcEnv, cfg: Config, context: Context, message: { order?: { provider?: { id?: string }; items?: { id?: string; quantity?: { count?: number } }[] } }, fetchImpl: Fetch, now: number) {
  const providerId = message.order?.provider?.id ?? '';
  const selected: SelectedItem[] = (message.order?.items ?? []).filter((item) => typeof item.id === 'string').map((item) => ({ id: item.id!, quantity: Math.max(1, Math.floor(Number(item.quantity?.count) || 1)) }));
  const uuid = /^[0-9a-f-]{36}$/i;
  const found = selected.every((item) => uuid.test(item.id)) && selected.length
    ? await serviceRpc<QuoteItem[]>(env, fetchImpl, 'open_media_ondc_items', { p_item_ids: selected.map((item) => item.id) })
    : [];
  const result = onSelectOrder(providerId, selected, Array.isArray(found) ? found : []);
  await sendCallback(cfg, context, 'select', { message: result.order ? { order: result.order } : undefined, error: result.error }, fetchImpl, now);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function participantInfo(env: OndcEnv, cfg: Config | undefined) {
  let keys: object = {};
  if (cfg) {
    try { keys = { uniqueKeyId: cfg.uniqueKeyId, signingPublicKey: signingPublicKey(cfg.privateKey), encryptionPublicKey: encryptionPublicKey(cfg.encryptionPrivateKey) }; } catch { keys = { keys: 'invalid' }; }
  }
  return {
    name: 'Open Media ONDC seller app',
    role: 'Seller app (BPP) for ONDC retail',
    phase: 'Phase 1: catalog search and quotes. Orders are not accepted through ONDC yet, so order actions answer NACK 40001.',
    configured: Boolean(cfg && env.SUPABASE_SECRET_KEY),
    environment: cfg?.environment ?? null,
    subscriberId: cfg?.subscriberId ?? null,
    bppUri: cfg ? `https://${cfg.subscriberId}/ondc` : null,
    coreVersion,
    domains: Object.entries(ondcCategories).map(([code, name]) => ({ code, name })),
    actions: { answered: [...answered], notYet: [...beckn].filter((action) => !answered.has(action)) },
    ...keys,
    docs: 'https://github.com/mihirkavi/open-media/blob/main/docs/adrs/0015-ondc-seller-app.md',
  };
}

export async function handleOndcRequest(request: Request, env: OndcEnv, deps: OndcDeps = {}): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!isOndcPath(url.pathname)) return undefined;
  const fetchImpl = deps.fetch ?? fetch;
  const nowMs = deps.now ?? Date.now;
  const cfg = config(env);

  if (request.method === 'GET' && url.pathname === '/ondc') return json(participantInfo(env, cfg));
  if (request.method === 'GET' && url.pathname === '/ondc-site-verification.html') {
    if (!cfg?.requestId) return new Response('Not found', { status: 404 });
    const signed = signPlain(cfg.requestId, cfg.privateKey);
    return new Response(`<html>\n  <head>\n    <meta name="ondc-site-verification" content="${signed}" />\n  </head>\n  <body>\n    ONDC Site Verification Page\n  </body>\n</html>\n`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (request.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'ONDC actions are POST requests.' } }, 405);

  if (url.pathname === '/ondc/on_subscribe') {
    if (!cfg) return json({ error: { code: 'not_configured', message: 'ONDC is not configured on this server.' } }, 503);
    const input = await request.json().catch(() => ({})) as { subscriber_id?: unknown; challenge?: unknown };
    if (input.subscriber_id !== cfg.subscriberId || typeof input.challenge !== 'string') return json({ error: { code: 'bad_request', message: 'Send subscriber_id and challenge.' } }, 400);
    try { return json({ answer: decryptChallenge(input.challenge, cfg.encryptionPrivateKey, ondcRegistryKeys[cfg.environment]) }); }
    catch (error) { return json({ error: { code: 'bad_request', message: error instanceof OndcKeyError ? 'The encryption key is not configured correctly.' : 'The challenge could not be decrypted.' } }, 400); }
  }

  const action = url.pathname.slice('/ondc/'.length);
  if (!beckn.has(action)) return nack(404, { type: 'CORE-ERROR', code: '30000', message: `Unknown action ${action}.` });
  if (!cfg || !env.SUPABASE_SECRET_KEY) return nack(503, { type: 'CORE-ERROR', code: '31001', message: 'Open Media’s ONDC seller app is not configured yet.' });
  const body = await request.text();
  let parsed: { context?: Context; message?: Record<string, unknown> };
  try { parsed = JSON.parse(body); } catch { return nack(400, { type: 'JSON-SCHEMA-ERROR', code: '30000', message: 'The body is not JSON.' }); }
  const now = nowMs();
  const contextError = checkContext(parsed.context, action, cfg, now);
  if (contextError) return nack(400, contextError);
  const context = parsed.context!;
  const sender = await verifySender(request, body, context, deps.lookup ?? registryLookup(cfg, fetchImpl, nowMs), now);
  if ('code' in sender) return nack(401, sender);
  if (!answered.has(action)) return nack(400, { type: 'DOMAIN-ERROR', code: '40001', message: `Open Media does not accept ${action} through ONDC yet: orders arrive in a later phase.` });
  if (action === 'search' && JSON.stringify(parsed.message?.intent ?? {}).includes('catalog_inc')) {
    return nack(400, { type: 'DOMAIN-ERROR', code: '40001', message: 'Incremental catalog refresh is not supported yet; send a full search.' });
  }
  if (action === 'search' && !/^std:0\d{2,4}$/.test(context.city)) return nack(400, { type: 'CONTEXT-ERROR', code: '10002', message: 'Search one city by its STD code, like std:080.' });

  const work = (action === 'search' ? answerSearch(env, cfg, context, parsed.message ?? {}, fetchImpl, now) : answerSelect(env, cfg, context, parsed.message ?? {}, fetchImpl, now))
    .catch((error) => console.error(JSON.stringify({ event: 'ondc_callback_failed', action, error: error instanceof Error ? error.message : String(error) })));
  if (deps.waitUntil) deps.waitUntil(work); else await work;
  return ack();
}


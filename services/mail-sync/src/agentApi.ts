/**
 * Open Media for programs and AI agents.
 *
 * Everything a person can do in the app has an interface here, in two forms that share the same
 * code: REST endpoints (documented in /v1/openapi.json) and MCP servers. Public data needs no
 * account: the mixed feed, cross-network search, networks and their capabilities, the settings
 * index and the mission. Account calls take the person's own access token and act only as them;
 * the database's row-level security refuses everything else.
 *
 * The feed, search, settings and mission code is the app's own (src/), so agents and people are
 * shown the same posts, the same “Why this?” reasons and the same words.
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  agentInterfaces, honestStatus, mission, neverDefaults, philosophy, principles, promise, promises, roadmap, sourceRepository, surfaces, tagline,
} from '../../../src/domain/about';
import { chatNetworks, unreachableChatNetworks } from '../../../src/domain/chatNetworks';
import { authorNetworks, fetchAuthorPosts } from '../../../src/connectors/networkAuthors';
import { networkConnectors } from '../../../src/connectors/networkFeeds';
import { networkSearches } from '../../../src/connectors/networkSearch';
import { collapseRepeatedPosts, NetworkId, networks } from '../../../src/domain/networkPosts';
import { explainFeedPost, FeedMode, SocialPost } from '../../../src/domain/posts';
import { PostListing, validateListing } from '../../../src/domain/listings';
import { validateOndcStore } from '../../../src/domain/ondc';
import { isPaymentChain, onchainTransfer, Payment, paymentBreakdown, PaymentChain, PaymentRail, previewCharge } from '../../../src/domain/payments';
import { maxPostLength, PublicPostRecord, socialPostFromPublic } from '../../../src/domain/publicPosts';
import { parseSearchQuery, postMatchesSearch } from '../../../src/domain/searchQuery';
import { searchSettings, settingIndex } from '../../../src/domain/settings';
import { availableNetworks, BridgesEnv } from './bridges.js';
import { contactsKey, ContactsEnv, openCard, sealCard, validCards } from './contactsStore.js';
import { callRpc, formatPost, formatProfile, openApiDocument, PublicApiEnv, UpstreamPost, UpstreamProfile, withinLimit } from './publicApi.js';
import {
  availableChains, cardPaymentsConfigured, checkOnchainPayment, handlePaymentsWebhook, linkWallet, PaymentsEnv, PaymentsError, paymentsAvailability, refreshPayoutAccount, startCardCheckout, startPayoutOnboarding,
} from './payments.js';
import { EventsUnavailable, PublicEventsEnv, upcomingEvents } from './publicEvents.js';
import { AgentAuthEnv, AgentAuthError, agentFromRequest, registerAgent } from './agentAuth.js';
import { refreshSignIn, requestSignInCode, SignInError, signOut, verifySignInCode } from './personSignIn.js';
import { handleSiteRequest, isSitePath, llmsTxt as siteLlmsTxt, searchDocs } from './agentSite.js';
import { mcpAppMimeType, postsViewHtml, postsViewUri } from './mcpAppView.js';
import { authenticate } from './session.js';
import { discloseLegalName, handleVerificationWebhook, startVerification, VerificationEnv, VerificationError, verificationConfigured } from './verification.js';

export type AgentEnv = PublicApiEnv & BridgesEnv & ContactsEnv & VerificationEnv & PublicEventsEnv & PaymentsEnv & AgentAuthEnv;

const version = '1.0.0';
const sources = ['open-media', 'farcaster', 'lens', 'hive', 'deso'] as const;
type Source = typeof sources[number];
const networkIds: NetworkId[] = ['farcaster', 'lens', 'hive', 'deso'];
const reportReasons = ['spam', 'harassment', 'other'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const handlePattern = /^[a-z0-9_]{3,24}$/i;

const publicHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'mcp-session-id',
  'x-content-type-options': 'nosniff',
  // About 120 requests a minute per client (the Cloudflare limiter does not report what is left).
  'ratelimit-policy': '"per-client";q=120;w=60',
};

export class AgentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function paymentsCall<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) { throw error instanceof PaymentsError ? new AgentError(error.status, error.code, error.message) : error; }
}

/** Paths served here. They are matched before the read-only public API and the mail routes. */
export function isAgentPath(pathname: string, method: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (isSitePath(path) || path === '/agent/identity' || path === '/ask' || path === '/feeds/posts.jsonl' || path.startsWith('/v1/auth/')) return true;
  if (['/', '/v1', '/v1/openapi.json', '/llms.txt', '/.well-known/mcp.json', '/.well-known/mcp-server', '/open/mcp', '/me/mcp'].includes(path)) return true;
  if (['/v1/feed', '/v1/search', '/v1/networks', '/v1/settings', '/v1/about', '/v1/events/upcoming'].includes(path)) return true;
  if (method === 'PATCH' && /^\/v1\/me\/listings\/[^/]+$/.test(path)) return true;
  if (path === '/v1/me' || path.startsWith('/v1/me/')) return true;
  if (method === 'GET' && /^\/v1\/people\/[^/]+\/[^/]+$/.test(path)) return true;
  if (method === 'POST' && path === '/v1/verification/stripe/webhook') return true;
  if (method === 'POST' && path === '/v1/payments/stripe/webhook') return true;
  return method !== 'GET' && /^\/v1\/posts\/[^/]+\/report$/.test(path);
}

// ─── Public capabilities ────────────────────────────────────────────────────

/** A post in one shape, whichever network it came from, with its “Why this?” explanation. */
export interface AgentPost {
  id: string;
  network: Source;
  author: { name: string; handle: string; avatarUrl: string | null };
  title: string | null;
  text: string;
  createdAt: string;
  url: string | null;
  media: { type: 'image' | 'video'; url: string; posterUrl: string | null; durationSeconds: number | null; altText: string | null }[];
  engagement: { replies: number; reposts: number; likes: number } | null;
  why: { used: string[]; filters: string[]; notUsed: string[] };
  /** A product or service on offer, with the price in minor units (cents). */
  listing?: PostListing;
}

export function agentPost(post: SocialPost, mode: FeedMode, origin: string): AgentPost {
  const network = (post.provenance.connectorId === 'open-media' ? 'open-media' : post.provenance.connectorId) as Source;
  const explanation = explainFeedPost(post, mode);
  return {
    id: post.id,
    network,
    author: { name: post.author.displayName, handle: post.author.handle, avatarUrl: post.author.avatarUrl ?? null },
    title: post.title ?? null,
    text: post.body,
    createdAt: post.createdAt,
    url: network === 'open-media' ? `${origin}/v1/posts/${post.id.replace(/^open-media-/, '')}` : post.provenance.canonicalURL ?? null,
    media: (post.media ?? []).flatMap((item) => item.url ? [{ type: item.kind, url: item.url, posterUrl: item.posterUrl ?? null, durationSeconds: item.durationSeconds ?? null, altText: item.altText || null }] : []),
    engagement: post.engagement ?? null,
    why: { used: explanation.used, filters: explanation.filters, notUsed: explanation.notUsed },
    ...(post.listing ? { listing: post.listing } : {}),
  };
}

type FeedCursor = Partial<Record<Source, string | { createdAt: string; id: string }>>;

export async function feed(env: AgentEnv, origin: string, options: { sources?: Source[]; kind?: 'feed' | 'clips'; mode?: FeedMode; cursor?: string }) {
  const chosen = options.sources?.length ? options.sources : [...sources];
  const kind = options.kind ?? 'feed';
  const mode = options.mode ?? 'raw';
  const cursor = options.cursor ? decodeFeedCursor(options.cursor) : {};
  const results = await Promise.allSettled(chosen.map(async (source) => {
    if (source === 'open-media') {
      const before = cursor['open-media'] as { createdAt: string; id: string } | undefined;
      const records = await callRpc<PublicPostRecord[]>(env, fetch, 'open_media_public_posts', {
        p_limit: 20, p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null, p_author_handle: null, p_media: kind === 'clips' ? 'video' : null,
      });
      const items = Array.isArray(records) ? records : [];
      const last = items[items.length - 1];
      return { source, posts: items.map((record) => socialPostFromPublic(record, env.SUPABASE_URL)), next: items.length === 20 && last ? { createdAt: last.createdAt, id: last.id } : undefined };
    }
    const connector = networkConnectors.find((item) => item.id === source)!;
    const previous = typeof cursor[source] === 'string' ? cursor[source] as string : undefined;
    const page = kind === 'clips' ? await connector.fetchClips(previous) : await connector.fetchFeed!(previous);
    return { source, posts: page.posts, next: page.cursor };
  }));
  const posts: SocialPost[] = [];
  const next: FeedCursor = {};
  const unavailable: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      posts.push(...result.value.posts);
      if (result.value.next) next[result.value.source] = result.value.next;
    } else unavailable.push(chosen[index]);
  });
  const ordered = mode === 'raw'
    ? collapseRepeatedPosts(posts).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    : collapseRepeatedPosts(posts);
  return {
    data: ordered.map((post) => agentPost(post, mode, origin)),
    mode,
    kind,
    sources: chosen,
    unavailable,
    nextCursor: Object.keys(next).length ? encodeJson(next) : null,
  };
}

export async function search(env: AgentEnv, origin: string, query: string) {
  const parsed = parseSearchQuery(query);
  if (!parsed.raw) throw new AgentError(400, 'bad_request', 'Add a search, for example q=videos about ethereum on lens.');
  if (parsed.structured === 'event') {
    const events = await upcomingEvents(env, { query: parsed.text, days: 14, limit: 30 });
    return { query: parsed.raw, understood: parsed.understood, settings: searchSettings(parsed.raw).slice(0, 5), area: events.area, events: events.data, posts: [], methods: events.providers.map((item) => ({ network: item.provider, method: 'upcoming public events', status: item.status === 'ok' ? 'ok' : 'unavailable', count: events.data.filter((event) => event.sources.some((source) => source.provider === item.provider)).length })) };
  }
  // Products and services are Open Media listings; other networks have none.
  const wanted = parsed.structured ? [] : networkSearches.filter((network) => !parsed.networks || parsed.networks.includes(network.id));
  const [ownPosts, ...networkResults] = await Promise.allSettled([
    callRpc<PublicPostRecord[]>(env, fetch, 'open_media_public_posts', { p_limit: 50, p_before_created_at: null, p_before_id: null, p_author_handle: null, p_media: parsed.media === 'video' ? 'video' : null }),
    ...wanted.map((network) => network.search(parsed)),
  ]);
  const posts: SocialPost[] = [];
  const methods: { network: string; method: string; status: 'ok' | 'unavailable'; count: number }[] = [];
  if (ownPosts.status === 'fulfilled' && (!parsed.networks || parsed.networks.length === 0)) {
    const own = (Array.isArray(ownPosts.value) ? ownPosts.value : []).map((record) => socialPostFromPublic(record, env.SUPABASE_URL)).filter((post) => postMatchesSearch(post, parsed));
    posts.push(...own);
    methods.push({ network: 'open-media', method: 'newest 50 public posts', status: 'ok', count: own.length });
  }
  networkResults.forEach((result, index) => {
    const network = wanted[index];
    if (result.status === 'fulfilled') {
      posts.push(...result.value);
      methods.push({ network: network.id, method: network.method(parsed), status: 'ok', count: result.value.length });
    } else methods.push({ network: network.id, method: network.method(parsed), status: 'unavailable', count: 0 });
  });
  const ordered = collapseRepeatedPosts(posts).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 60);
  return {
    query: parsed.raw,
    understood: parsed.understood,
    settings: searchSettings(parsed.raw).slice(0, 5),
    posts: ordered.map((post) => agentPost(post, 'raw', origin)),
    methods,
  };
}

export function networksDescription(env: AgentEnv) {
  const running = new Set(availableNetworks(env));
  return {
    openMedia: { id: 'open-media', name: 'Open Media', capabilities: ['read public posts', 'publish posts', 'delete own posts', 'report posts', 'direct messages', 'data export', 'account deletion (in the app)'] },
    openNetworks: networkIds.map((id) => {
      const descriptor = networkConnectors.find((connector) => connector.id === id)!.descriptor();
      return {
        id, name: networks[id].displayName, kind: 'open social network', readsWithoutAccount: true,
        capabilities: descriptor.capabilities.map((capability) => ({ operation: capability.operation, available: capability.available, ...(capability.reason ? { reason: capability.reason } : {}) })),
        crossPosting: 'Connect it in the app (Settings → Cross-posting) with a key you approve in that network; Open Media never asks for a seed phrase.',
      };
    }),
    email: { id: 'email', name: 'Email', kind: 'IMAP or POP3 with SMTP', capabilities: ['read', 'reply', 'send'], how: 'Connect in the app (Settings → Email & connections), or POST /v1/mail-accounts with your access token.' },
    chatNetworks: chatNetworks.map((network) => ({
      id: network.id, name: network.name, kind: 'chat bridge (opt-in)', runningOnThisServer: running.has(network.id), accountRisk: network.risk,
      ...(network.setup && !running.has(network.id) ? { setup: network.setup } : {}),
      capabilities: running.has(network.id) ? ['read messages', 'send text'] : [],
      notYet: ['attachments'],
    })),
    notReachable: unreachableChatNetworks,
    events: { id: 'events', name: 'Open Media Events', kind: 'MCP server with OAuth 2.1', path: '/mcp', capabilities: ['search events', 'check schedule', 'plan', 'calendar holds', 'registration handoff'] },
  };
}

export function settingsLookup(query: string | null) {
  const entries = query ? searchSettings(query) : settingIndex;
  return { query: query ?? '', data: entries.map((entry) => ({ ...entry, where: `Settings → ${entry.title}` })) };
}

export function aboutOpenMedia(origin: string) {
  return {
    name: 'Open Media', tagline, promise, mission, philosophy, promises, surfaces: surfaces.map(({ name, body }) => ({ name, body })),
    principles, neverDefaults, roadmap, honestStatus, sourceCode: sourceRepository, license: 'MIT',
    interfaces: { api: `${origin}/v1`, openapi: `${origin}/v1/openapi.json`, llms: `${origin}/llms.txt`, mcp: agentInterfaces.mcp.map((server) => ({ ...server, url: `${origin}${server.path}` })) },
  };
}

async function publicPost(env: AgentEnv, origin: string, id: string) {
  if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Post not found.');
  const post = await callRpc<UpstreamPost | null>(env, fetch, 'open_media_public_post', { p_post_id: id });
  if (!post) throw new AgentError(404, 'not_found', 'Post not found.');
  return formatPost(post, origin, env.SUPABASE_URL);
}

async function publicProfile(env: AgentEnv, origin: string, handle: string) {
  const clean = handle.replace(/^@/, '').toLowerCase();
  if (!handlePattern.test(clean)) throw new AgentError(404, 'not_found', 'Profile not found.');
  const profile = await callRpc<UpstreamProfile | null>(env, fetch, 'open_media_public_profile', { p_handle: clean });
  if (!profile) throw new AgentError(404, 'not_found', 'Profile not found.');
  const posts = await callRpc<UpstreamPost[]>(env, fetch, 'open_media_public_posts', { p_limit: 20, p_before_created_at: null, p_before_id: null, p_author_handle: clean, p_media: null });
  return { ...formatProfile(profile, origin), recentPosts: (Array.isArray(posts) ? posts : []).map((post) => formatPost(post, origin, env.SUPABASE_URL)) };
}

/**
 * One person's public posts in one timeline (ADR 0013). For an Open Media handle: their profile,
 * their posts, and the open-network accounts they chose to list, merged newest first. For an
 * open-network handle: that account's own posts. Linked accounts are declared, not proven.
 */
export async function personTimeline(env: AgentEnv, origin: string, network: string, handle: string, cursor?: string) {
  const clean = handle.replace(/^@/, '');
  if (network !== 'open-media' && network !== 'open_media') {
    if (!(authorNetworks as string[]).includes(network)) throw new AgentError(400, 'bad_request', `network must be open-media or one of ${authorNetworks.join(', ')}.`);
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(clean)) throw new AgentError(404, 'not_found', 'Account not found.');
    const page = await fetchAuthorPosts(network as NetworkId, clean, cursor).catch(() => { throw new AgentError(502, 'upstream_unavailable', `${networks[network as NetworkId].displayName} did not answer. Try again shortly.`); });
    return { network, handle: clean, data: page.posts.map((post) => agentPost(post, 'raw', origin)), nextCursor: page.cursor ?? null };
  }
  const profile = await publicProfile(env, origin, clean);
  const linked = (profile.linkedAccounts ?? []).filter((item) => (authorNetworks as string[]).includes(item.network));
  const pages = await Promise.allSettled(linked.map((item) => fetchAuthorPosts(item.network as NetworkId, item.handle)));
  const posts: SocialPost[] = [];
  const unavailable: string[] = [];
  pages.forEach((page, index) => page.status === 'fulfilled' ? posts.push(...page.value.posts) : unavailable.push(`${linked[index].network}:${linked[index].handle}`));
  const own = profile.recentPosts as (ReturnType<typeof formatPost> & { createdAt?: string })[];
  const theirs = posts.map((post) => agentPost(post, 'raw', origin));
  const merged = [...own.map((post) => ({ at: Date.parse(String(post.createdAt ?? '')), post: post as unknown })), ...theirs.map((post) => ({ at: Date.parse(post.createdAt), post: post as unknown }))]
    .sort((left, right) => (right.at || 0) - (left.at || 0)).map((item) => item.post);
  const { recentPosts: _recent, ...person } = profile;
  return { person, data: merged, unavailable, note: 'Linked accounts are listed by the person themselves and are not proof of ownership.' };
}

// ─── Account capabilities (the person's own access token) ───────────────────

/** Acts as one signed-in person through Supabase's REST API; row-level security enforces it. */
/** The Worker's own mail, chat-bridge and cross-posting routes, so their checks and rate limits still apply. */
export type InternalHandler = (request: Request) => Promise<Response>;

export class Account {
  constructor(private readonly env: AgentEnv, private readonly token: string, readonly userId: string, private readonly origin: string, private readonly internal?: InternalHandler) {}

  static async fromRequest(request: Request, env: AgentEnv, origin: string, internal?: InternalHandler): Promise<Account> {
    try {
      const { token, userId } = await authenticate(request, env.SUPABASE_URL.replace(/\/$/, ''));
      return new Account(env, token, userId, origin, internal);
    } catch {
      throw new AgentError(401, 'unauthorized', 'Send your Open Media access token as “Authorization: Bearer …”. Sign in with POST /v1/auth/email-code and /v1/auth/verify, or copy one in the app: Settings → Developers and agents.');
    }
  }

  /** A new account picks its name and handle, as the app's “Create your profile” screen does. */
  async setUpProfile(body: unknown) {
    const input = (body && typeof body === 'object' ? body : {}) as { displayName?: unknown; handle?: unknown };
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const handle = typeof input.handle === 'string' ? input.handle.trim().toLowerCase().replace(/^@/, '') : '';
    if (!displayName || displayName.length > 80) throw new AgentError(400, 'bad_request', 'Send displayName (1 to 80 characters).');
    if (!/^[a-z0-9_]{3,24}$/.test(handle)) throw new AgentError(400, 'bad_request', 'Send handle: 3 to 24 lowercase letters, numbers or underscores.');
    try {
      await this.rest('POST', '/rest/v1/profiles?on_conflict=id', { id: this.userId, display_name: displayName, handle }, 'resolution=merge-duplicates,return=minimal');
    } catch (error) {
      if (error instanceof AgentError && /duplicate|unique|already/i.test(error.message)) throw new AgentError(409, 'handle_taken', 'That handle is already taken. Try another.');
      throw error;
    }
    return this.me();
  }

  async me() {
    const [profile] = await this.rest<{ id: string; handle: string; display_name: string; bio: string; avatar_url: string | null }[]>('GET', `/rest/v1/profiles?id=eq.${this.userId}&select=id,handle,display_name,bio,avatar_url`);
    if (!profile) throw new AgentError(404, 'no_profile', 'This account has no profile yet. Choose a name and handle with PUT /v1/me/profile (or the set_up_profile tool), or in the app.');
    return { id: profile.id, handle: profile.handle, displayName: profile.display_name, bio: profile.bio, avatarUrl: profile.avatar_url, url: `${this.origin}/v1/profiles/${profile.handle}` };
  }

  async publish(body: unknown, clientId: string = crypto.randomUUID()) {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new AgentError(400, 'bad_request', 'Write something before publishing.');
    if (text.length > maxPostLength) throw new AgentError(400, 'bad_request', `Posts can be up to ${maxPostLength} characters.`);
    const post = await this.rpc<UpstreamPost>('open_media_create_post', { p_client_id: clientId, p_body: text, p_video: null });
    return formatPost(post, this.origin, this.env.SUPABASE_URL);
  }

  async deletePost(id: string) {
    if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Post not found.');
    const [row] = await this.rest<{ video_path: string | null; video_poster_path: string | null }[]>('GET', `/rest/v1/posts?id=eq.${id}&select=video_path,video_poster_path`);
    await this.rpc('open_media_delete_post', { p_post_id: id });
    const files = [row?.video_path, row?.video_poster_path].filter((path): path is string => Boolean(path));
    if (files.length) await this.rest('DELETE', '/storage/v1/object/post-videos', { prefixes: files }).catch(() => undefined);
    return { deleted: id };
  }

  async report(id: string, reason: unknown, details: unknown) {
    if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Post not found.');
    if (!reportReasons.includes(reason as typeof reportReasons[number])) throw new AgentError(400, 'bad_request', `reason must be one of ${reportReasons.join(', ')}.`);
    await this.rpc('open_media_report_post', { p_post_id: id, p_reason: reason, p_details: typeof details === 'string' ? details.slice(0, 1000) : '' });
    return { reported: id, note: 'Posts reported by three different people are hidden for review.' };
  }

  async conversations(limitMessages = 20) {
    const memberships = await this.rest<{ conversation_id: string }[]>('GET', `/rest/v1/conversation_members?user_id=eq.${this.userId}&select=conversation_id`);
    const ids = memberships.map((row) => row.conversation_id);
    if (!ids.length) return { data: [] };
    const list = `(${ids.join(',')})`;
    const [conversations, members, messages] = await Promise.all([
      this.rest<{ id: string; kind: string; title: string | null; updated_at: string }[]>('GET', `/rest/v1/conversations?id=in.${list}&select=id,kind,title,updated_at&order=updated_at.desc`),
      this.rest<{ conversation_id: string; user_id: string }[]>('GET', `/rest/v1/conversation_members?conversation_id=in.${list}&select=conversation_id,user_id`),
      this.rest<{ id: string; conversation_id: string; sender_id: string; body: string; created_at: string }[]>('GET', `/rest/v1/messages?conversation_id=in.${list}&select=id,conversation_id,sender_id,body,created_at&order=created_at.desc&limit=${Math.min(500, ids.length * limitMessages)}`),
    ]);
    const people = [...new Set(members.map((row) => row.user_id))];
    // Shown names come from the server, so a name someone withheld never reaches an agent.
    const profiles = people.length ? await this.rpc<{ id: string; handle: string; displayName: string }[]>('open_media_profile_cards', { p_ids: people }) : [];
    const byId = new Map((profiles ?? []).map((row) => [row.id, row]));
    const name = (id: string) => byId.get(id)?.displayName || byId.get(id)?.handle || 'Someone';
    return {
      data: conversations.map((conversation) => ({
        id: conversation.id,
        kind: conversation.kind,
        title: conversation.title ?? members.filter((row) => row.conversation_id === conversation.id && row.user_id !== this.userId).map((row) => name(row.user_id)).join(', '),
        with: members.filter((row) => row.conversation_id === conversation.id && row.user_id !== this.userId).map((row) => ({ handle: byId.get(row.user_id)?.handle ?? null, name: name(row.user_id) })),
        updatedAt: conversation.updated_at,
        messages: messages.filter((message) => message.conversation_id === conversation.id).slice(0, limitMessages).reverse()
          .map((message) => ({ id: message.id, from: message.sender_id === this.userId ? 'me' : name(message.sender_id), body: message.body, sentAt: message.created_at })),
      })),
    };
  }

  async startConversation(handle: unknown) {
    const clean = typeof handle === 'string' ? handle.replace(/^@/, '').toLowerCase() : '';
    if (!handlePattern.test(clean)) throw new AgentError(400, 'bad_request', 'Give the Open Media handle of the person to message.');
    const person = await this.rpc<{ id: string } | null>('open_media_public_profile', { p_handle: clean });
    if (!person) throw new AgentError(404, 'not_found', `No one is called @${clean} on Open Media.`);
    if (person.id === this.userId) throw new AgentError(400, 'bad_request', 'That’s you.');
    const id = await this.rpc<string>('open_media_start_direct_conversation', { p_other_user_id: person.id });
    return { id, with: `@${clean}` };
  }

  async send(conversationId: string, body: unknown) {
    if (!uuid.test(conversationId)) throw new AgentError(404, 'not_found', 'Conversation not found.');
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new AgentError(400, 'bad_request', 'Write a message first.');
    if (text.length > 8000) throw new AgentError(400, 'bad_request', 'Messages can be up to 8,000 characters.');
    await this.rest('POST', '/rest/v1/messages', { conversation_id: conversationId, sender_id: this.userId, client_id: crypto.randomUUID(), body: text, transport: 'open_media' });
    return { sent: true, conversationId };
  }

  async exportData() {
    return this.rpc<Record<string, unknown>>('open_media_export_account_data', {});
  }

  // Contact cards: the person's own address book, encrypted before storage (ADR 0013).
  async contacts() {
    const key = contactsKey(this.env);
    const rows = await this.rest<{ id: string; ciphertext: string }[]>('GET', '/rest/v1/contact_cards?select=id,ciphertext&order=updated_at.desc&limit=5000');
    return { data: rows.map((row) => openCard(row.ciphertext, key)).filter(Boolean), note: 'Only you can read these. They are never shown to anyone else.' };
  }

  async saveContacts(value: unknown) {
    let cards: ReturnType<typeof validCards>;
    try { cards = validCards(value); } catch (error) { throw new AgentError(400, 'bad_request', error instanceof Error ? error.message : 'Check the contact cards.'); }
    const key = contactsKey(this.env);
    const now = new Date().toISOString();
    await this.rest('POST', '/rest/v1/contact_cards?on_conflict=id', cards.map((card) => ({ id: card.id, owner_id: this.userId, ciphertext: sealCard(card, key), updated_at: now })), 'resolution=merge-duplicates,return=minimal');
    return { saved: cards.length };
  }

  async deleteContact(id: string) {
    if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Contact not found.');
    await this.rest('DELETE', `/rest/v1/contact_cards?id=eq.${id}`);
    return { deleted: id };
  }

  /** Public, owner-declared accounts on open networks; they build the person's unified timeline. */
  async setLinkedAccounts(value: unknown) {
    const accounts = Array.isArray(value) ? value : [];
    if (accounts.length > 8 || !accounts.every((item) => item && typeof item === 'object' && ['farcaster', 'lens', 'hive', 'deso'].includes((item as { network?: string }).network ?? '') && /^[A-Za-z0-9._-]{1,64}$/.test(String((item as { handle?: string }).handle ?? '').replace(/^@/, '')))) {
      throw new AgentError(400, 'bad_request', 'Give up to 8 accounts as {network: farcaster|lens|hive|deso, handle}.');
    }
    const clean = accounts.map((item) => ({ network: (item as { network: string }).network, handle: String((item as { handle: string }).handle).replace(/^@/, '') }));
    await this.rest('PATCH', `/rest/v1/profiles?id=eq.${this.userId}`, { linked_accounts: clean });
    return { linkedAccounts: clean, note: 'These links are public and declared by you; they are not proof of ownership.' };
  }

  // Products and services (ADR 0013, phase 3).
  async publishListing(body: Record<string, unknown>, clientId: string = crypto.randomUUID()) {
    const checked = validateListing({
      kind: body.kind === 'service' ? 'service' : 'product', title: String(body.title ?? ''), price: body.price === undefined || body.price === null ? undefined : String(body.price),
      currency: typeof body.currency === 'string' ? body.currency : undefined, location: typeof body.location === 'string' ? body.location : undefined, remote: body.remote === true,
    });
    if ('error' in checked) throw new AgentError(400, 'bad_request', checked.error);
    if (body.kind !== 'product' && body.kind !== 'service') throw new AgentError(400, 'bad_request', 'kind must be product or service.');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > maxPostLength) throw new AgentError(400, 'bad_request', `Posts can be up to ${maxPostLength} characters.`);
    const post = await this.rpc<UpstreamPost & { listing?: PostListing }>('open_media_create_listing_post', { p_client_id: clientId, p_body: text, p_listing: checked.listing });
    return { ...formatPost(post, this.origin, this.env.SUPABASE_URL), listing: post.listing };
  }

  async updateListing(postId: string, body: Record<string, unknown>) {
    if (!uuid.test(postId)) throw new AgentError(404, 'not_found', 'Listing not found.');
    const changes: Record<string, unknown> = {};
    if (body.availability !== undefined) {
      if (!['available', 'limited', 'sold_out'].includes(String(body.availability))) throw new AgentError(400, 'bad_request', 'availability must be available, limited or sold_out.');
      changes.availability = body.availability;
    }
    if (body.priceMinor !== undefined) {
      if (body.priceMinor !== null && !(Number.isInteger(body.priceMinor) && (body.priceMinor as number) >= 0 && (body.priceMinor as number) <= 100_000_000)) throw new AgentError(400, 'bad_request', 'priceMinor must be a whole number of cents, or null.');
      changes.priceMinor = body.priceMinor;
    }
    if (body.location !== undefined) changes.location = body.location === null ? '' : String(body.location).slice(0, 120);
    if (body.remote !== undefined) changes.remote = body.remote === true;
    if (!Object.keys(changes).length) throw new AgentError(400, 'bad_request', 'Send availability, priceMinor, location or remote.');
    return this.rpc('open_media_update_listing', { p_post_id: postId, p_changes: changes });
  }

  /** One to five stars, or null to withdraw. The database allows only tier 5 (verified, legal name shown). */
  async rateListing(postId: string, stars: unknown) {
    if (!uuid.test(postId)) throw new AgentError(404, 'not_found', 'Listing not found.');
    if (stars === null) return this.rpc('open_media_remove_rating', { p_post_id: postId });
    if (!Number.isInteger(stars) || (stars as number) < 1 || (stars as number) > 5) throw new AgentError(400, 'bad_request', 'stars must be a whole number from 1 to 5, or null to withdraw.');
    return this.rpc('open_media_rate_listing', { p_post_id: postId, p_stars: stars });
  }

  // Identity, privacy and follows (ADR 0013, phase 2). Tier and tick are computed by the database.
  async identity() {
    const identity = await this.rpc<Record<string, unknown>>('open_media_my_identity', {});
    return { ...identity, verificationAvailable: verificationConfigured(this.env) };
  }

  async setIdentity(body: Record<string, unknown>) {
    const change: Record<string, string> = {};
    if (body.nameDisclosure !== undefined) {
      if (!['handle_only', 'declared', 'verified_legal'].includes(String(body.nameDisclosure))) throw new AgentError(400, 'bad_request', 'nameDisclosure must be handle_only, declared or verified_legal.');
      change.name_disclosure = String(body.nameDisclosure);
    }
    if (body.visibility !== undefined) {
      if (!['public', 'private'].includes(String(body.visibility))) throw new AgentError(400, 'bad_request', 'visibility must be public or private.');
      change.visibility = String(body.visibility);
    }
    if (!Object.keys(change).length) throw new AgentError(400, 'bad_request', 'Send nameDisclosure and/or visibility.');
    await this.rest('PATCH', `/rest/v1/profiles?id=eq.${this.userId}`, change);
    if (change.name_disclosure === 'verified_legal') {
      const [row] = await this.rest<{ legal_name_ciphertext: string | null }[]>('GET', `/rest/v1/identity_verifications?user_id=eq.${this.userId}&select=legal_name_ciphertext`);
      try { await discloseLegalName(this.env, this.userId, row?.legal_name_ciphertext ?? null); }
      catch (error) {
        await this.rest('PATCH', `/rest/v1/profiles?id=eq.${this.userId}`, { name_disclosure: 'declared' }).catch(() => undefined);
        throw error instanceof VerificationError ? new AgentError(error.status, error.code, error.message) : error;
      }
    }
    return this.identity();
  }

  async startVerification() {
    try { return { ...(await startVerification(this.env, this.userId)), note: 'Open this link to verify with Stripe Identity. Stripe keeps your document and selfie; Open Media keeps only the result.' }; }
    catch (error) { throw error instanceof VerificationError ? new AgentError(error.status, error.code, error.message) : error; }
  }

  // Payments (ADR 0013, phase 5). Who is paid and how much always come from the database, never
  // from the caller, and only Stripe's webhook or the chain can confirm a payment.
  async paymentSetup() {
    const setup = await this.rpc<Record<string, unknown>>('open_media_payment_setup', {});
    return { ...setup, available: paymentsAvailability(this.env) };
  }

  async startPayouts() {
    const [row] = await this.rest<{ stripe_account_id: string }[]>('GET', `/rest/v1/payment_accounts?user_id=eq.${this.userId}&select=stripe_account_id`);
    const link = await paymentsCall(() => startPayoutOnboarding(this.env, this.userId, row?.stripe_account_id ?? null));
    return { url: link.url, note: 'Open this link to set up payouts with Stripe. Stripe collects your bank and tax details; Open Media never sees them.' };
  }

  async refreshPayouts() {
    const [row] = await this.rest<{ stripe_account_id: string }[]>('GET', `/rest/v1/payment_accounts?user_id=eq.${this.userId}&select=stripe_account_id`);
    if (!row) throw new AgentError(404, 'not_found', 'Set up payouts first.');
    await paymentsCall(() => refreshPayoutAccount(this.env, this.userId, row.stripe_account_id));
    return this.paymentSetup();
  }

  async linkWallet(body: Record<string, unknown>) {
    return paymentsCall(() => linkWallet(this.env, this.userId, body));
  }

  async removeWallet(id: string) {
    if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Wallet not found.');
    await this.rpc('open_media_remove_wallet', { p_wallet_id: id });
    return { removed: true };
  }

  async paymentOptions(postId: string) {
    if (!uuid.test(postId)) throw new AgentError(404, 'not_found', 'Listing not found.');
    const options = await this.rpc<{ card: boolean; chains: string[]; priceMinor: number | null; currency: string; available: boolean; platformFeeBps: number } | null>('open_media_listing_payment_options', { p_post_id: postId });
    if (!options) throw new AgentError(404, 'not_found', 'Listing not found.');
    const chains = availableChains(this.env);
    return { ...options, card: options.card && cardPaymentsConfigured(this.env), chains: options.chains.filter((chain) => chains.includes(chain as never)), testMode: !paymentsAvailability(this.env).live };
  }

  async payments(limit = 50) {
    return this.rpc<Payment[]>('open_media_my_payments', { p_limit: Math.min(Math.max(Math.trunc(limit) || 50, 1), 200) });
  }

  async payment(id: string) {
    if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Payment not found.');
    const payment = await this.rpc<Payment | null>('open_media_payment', { p_intent_id: id });
    if (!payment) throw new AgentError(404, 'not_found', 'Payment not found.');
    const transfer = payment.rail === 'onchain' && payment.direction === 'sent' && ['created', 'awaiting_payer'].includes(payment.status) ? onchainTransfer(payment) : undefined;
    return { ...payment, ...(transfer ? { transfer } : {}) };
  }

  /**
   * Starts paying for something. Card: returns Stripe's checkout page for the person to open.
   * USDC: returns the exact transfer for the person's own wallet to approve. Nothing is charged here.
   */
  async pay(body: Record<string, unknown>) {
    const contextType = String(body.contextType ?? 'listing');
    const contextId = String(body.contextId ?? body.postId ?? '');
    const rail = String(body.rail ?? '');
    if (!['listing', 'tip', 'paid_post'].includes(contextType)) throw new AgentError(400, 'bad_request', 'contextType must be listing, tip or paid_post.');
    if (!uuid.test(contextId)) throw new AgentError(400, 'bad_request', 'contextId must be the post id.');
    const amountMinor = contextType === 'tip' ? body.amountMinor : null;
    if (contextType === 'tip' && !(Number.isInteger(amountMinor) && (amountMinor as number) >= 100 && (amountMinor as number) <= 50_000)) throw new AgentError(400, 'bad_request', 'amountMinor must be a tip from 100 to 50000 cents (1 to 500 US dollars).');
    if (rail !== 'card' && rail !== 'onchain') throw new AgentError(400, 'bad_request', 'rail must be card or onchain.');
    const chain = rail === 'onchain' ? String(body.chain ?? 'base-sepolia') : null;
    if (rail === 'card' && !cardPaymentsConfigured(this.env)) throw new AgentError(503, 'not_configured', 'Card payments are not available on this server yet.');
    if (chain && (!isPaymentChain(chain) || !availableChains(this.env).includes(chain))) throw new AgentError(503, 'not_configured', `USDC payments on ${chain} are not available on this server.`);
    const key = typeof body.idempotencyKey === 'string' && uuid.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID();
    const created = await this.rpc<Payment>('open_media_create_payment_intent', { p_idempotency_key: key, p_context_type: contextType, p_context_id: contextId, p_rail: rail, p_chain: chain, p_amount_minor: amountMinor });
    if (rail === 'card') {
      const { checkoutUrl } = await paymentsCall(() => startCardCheckout(this.env, created.id, this.userId));
      return { payment: await this.payment(created.id), checkoutUrl, note: 'Open checkoutUrl to pay by card on Stripe’s page. The payment is confirmed only after Stripe reports it paid.' };
    }
    return { payment: await this.payment(created.id), note: 'Approve this USDC transfer in your own wallet, then send its transaction hash. It is confirmed only after Open Media reads it on the network.' };
  }

  // ONDC store (ADR 0015): the details ONDC buyer apps need to show this person's INR products.
  async ondcStore() {
    return { store: await this.rpc<object | null>('open_media_get_ondc_store', {}) };
  }

  async setOndcStore(input: unknown) {
    if (!input || typeof input !== 'object') throw new AgentError(400, 'bad_request', 'Send the store details as an object.');
    const { store, errors } = validateOndcStore(input as Record<string, unknown>);
    const first = Object.values(errors)[0];
    if (first) throw new AgentError(400, 'bad_request', first);
    return { store: await this.rpc<object>('open_media_set_ondc_store', { p_store: store }) };
  }

  // Tips and paid posts (ADR 0013, phase 6).
  async setTips(enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new AgentError(400, 'bad_request', 'Send enabled: true or false.');
    return { tipsEnabled: await this.rpc<boolean>('open_media_set_tips_enabled', { p_enabled: enabled }) };
  }

  async postPaymentOptions(postId: string) {
    if (!uuid.test(postId)) throw new AgentError(404, 'not_found', 'Post not found.');
    const options = await this.rpc<{ card: boolean; chains: string[]; tipsEnabled: boolean; paid: unknown; fees: Record<string, number> } | null>('open_media_post_payment_options', { p_post_id: postId });
    if (!options) throw new AgentError(404, 'not_found', 'Post not found.');
    const chains = availableChains(this.env);
    return { ...options, card: options.card && cardPaymentsConfigured(this.env), chains: options.chains.filter((chain) => chains.includes(chain as never)), testMode: !paymentsAvailability(this.env).live };
  }

  async publishPaidPost(body: Record<string, unknown>, clientId: string = crypto.randomUUID()) {
    const preview = typeof body.preview === 'string' ? body.preview.trim() : '';
    const paid = typeof body.paidText === 'string' ? body.paidText.trim() : '';
    if (!preview || preview.length > maxPostLength) throw new AgentError(400, 'bad_request', `Write a public preview of up to ${maxPostLength} characters.`);
    if (!paid || paid.length > 10_000) throw new AgentError(400, 'bad_request', 'paidText needs 1 to 10,000 characters.');
    if (!Number.isInteger(body.priceMinor) || (body.priceMinor as number) < 50) throw new AgentError(400, 'bad_request', 'priceMinor must be a whole number of cents, at least 50.');
    const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'USD';
    const post = await this.rpc<UpstreamPost & { paid?: unknown }>('open_media_create_paid_post', { p_client_id: clientId, p_preview: preview, p_paid_body: paid, p_price_minor: body.priceMinor, p_currency: currency });
    return { ...formatPost(post, this.origin, this.env.SUPABASE_URL), paid: post.paid };
  }

  async paidContent(postId: string) {
    if (!uuid.test(postId)) throw new AgentError(404, 'not_found', 'Post not found.');
    const content = await this.rpc<{ priceMinor: number; currency: string; unlocked: boolean; body: string | null } | null>('open_media_paid_post_content', { p_post_id: postId });
    if (!content) throw new AgentError(404, 'not_found', 'This post has no paid part.');
    return content;
  }

  /**
   * What a payment would be, without starting it: who is paid, how much, and every fee. Agents
   * show this to the person and start the payment only after the person agrees to that amount.
   */
  async previewPayment(body: Record<string, unknown>) {
    const contextType = String(body.contextType ?? 'listing');
    const postId = String(body.contextId ?? body.postId ?? '');
    const rail = String(body.rail ?? '') as PaymentRail;
    if (!['listing', 'tip', 'paid_post'].includes(contextType)) throw new AgentError(400, 'bad_request', 'contextType must be listing, tip or paid_post.');
    if (rail !== 'card' && rail !== 'onchain') throw new AgentError(400, 'bad_request', 'rail must be card or onchain.');
    const chain = rail === 'onchain' ? String(body.chain ?? 'base-sepolia') as PaymentChain : null;
    let priceMinor: number | null; let currency: string; let feeBps: number; let card: boolean; let chains: string[];
    if (contextType === 'listing') {
      const options = await this.paymentOptions(postId);
      if (!options.available) throw new AgentError(409, 'refused', 'This listing is sold out.');
      ({ priceMinor, currency, card, chains } = options); feeBps = options.platformFeeBps;
    } else {
      const options = await this.postPaymentOptions(postId);
      const paid = options.paid as { priceMinor: number; currency: string; unlocked: boolean } | null;
      if (contextType === 'tip' && !options.tipsEnabled) throw new AgentError(409, 'refused', 'This creator does not take tips.');
      if (contextType === 'paid_post' && (!paid || paid.unlocked)) throw new AgentError(409, 'refused', paid ? 'The person already unlocked this post.' : 'This post is free.');
      priceMinor = contextType === 'tip' ? (Number.isInteger(body.amountMinor) ? body.amountMinor as number : null) : paid!.priceMinor;
      currency = contextType === 'tip' ? 'USD' : paid!.currency;
      feeBps = options.fees[contextType] ?? 0; card = options.card; chains = options.chains;
    }
    if (!priceMinor) throw new AgentError(400, 'bad_request', contextType === 'tip' ? 'Ask the person how much to tip (amountMinor, 100 to 50000 cents).' : 'This has no price. Message the seller instead.');
    if (rail === 'card' && !card) throw new AgentError(409, 'refused', 'This person does not take card payments here.');
    if (rail === 'onchain' && !chains.includes(chain!)) throw new AgentError(409, 'refused', 'This person does not take USDC on that network here.');
    const post = await callRpc<UpstreamPost | null>(this.env, fetch, 'open_media_public_post', { p_post_id: postId }).catch(() => null);
    const recipient = (post as { author?: { handle?: string } } | null)?.author?.handle ?? null;
    const charge = previewCharge(priceMinor, currency, rail, chain, feeBps);
    return { contextType, postId, recipient, ...charge, breakdown: paymentBreakdown({ ...charge, recipient }) };
  }

  /** The agent's way to pay: refused until the person confirmed exactly this amount. */
  async startPaymentWithConfirmation(body: Record<string, unknown>) {
    const preview = await this.previewPayment(body);
    if (body.confirm !== true) {
      return { requiresConfirmation: true, preview, note: 'Nothing was started. Show the person who is paid, the amount and the fees. Only if they agree, call again with confirm: true and expectedAmountMinor set to this amountMinor.' };
    }
    if (body.expectedAmountMinor !== preview.amountMinor) throw new AgentError(409, 'confirmation_mismatch', 'The amount the person confirmed does not match. Show the new preview and ask again.');
    return this.pay(body);
  }

  async submitTransaction(id: string, txHash: unknown) {
    if (!uuid.test(id)) throw new AgentError(404, 'not_found', 'Payment not found.');
    if (typeof txHash !== 'string') throw new AgentError(400, 'bad_request', 'Send txHash.');
    await this.rpc('open_media_submit_onchain_payment', { p_intent_id: id, p_tx_hash: txHash });
    return this.checkPayment(id);
  }

  async checkPayment(id: string) {
    const payment = await this.payment(id);
    if (payment.rail !== 'onchain' || payment.direction !== 'sent' || payment.status !== 'submitted') return { payment };
    const check = await paymentsCall(() => checkOnchainPayment(this.env, id, this.userId));
    return { payment: await this.payment(id), detail: check.detail };
  }

  follows() { return this.rpc('open_media_my_follows', {}); }
  follow(handle: unknown) { return this.rpc('open_media_follow', { p_handle: this.cleanHandle(handle) }); }
  unfollow(handle: unknown) { return this.rpc('open_media_unfollow', { p_handle: this.cleanHandle(handle) }); }
  answerFollowRequest(followerId: string, accept: unknown) {
    if (!uuid.test(followerId)) throw new AgentError(404, 'not_found', 'Request not found.');
    return this.rpc('open_media_answer_follow_request', { p_follower: followerId, p_accept: accept === true });
  }
  removeFollower(followerId: string) {
    if (!uuid.test(followerId)) throw new AgentError(404, 'not_found', 'Follower not found.');
    return this.rpc('open_media_remove_follower', { p_follower: followerId });
  }

  private cleanHandle(handle: unknown): string {
    const clean = typeof handle === 'string' ? handle.replace(/^@/, '').toLowerCase() : '';
    if (!handlePattern.test(clean)) throw new AgentError(400, 'bad_request', 'Give an Open Media handle.');
    return clean;
  }

  // Email: stored mail is read from the database; mailbox actions go through the mail routes.
  async email(limit = 50) {
    const rows = await this.rpc<Record<string, unknown>[]>('open_media_list_mail_messages', { p_limit: Math.min(500, Math.max(1, limit)) });
    return {
      data: (rows ?? []).map((row) => ({
        mailboxId: row.account_id, account: row.account_email, folder: row.mailbox, from: row.sender ?? '', to: Array.isArray(row.recipients) ? row.recipients : [],
        subject: row.subject ?? '', text: row.body_text ?? '', sentAt: row.sent_at, messageId: row.source_message_id, inReplyTo: row.in_reply_to ?? null,
        senderVerified: row.sender_verified === true, attachments: Array.isArray(row.attachments) ? row.attachments.length : 0,
      })),
      note: 'Imported email is not end-to-end encrypted.',
    };
  }

  mailAccounts() { return this.call('GET', '/v1/mail-accounts'); }
  connectMail(input: unknown) { return this.call('POST', '/v1/mail-accounts', input); }
  syncMail(id: string) { return this.call('POST', `/v1/mail-accounts/${encodeURIComponent(id)}/sync`, {}); }
  sendEmail(id: string, mail: unknown) { return this.call('POST', `/v1/mail-accounts/${encodeURIComponent(id)}/send`, mail); }
  removeMail(id: string) { return this.call('DELETE', `/v1/mail-accounts/${encodeURIComponent(id)}`); }

  // Chat networks through bridges (ADR 0011).
  chatNetworks() { return this.call('GET', '/v1/bridges'); }
  bridgedChats() { return this.call('GET', '/v1/bridges/conversations'); }
  sendBridged(roomId: string, text: unknown) { return this.call('POST', `/v1/bridges/rooms/${encodeURIComponent(roomId)}/messages`, { body: text }); }
  chatSignInOptions(network: string) { return this.call('GET', `/v1/bridges/${encodeURIComponent(network)}/flows`); }
  startChatSignIn(network: string, flow: unknown) { return this.call('POST', `/v1/bridges/${encodeURIComponent(network)}/login/start`, { flow }); }
  continueChatSignIn(network: string, step: unknown) { return this.call('POST', `/v1/bridges/${encodeURIComponent(network)}/login/step`, step); }
  disconnectChat(network: string, loginId?: unknown) { return this.call('POST', `/v1/bridges/${encodeURIComponent(network)}/logout`, { loginId }); }

  async crossPosting() {
    const server = await this.call<{ farcaster?: boolean }>('GET', '/v1/cross-posting/status');
    return {
      ...server,
      how: 'Cross-posting is signed on the person’s own device with keys they approved in each network (Farcaster, Lens, Hive, DeSo); Open Media never holds those keys. Posts published through this API go to Open Media only. To publish everywhere, the person posts from the app, where connected networks are on by default.',
    };
  }

  // Safety.
  async block(handle: unknown, blocked: unknown) {
    const person = await this.personByHandle(handle);
    await this.rpc('open_media_set_user_blocked', { p_blocked_user_id: person, p_blocked: blocked !== false });
    return { handle: `@${String(handle).replace(/^@/, '').toLowerCase()}`, blocked: blocked !== false };
  }

  async reportConversation(conversationId: string, handle: unknown, messageId?: unknown) {
    if (!uuid.test(conversationId)) throw new AgentError(404, 'not_found', 'Conversation not found.');
    const person = await this.personByHandle(handle);
    await this.rpc('open_media_report_conversation', { p_conversation_id: conversationId, p_reported_user_id: person, p_message_id: typeof messageId === 'string' && uuid.test(messageId) ? messageId : null, p_reason: 'unwanted_contact', p_details: '' });
    return { reported: conversationId };
  }

  /** Irreversible, so it needs the exact phrase from the person, as the app's own dialog does. */
  async deleteAccount(confirmation: unknown) {
    if (confirmation !== 'delete my account') throw new AgentError(400, 'confirmation_required', 'Deleting an account cannot be undone. Ask the person, then send confirmation: "delete my account".');
    const files = await this.rest<{ name: string; id: string | null }[]>('POST', '/storage/v1/object/list/mail-attachments', { prefix: this.userId, limit: 1000 }).catch(() => []);
    const paths = files.filter((file) => file.id).map((file) => `${this.userId}/${file.name}`);
    if (paths.length) await this.rest('DELETE', '/storage/v1/object/mail-attachments', { prefixes: paths }).catch(() => undefined);
    await this.rpc('open_media_delete_account', {});
    return { deleted: true, note: 'The account, posts, messages and connected mailboxes are gone. Copies others already read cannot be recalled.' };
  }

  private async personByHandle(handle: unknown): Promise<string> {
    const clean = typeof handle === 'string' ? handle.replace(/^@/, '').toLowerCase() : '';
    if (!handlePattern.test(clean)) throw new AgentError(400, 'bad_request', 'Give an Open Media handle.');
    const person = await this.rpc<{ id: string } | null>('open_media_public_profile', { p_handle: clean });
    if (!person) throw new AgentError(404, 'not_found', `No one is called @${clean} on Open Media.`);
    return person.id;
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.internal) throw new AgentError(501, 'unavailable', 'This route is not available here.');
    const response = await this.internal(new Request(`${this.origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }));
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new AgentError(response.status, response.status === 429 ? 'rate_limited' : 'refused', result.error ?? 'Open Media refused that request.');
    return result as T;
  }

  private rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.rest<T>('POST', `/rest/v1/rpc/${name}`, args);
  }

  private async rest<T = unknown>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    const response = await fetch(`${this.env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        apikey: this.env.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(prefer ? { prefer } : method === 'POST' && !path.includes('/rpc/') ? { prefer: 'return=minimal' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { message?: string };
      // Database messages explain refusals (“you can only delete your own posts”) and contain no secrets.
      throw new AgentError(response.status === 401 ? 401 : response.status === 403 || response.status === 404 ? 403 : 400, 'refused', detail.message ?? 'Open Media refused that request.');
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

// ─── MCP servers ─────────────────────────────────────────────────────────────

const instructions = `Open Media is one open, black-and-white app for a person's social world: one feed across Open Media and the open networks Farcaster, Lens, Hive and DeSo, one inbox, and one post to every network the person chooses. ${mission} Present posts with their author and network, link to the source, and keep each post's “why” reasons when you summarise a feed. You are an agent: never pose as a person.`;

type Json = Record<string, unknown> | unknown[];

function result(payload: unknown, structured = false) {
  const text = JSON.stringify(payload);
  const content = [{ type: 'text' as const, text: text.length > 60_000 ? `${text.slice(0, 60_000)}…` : text }];
  // Tools with an MCP Apps view also return the object itself for the view to render.
  return structured && payload && typeof payload === 'object' && !Array.isArray(payload) ? { content, structuredContent: payload as Record<string, unknown> } : { content };
}

function failure(error: unknown) {
  const message = error instanceof AgentError ? error.message : 'Open Media hit an error. Try again shortly.';
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof AgentError ? error.code : 'internal_error', message }) }] };
}

function tool(server: McpServer, name: string, config: { title: string; description: string; input: z.ZodRawShape; readOnly: boolean; view?: string }, run: (args: Record<string, unknown>) => Promise<unknown> | unknown) {
  server.registerTool(name, {
    title: config.title,
    description: config.description,
    inputSchema: z.object(config.input),
    annotations: { readOnlyHint: config.readOnly, openWorldHint: true, destructiveHint: !config.readOnly && /^(delete|remove)_/.test(name) },
    ...(config.view ? { _meta: { ui: { resourceUri: config.view }, 'openai/outputTemplate': config.view } } : {}),
  }, (async (args: Record<string, unknown>) => {
    try { return result(await run(args ?? {}), Boolean(config.view)); } catch (error) { return failure(error); }
  }) as never);
}

function registerPublicTools(server: McpServer, env: AgentEnv, origin: string) {
  tool(server, 'request_sign_in_code', { title: 'Email the person a sign-in code', description: 'Starts signing the person in to their own Open Media account (or creating one): Open Media emails them a sign-in code from security@openmedia.site. Ask the person for their email first and tell them a code is coming. Then ask them for the code and call sign_in_with_code. Never guess or reuse codes.', input: { email: z.string().email() }, readOnly: false }, (args) => requestSignInCode(env, origin, args));
  tool(server, 'sign_in_with_code', { title: 'Finish signing in with the code', description: 'Exchanges the code the person read from their email for their session. Returns access_token (send it as “Authorization: Bearer …” to /v1/me and /me/mcp), refresh_token and expires_in. Treat both tokens as the person’s password: keep them private and never post them.', input: { email: z.string().email(), code: z.string().describe('The digits from the email') }, readOnly: false }, (args) => verifySignInCode(env, origin, args));
  tool(server, 'refresh_sign_in', { title: 'Renew a sign-in', description: 'Exchanges a refresh_token for a fresh access_token when the old one is about to expire.', input: { refresh_token: z.string() }, readOnly: false }, (args) => refreshSignIn(env, origin, args));
  server.registerResource('posts-view', postsViewUri, { title: 'Open Media posts', description: 'Shows posts from get_feed and search as a readable list with source links.', mimeType: mcpAppMimeType },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: mcpAppMimeType, text: postsViewHtml, _meta: { ui: { prefersBorder: true } } }] }));
  const sourceEnum = z.enum(sources);
  tool(server, 'get_feed', { title: 'Read the feed', description: 'The mixed feed: Open Media plus Farcaster, Lens, Hive and DeSo public posts, newest first (raw) or ranked (relevant). Each post includes its network, source link and “why” reasons. Pass nextCursor back to read further.', input: { sources: z.array(sourceEnum).optional(), kind: z.enum(['feed', 'clips']).optional().describe('clips = short videos only'), mode: z.enum(['raw', 'relevant']).optional(), cursor: z.string().optional() }, readOnly: true, view: postsViewUri },
    (args) => feed(env, origin, { sources: args.sources as Source[] | undefined, kind: args.kind as 'feed' | 'clips' | undefined, mode: args.mode as FeedMode | undefined, cursor: args.cursor as string | undefined }));
  tool(server, 'search', { title: 'Search everything public', description: 'Plain-language search across public posts on Open Media, Farcaster, Lens, Hive and DeSo, plus matching app settings. Understands phrases like “videos about ethereum on lens today” and says what it understood and how each network was searched.', input: { query: z.string().min(1).max(200) }, readOnly: true, view: postsViewUri },
    (args) => search(env, origin, String(args.query)));
  tool(server, 'get_post', { title: 'Get a post', description: 'One public Open Media post by id.', input: { id: z.string() }, readOnly: true }, (args) => publicPost(env, origin, String(args.id)));
  tool(server, 'get_profile', { title: 'Get a profile', description: 'A public Open Media profile by handle, with recent posts.', input: { handle: z.string() }, readOnly: true }, (args) => publicProfile(env, origin, String(args.handle)));
  tool(server, 'get_person_timeline', { title: 'Get a person’s timeline', description: 'One person’s public posts in one timeline. For an Open Media handle: their profile plus posts from the Farcaster, Lens, Hive and DeSo accounts they listed (declared by them, not proven). For an open-network handle: that account’s own posts.', input: { network: z.enum(['open-media', ...authorNetworks] as [string, ...string[]]), handle: z.string(), cursor: z.string().optional() }, readOnly: true },
    (args) => personTimeline(env, origin, String(args.network), String(args.handle), args.cursor as string | undefined));
  tool(server, 'find_upcoming_events', { title: 'Find upcoming events', description: 'Upcoming public events from Luma, Meetup and Eventbrite in the San Francisco Bay Area (the only area covered so far), with the same event on several platforms shown once. Each has its date, place, price, organizer and the official registration link. Never claim the person is registered; they register on that page.', input: { area: z.string().optional().describe('south bay, peninsula, san francisco, east bay or bay area (default)'), days: z.number().int().min(1).max(14).optional(), query: z.string().max(120).optional().describe('Topic words, e.g. "ai founders" or "hiking"'), limit: z.number().int().min(1).max(50).optional() }, readOnly: true },
    async (args) => { try { return await upcomingEvents(env, { area: args.area as string | undefined, days: args.days as number | undefined, query: args.query as string | undefined, limit: args.limit as number | undefined }); } catch (error) { throw error instanceof EventsUnavailable ? new AgentError(400, 'bad_request', error.message) : error; } });
  tool(server, 'list_networks', { title: 'List networks and capabilities', description: 'Every network Open Media connects to and exactly what works today: open networks, email, chat bridges running on this server, and networks that cannot be reached.', input: {}, readOnly: true }, () => networksDescription(env));
  tool(server, 'find_setting', { title: 'Find a setting', description: 'Find where a control lives in the Open Media app, e.g. “dark mode”, “stop posting to farcaster”, “export my data”.', input: { query: z.string().min(1).max(120) }, readOnly: true }, (args) => settingsLookup(String(args.query)));
  tool(server, 'about_open_media', { title: 'About Open Media', description: 'The mission, principles, three promises, roadmap and honest status, plus every interface for agents.', input: {}, readOnly: true }, () => aboutOpenMedia(origin));
}

function registerAccountTools(server: McpServer, account: Account) {
  tool(server, 'get_me', { title: 'My profile', description: 'The signed-in person’s Open Media profile.', input: {}, readOnly: true }, () => account.me());
  tool(server, 'publish_post', { title: 'Publish a post', description: 'Publish a public Open Media post as the person. Public posts can be read by anyone. Confirm the exact text with the person first.', input: { text: z.string().min(1).max(maxPostLength) }, readOnly: false }, (args) => account.publish(args.text));
  tool(server, 'delete_post', { title: 'Delete a post', description: 'Delete one of the person’s own posts. Copies others already read cannot be recalled.', input: { id: z.string() }, readOnly: false }, (args) => account.deletePost(String(args.id)));
  tool(server, 'report_post', { title: 'Report a post', description: 'Report a public post for review.', input: { id: z.string(), reason: z.enum(reportReasons), details: z.string().max(1000).optional() }, readOnly: false }, (args) => account.report(String(args.id), args.reason, args.details));
  tool(server, 'list_conversations', { title: 'My conversations', description: 'The person’s Open Media conversations with recent messages, newest first.', input: { messagesPerConversation: z.number().int().min(1).max(50).optional() }, readOnly: true }, (args) => account.conversations(Number(args.messagesPerConversation ?? 20)));
  tool(server, 'start_conversation', { title: 'Start a conversation', description: 'Open a direct conversation with someone by their Open Media handle.', input: { handle: z.string() }, readOnly: false }, (args) => account.startConversation(args.handle));
  tool(server, 'send_message', { title: 'Send a message', description: 'Send a message in one of the person’s conversations. Confirm the exact text with the person first.', input: { conversationId: z.string(), text: z.string().min(1).max(8000) }, readOnly: false }, (args) => account.send(String(args.conversationId), args.text));
  tool(server, 'export_my_data', { title: 'Export my data', description: 'A readable copy of the person’s Open Media data.', input: {}, readOnly: true }, () => account.exportData());
  tool(server, 'block_person', { title: 'Block or unblock someone', description: 'Block (or unblock) an Open Media person by handle. Blocked people cannot message the person, and their posts are hidden.', input: { handle: z.string(), blocked: z.boolean().optional() }, readOnly: false }, (args) => account.block(args.handle, args.blocked));
  tool(server, 'report_conversation', { title: 'Report a conversation', description: 'Report unwanted contact in a conversation, naming the other person’s handle.', input: { conversationId: z.string(), handle: z.string(), messageId: z.string().optional() }, readOnly: false }, (args) => account.reportConversation(String(args.conversationId), args.handle, args.messageId));
  tool(server, 'delete_my_account', { title: 'Delete my account', description: 'Permanently delete the person’s Open Media account and data. Only call this after the person explicitly asks; pass confirmation exactly "delete my account".', input: { confirmation: z.string() }, readOnly: false }, (args) => account.deleteAccount(args.confirmation));

  // People and contacts (private to the person; encrypted at rest)
  tool(server, 'list_my_contacts', { title: 'My contacts', description: 'The person’s own address book: saved names, numbers, emails, notes, and which accounts each contact is linked to (with why). Private to the person; never share it with anyone else.', input: {}, readOnly: true }, () => account.contacts());
  tool(server, 'save_contacts', { title: 'Save contacts', description: 'Create or replace contact cards (matched by id; up to 500 per call). Each card: {id (uuid), source: device|manual, name, nicknames[], phones[], emails[], notes, links[{ref, method: auto|confirmed, evidence, linkedAt}], rejected[], updatedAt}. Only link identities the person confirmed or that share an exact email or phone number. Confirm changes with the person first.', input: { cards: z.array(z.record(z.string(), z.unknown())).min(1).max(500) }, readOnly: false }, (args) => account.saveContacts(args.cards));
  tool(server, 'delete_contact', { title: 'Delete a contact', description: 'Delete one of the person’s contact cards. The people themselves are not affected.', input: { id: z.string() }, readOnly: false }, (args) => account.deleteContact(String(args.id)));
  tool(server, 'set_linked_accounts', { title: 'Set my accounts elsewhere', description: 'Replace the list of the person’s own Farcaster, Lens, Hive and DeSo accounts shown on their public profile (up to 8). This list is public. Confirm with the person first.', input: { accounts: z.array(z.object({ network: z.enum(authorNetworks as [string, ...string[]]), handle: z.string() })).max(8) }, readOnly: false }, (args) => account.setLinkedAccounts(args.accounts));

  // Products and services
  tool(server, 'publish_listing', { title: 'Offer a product or service', description: 'Publish a public post offering a product or service, with a price. Anyone can read it and message the person about it. Confirm the title, price and text with the person first. No payment happens here.', input: { kind: z.enum(['product', 'service']), title: z.string().min(1).max(120), price: z.string().max(20).optional().describe('e.g. "25" or "25.50"; leave out for "ask for price"'), currency: z.string().length(3).optional(), location: z.string().max(120).optional(), remote: z.boolean().optional().describe('Service available remotely, or product can ship'), text: z.string().max(maxPostLength).optional() }, readOnly: false }, (args) => account.publishListing(args));
  tool(server, 'update_listing', { title: 'Update a listing', description: 'Change the availability (available, limited, sold_out), price (whole cents, or null) or place of one of the person’s listings.', input: { postId: z.string(), availability: z.enum(['available', 'limited', 'sold_out']).optional(), priceMinor: z.number().int().min(0).max(100_000_000).nullable().optional(), location: z.string().max(120).nullable().optional(), remote: z.boolean().optional() }, readOnly: false }, (args) => account.updateListing(String(args.postId), args));

  tool(server, 'rate_listing', { title: 'Rate a product or service', description: 'Give a listing 1 to 5 stars, or null to withdraw the person’s rating. Only verified people who show their legal name can rate; there are no written reviews and people are never rated. Ask the person for the number of stars; never choose it for them.', input: { postId: z.string(), stars: z.number().int().min(1).max(5).nullable() }, readOnly: false }, (args) => account.rateListing(String(args.postId), args.stars));

  // Payments, tips and paid posts. Money only moves when the person finishes on Stripe's page or
  // approves the transfer in their own wallet; agents never hold cards, keys or funds.
  tool(server, 'get_payment_setup', { title: 'My payment setup', description: 'Whether the person can get paid by card (Stripe) and which wallets they linked, whether they take tips, Open Media’s fees, and what this server supports (test mode or live).', input: {}, readOnly: true }, () => account.paymentSetup());
  tool(server, 'list_my_payments', { title: 'My payments', description: 'Payments the person sent and received, newest first, with status and history. Private to the person.', input: { limit: z.number().int().min(1).max(200).optional() }, readOnly: true }, (args) => account.payments(Number(args.limit ?? 50)));
  tool(server, 'get_payment', { title: 'Get a payment', description: 'One of the person’s payments by id.', input: { paymentId: z.string() }, readOnly: true }, (args) => account.payment(String(args.paymentId)));
  tool(server, 'get_payment_options', { title: 'How something can be paid for', description: 'For a listing (contextType listing) or a post (tip or paid_post): whether card and USDC work, the price and the fee rates.', input: { postId: z.string(), contextType: z.enum(['listing', 'tip', 'paid_post']) }, readOnly: true }, (args) => args.contextType === 'listing' ? account.paymentOptions(String(args.postId)) : account.postPaymentOptions(String(args.postId)));
  tool(server, 'start_payment', { title: 'Start a payment (asks first)', description: 'Pay for a listing, tip a creator or unlock a paid post. First call without confirm: it starts nothing and returns who is paid, the amount and every fee. Show that to the person; only if they agree, call again with confirm: true and expectedAmountMinor. Card: returns a Stripe checkout link the person opens themselves. USDC: returns the exact transfer for the person’s own wallet. Never choose a tip amount for the person.', input: {
    contextType: z.enum(['listing', 'tip', 'paid_post']), postId: z.string(), rail: z.enum(['card', 'onchain']), chain: z.enum(['base-sepolia', 'base']).optional(),
    amountMinor: z.number().int().min(100).max(50_000).optional().describe('Tips only: the amount the person chose, in cents'), confirm: z.boolean().optional(), expectedAmountMinor: z.number().int().optional(),
  }, readOnly: false }, (args) => account.startPaymentWithConfirmation(args));
  tool(server, 'submit_payment_transaction', { title: 'Report a USDC transaction', description: 'After the person’s wallet sent the USDC transfer, pass its transaction hash. Open Media then checks it on the network; it is not paid until that check passes.', input: { paymentId: z.string(), txHash: z.string() }, readOnly: false }, (args) => account.submitTransaction(String(args.paymentId), args.txHash));
  tool(server, 'check_payment', { title: 'Check a payment again', description: 'Re-check a USDC payment on the network, or read a card payment’s status after the person paid on Stripe.', input: { paymentId: z.string() }, readOnly: false }, (args) => account.checkPayment(String(args.paymentId)));
  tool(server, 'start_payout_setup', { title: 'Set up getting paid by card', description: 'Returns a Stripe link for the person to open themselves to set up payouts. Stripe collects bank and tax details; never ask the person for them.', input: {}, readOnly: false }, () => account.startPayouts());
  tool(server, 'set_up_profile', { title: 'Set up a new profile', description: 'For a new account only (get_me answers no_profile): saves the name and @handle the person chose. Ask the person for both; handles are 3 to 24 lowercase letters, numbers or underscores.', input: { displayName: z.string().max(80), handle: z.string().max(25) }, readOnly: false }, (args) => account.setUpProfile(args));
  tool(server, 'get_ondc_store', { title: 'Get the ONDC store', description: 'The person’s ONDC store for selling to ONDC buyer apps in India (store details, whether it is on, how many INR products are offered). Null when they have none.', input: {}, readOnly: true }, () => account.ondcStore());
  tool(server, 'set_ondc_store', { title: 'Save the ONDC store', description: 'Saves the person’s ONDC store. Turning it on (enabled: true) needs every field and declarationAccepted: true, which only the person can confirm; their phone, email and address are then shown to ONDC buyers. Confirm with the person first. Orders through ONDC are not accepted yet.', input: {
    enabled: z.boolean(), storeName: z.string().max(80), category: z.enum(['ONDC:RET12', 'ONDC:RET13', 'ONDC:RET14', 'ONDC:RET15', 'ONDC:RET16']), building: z.string().max(120), locality: z.string().max(120),
    city: z.string().max(60), state: z.string().max(60), areaCode: z.string(), stdCode: z.string(), gps: z.string(), phone: z.string(), email: z.string(),
    timeToShip: z.enum(['PT24H', 'P2D', 'P3D', 'P5D', 'P7D']).optional(), returnable: z.boolean().optional(), returnWindow: z.enum(['P7D', 'P10D', 'P15D', 'P30D']).optional(), cancellable: z.boolean().optional(), declarationAccepted: z.boolean(),
  }, readOnly: false }, (args) => account.setOndcStore(args));
  tool(server, 'set_tips', { title: 'Turn tips on or off', description: 'Whether people can tip the person on their posts. Confirm with the person first.', input: { enabled: z.boolean() }, readOnly: false }, (args) => account.setTips(args.enabled));
  tool(server, 'remove_wallet', { title: 'Remove a linked wallet', description: 'Unlink one of the person’s wallets (by id from get_payment_setup). Linking a wallet needs the person’s own signature in the app.', input: { walletId: z.string() }, readOnly: false }, (args) => account.removeWallet(String(args.walletId)));
  tool(server, 'publish_paid_post', { title: 'Publish a paid post', description: 'Publish a post with a free public preview and a paid part only buyers can read. Confirm the preview, the paid text and the price with the person first.', input: { preview: z.string().min(1).max(maxPostLength), paidText: z.string().min(1).max(10_000), priceMinor: z.number().int().min(50).max(100_000_000), currency: z.string().length(3).optional() }, readOnly: false }, (args) => account.publishPaidPost(args));
  tool(server, 'get_paid_post', { title: 'Read a paid post', description: 'The paid part of a post, if the person wrote it or paid for it; otherwise only its price.', input: { postId: z.string() }, readOnly: true }, (args) => account.paidContent(String(args.postId)));

  // Identity, privacy and follows
  tool(server, 'get_my_identity', { title: 'My identity and privacy', description: 'The person’s identity tier (2 handle only, 3 declared name, 4 verified, 5 verified with legal name shown), whether they have the blue tick, the name others see, public or private, verification status and how many follow requests wait.', input: {}, readOnly: true }, () => account.identity());
  tool(server, 'set_my_privacy', { title: 'Set name and privacy', description: 'Change which name others see (handle_only, declared, or verified_legal once verified) and whether the account is public or private. Confirm with the person first; private hides posts from everyone but accepted followers.', input: { nameDisclosure: z.enum(['handle_only', 'declared', 'verified_legal']).optional(), visibility: z.enum(['public', 'private']).optional() }, readOnly: false }, (args) => account.setIdentity(args));
  tool(server, 'start_identity_verification', { title: 'Start identity verification', description: 'Returns a Stripe Identity link for the person to open themselves (document plus selfie). Never ask the person for document details yourself. Says so when verification is not available on this server.', input: {}, readOnly: false }, () => account.startVerification());
  tool(server, 'list_my_follows', { title: 'Follows and requests', description: 'Who the person follows (with pending requests), their followers, and follow requests waiting for them.', input: {}, readOnly: true }, () => account.follows());
  tool(server, 'follow', { title: 'Follow someone', description: 'Follow an Open Media account by handle. Private accounts get a request they must accept.', input: { handle: z.string() }, readOnly: false }, (args) => account.follow(args.handle));
  tool(server, 'unfollow', { title: 'Unfollow someone', description: 'Stop following an account, or withdraw a pending request.', input: { handle: z.string() }, readOnly: false }, (args) => account.unfollow(args.handle));
  tool(server, 'answer_follow_request', { title: 'Accept or decline a follow request', description: 'Accept or decline a request to follow the person (by the requester’s id from list_my_follows). Confirm with the person first.', input: { followerId: z.string(), accept: z.boolean() }, readOnly: false }, (args) => account.answerFollowRequest(String(args.followerId), args.accept));
  tool(server, 'remove_follower', { title: 'Remove a follower', description: 'Remove someone from the person’s followers. They are not told.', input: { followerId: z.string() }, readOnly: false }, (args) => account.removeFollower(String(args.followerId)));

  // Email
  tool(server, 'list_email', { title: 'Read my email', description: 'The person’s stored email from connected mailboxes (inbound and sent), newest first. Run sync_mailbox first for the latest.', input: { limit: z.number().int().min(1).max(500).optional() }, readOnly: true }, (args) => account.email(Number(args.limit ?? 50)));
  tool(server, 'list_mailboxes', { title: 'My mailboxes', description: 'Connected email accounts and whether each can send.', input: {}, readOnly: true }, () => account.mailAccounts());
  tool(server, 'connect_mailbox', { title: 'Connect a mailbox', description: 'Connect an IMAP or POP3 mailbox (with optional SMTP for sending). Use an app password, never the main password. The server tests the connection and stores the password encrypted.', input: {
    email: z.string(), protocol: z.enum(['imap', 'pop3']), host: z.string(), port: z.number().int(), username: z.string(), password: z.string(),
    smtp: z.object({ host: z.string(), port: z.number().int(), security: z.enum(['tls', 'starttls']) }).optional(),
  }, readOnly: false }, (args) => account.connectMail({ ...args, secure: true }));
  tool(server, 'sync_mailbox', { title: 'Sync a mailbox', description: 'Fetch new mail for one connected mailbox.', input: { mailboxId: z.string() }, readOnly: false }, (args) => account.syncMail(String(args.mailboxId)));
  tool(server, 'send_email', { title: 'Send an email', description: 'Send an email from one of the person’s mailboxes. Confirm recipients and text with the person first.', input: { mailboxId: z.string(), to: z.array(z.string()).min(1).max(10), subject: z.string().max(998), text: z.string().min(1).max(50000), inReplyTo: z.string().optional() }, readOnly: false }, (args) => account.sendEmail(String(args.mailboxId), { to: args.to, subject: args.subject, text: args.text, ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}) }));
  tool(server, 'remove_mailbox', { title: 'Remove a mailbox', description: 'Disconnect a mailbox and delete its stored mail from Open Media.', input: { mailboxId: z.string() }, readOnly: false }, (args) => account.removeMail(String(args.mailboxId)));

  // Chat networks (bridges)
  tool(server, 'list_chat_networks', { title: 'Chat networks', description: 'WhatsApp, Signal, Instagram, Messenger, Discord and other chat apps this server bridges, and which the person has connected.', input: {}, readOnly: true }, () => account.chatNetworks());
  tool(server, 'list_bridged_chats', { title: 'Bridged chats', description: 'Recent chats from the person’s connected chat apps. These are not end-to-end encrypted inside Open Media.', input: {}, readOnly: true }, () => account.bridgedChats());
  tool(server, 'send_bridged_message', { title: 'Reply in a bridged chat', description: 'Send a text reply in a bridged chat (WhatsApp, Signal, and so on). Confirm the text with the person first.', input: { chatId: z.string(), text: z.string().min(1).max(8000) }, readOnly: false }, (args) => account.sendBridged(String(args.chatId), args.text));
  tool(server, 'chat_network_sign_in_options', { title: 'Chat network sign-in options', description: 'How a chat network can be connected (QR code, pairing code, password, cookies).', input: { network: z.string() }, readOnly: true }, (args) => account.chatSignInOptions(String(args.network)));
  tool(server, 'start_chat_network_sign_in', { title: 'Connect a chat network', description: 'Start connecting a chat network. Tell the person first that the network does not approve bridges and accounts could be limited. Returns the first step (for example a QR code to show the person).', input: { network: z.string(), flow: z.string() }, readOnly: false }, (args) => account.startChatSignIn(String(args.network), args.flow));
  tool(server, 'continue_chat_network_sign_in', { title: 'Continue connecting a chat network', description: 'Send the values for the current sign-in step, or wait for the next one (QR scanned, code entered).', input: { network: z.string(), loginId: z.string(), stepId: z.string(), type: z.enum(['display_and_wait', 'user_input', 'cookies']), values: z.record(z.string(), z.string()).optional() }, readOnly: false }, (args) => account.continueChatSignIn(String(args.network), { loginId: args.loginId, stepId: args.stepId, type: args.type, values: args.values }));
  tool(server, 'disconnect_chat_network', { title: 'Disconnect a chat network', description: 'Remove the linked device and Open Media’s copy of those chats. The person’s account on that network is not changed.', input: { network: z.string(), loginId: z.string().optional() }, readOnly: false }, (args) => account.disconnectChat(String(args.network), args.loginId));

  // Cross-posting
  tool(server, 'cross_posting_status', { title: 'Cross-posting', description: 'Which networks this server can help cross-post to, and how cross-posting works (it is signed on the person’s device, so posts made through this API go to Open Media only).', input: {}, readOnly: true }, () => account.crossPosting());
}

function openMcp(env: AgentEnv, origin: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'open-media', title: 'Open Media', version }, { instructions });
    registerPublicTools(server, env, origin);
    return server;
  }, { legacy: 'stateless', responseMode: 'json' });
}

export function accountMcp(env: AgentEnv, origin: string, account: Account) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'open-media-account', title: 'Open Media (your account)', version }, { instructions: `${instructions} These tools act as the signed-in person; ask before publishing, deleting or sending anything.` });
    registerPublicTools(server, env, origin);
    registerAccountTools(server, account);
    return server;
  }, { legacy: 'stateless', responseMode: 'json' });
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/** The llms.txt index; the agent site owns it so every link in it resolves to real content. */
export function llmsTxt(origin: string): string {
  return siteLlmsTxt(origin);
}

/** MCP server card (SEP-1649 draft): what servers exist here and how to reach them. */
export function serverCard(origin: string) {
  return {
    $schema: 'https://modelcontextprotocol.io/schemas/server-card/draft',
    name: 'Open Media',
    description: `${tagline} ${mission}`,
    version,
    documentation: `${origin}/llms.txt`,
    servers: [
      { name: 'open-media', title: 'Open Media', url: `${origin}/open/mcp`, transport: 'streamable-http', authentication: { type: 'none' }, tools: ['get_feed', 'search', 'get_post', 'get_profile', 'list_networks', 'find_setting', 'about_open_media'] },
      { name: 'open-media-account', title: 'Open Media (your account)', url: `${origin}/me/mcp`, transport: 'streamable-http', authentication: { type: 'bearer', description: 'The person’s Open Media access token: sign in with request_sign_in_code and sign_in_with_code on the public server (or POST /v1/auth/email-code then /v1/auth/verify), or copy it from Settings → Developers and agents. It expires after about an hour; renew it with refresh_sign_in.' }, tools: ['get_me', 'set_up_profile', 'publish_post', 'delete_post', 'report_post', 'list_conversations', 'start_conversation', 'send_message', 'export_my_data', 'block_person', 'report_conversation', 'delete_my_account', 'list_email', 'list_mailboxes', 'connect_mailbox', 'sync_mailbox', 'send_email', 'remove_mailbox', 'list_chat_networks', 'list_bridged_chats', 'send_bridged_message', 'chat_network_sign_in_options', 'start_chat_network_sign_in', 'continue_chat_network_sign_in', 'disconnect_chat_network', 'cross_posting_status', 'plus every public tool'] },
      { name: 'open-media-events', title: 'Open Media Events', url: `${origin}/mcp`, transport: 'streamable-http', authentication: { type: 'oauth2', metadata: `${origin}/.well-known/oauth-authorization-server` } },
    ],
  };
}

/** GET / and /v1: every interface, grouped the way people and agents use them. */
export function apiIndex(origin: string) {
  const full = (items: { path: string; method?: string; description: string }[]) => items.map((item) => ({ ...item, url: `${origin}${item.path}` }));
  return {
    name: 'Open Media API',
    version,
    description: `${tagline} Everything Open Media offers to people it offers to programs and AI agents. Public data needs no account or key.`,
    mission,
    documentation: { openapi: `${origin}/v1/openapi.json`, llms: `${origin}/llms.txt`, mcpServerCard: `${origin}/.well-known/mcp.json` },
    authentication: 'Public endpoints need nothing. Account endpoints need the person’s own access token as “Authorization: Bearer …” (Settings → Developers and agents in the app); it expires after about an hour and acts only as that person.',
    discovery: full(agentInterfaces.discovery),
    public: full(agentInterfaces.public),
    account: full(agentInterfaces.account),
    mcp: agentInterfaces.mcp.map((server) => ({ ...server, url: `${origin}${server.path}` })),
    pagination: 'Newest first. Follow `next` (or the Link rel="next" header) until it is null.',
    rateLimit: 'Requests are rate limited per client. On HTTP 429, wait for Retry-After seconds.',
    rules: 'Open Media’s own public posts may be read and indexed freely. Other networks’ posts keep their source and link. Messages, email and contacts are never public. Agents identify as agents.',
  };
}

/** The original public read API's OpenAPI document, extended with the feed, search, account and discovery routes. */
function baseOpenApi(origin: string) {
  const base = openApiDocument(origin) as { info: Record<string, unknown>; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } } & Record<string, unknown>;
  const error = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  const ok = (description: string, schema: unknown = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
  const bearer = [{ bearerAuth: [] }];
  const asyncPayment = {
    description: 'Accepted: the network has not settled the payment yet. Poll the Location (or POST to job.check) after Retry-After seconds.',
    headers: { Location: { schema: { type: 'string', format: 'uri' }, description: 'The payment to poll' }, 'Retry-After': { schema: { type: 'integer' } } },
    content: { 'application/json': { schema: { type: 'object', required: ['payment', 'job'], properties: { payment: { type: 'object' }, detail: { type: 'string' }, job: { type: 'object', required: ['id', 'status', 'poll'], properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['running'] }, poll: { type: 'string', format: 'uri' }, check: { type: 'string', format: 'uri' }, retryAfterSeconds: { type: 'integer' } } } } } } },
  };
  const textBody = (field: string, max: number) => ({ required: true, content: { 'application/json': { schema: { type: 'object', required: [field], properties: { [field]: { type: 'string', maxLength: max } } } } } });
  return {
    ...base,
    info: { ...base.info, title: 'Open Media API', version, description: apiIndex(origin).description },
    paths: {
      ...base.paths,
      '/v1/feed': { get: { summary: 'The mixed feed across Open Media and open networks, with “Why this?” reasons', parameters: [
        { name: 'sources', in: 'query', schema: { type: 'string' }, description: `Comma-separated: ${sources.join(', ')}. Default: all.` },
        { name: 'kind', in: 'query', schema: { type: 'string', enum: ['feed', 'clips'] } },
        { name: 'mode', in: 'query', schema: { type: 'string', enum: ['raw', 'relevant'] } },
        { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'nextCursor from a previous page.' },
      ], responses: { 200: ok('A page of posts', { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AgentPost' } }, unavailable: { type: 'array', items: { type: 'string' } }, nextCursor: { type: ['string', 'null'] }, next: { type: ['string', 'null'] } } }), 400: error } } },
      '/v1/search': { get: { summary: 'Plain-language search across public posts on every network, plus matching settings', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', maxLength: 200 } }], responses: { 200: ok('Results with what was understood and how each network was searched'), 400: error } } },
      '/v1/networks': { get: { summary: 'Every network and connector, with what works today', responses: { 200: ok('Networks and capabilities') } } },
      '/v1/settings': { get: { summary: 'The searchable settings index', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { 200: ok('Matching settings') } } },
      '/v1/events/upcoming': { get: { summary: 'Upcoming public events (Luma, Meetup, Eventbrite) in the San Francisco Bay Area, de-duplicated across platforms, with official registration links', parameters: [{ name: 'area', in: 'query', schema: { type: 'string' } }, { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 14, default: 7 } }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }], responses: { 200: ok('Events, soonest first, with each provider’s status'), 400: error } } },
      '/v1/people/{network}/{handle}': { get: { summary: 'One person’s public posts in one timeline (Open Media profile plus the accounts they listed, or one open-network account)', parameters: [{ name: 'network', in: 'path', required: true, schema: { type: 'string', enum: ['open-media', ...authorNetworks] } }, { name: 'handle', in: 'path', required: true, schema: { type: 'string' } }, { name: 'cursor', in: 'query', schema: { type: 'string' } }], responses: { 200: ok('The person and their posts, newest first'), 400: error, 404: error } } },
      '/v1/about': { get: { summary: 'Mission, principles, promises, roadmap and honest status', responses: { 200: ok('About Open Media') } } },
      '/v1/auth/email-code': { post: { summary: 'Email a person a sign-in code (step 1 of signing in from an agent; also creates new accounts)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } }, responses: { 200: ok('Code sent'), 400: error, 429: error } } },
      '/v1/auth/verify': { post: { summary: 'Exchange the emailed code for the person’s session (access_token, refresh_token)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'code'], properties: { email: { type: 'string', format: 'email' }, code: { type: 'string', pattern: '^[0-9 ]{6,12}$' } } } } } }, responses: { 200: ok('Session'), 400: error, 429: error } } },
      '/v1/auth/refresh': { post: { summary: 'Renew a session with its refresh_token', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refresh_token'], properties: { refresh_token: { type: 'string' } } } } } }, responses: { 200: ok('Session'), 400: error, 401: error } } },
      '/v1/auth/sign-out': { post: { summary: 'End this session', security: bearer, responses: { 200: ok('Signed out'), 401: error } } },
      '/v1/me/profile': { put: { summary: 'Choose the name and handle of a new account', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['displayName', 'handle'], properties: { displayName: { type: 'string', maxLength: 80 }, handle: { type: 'string', pattern: '^[a-z0-9_]{3,24}$' } } } } } }, responses: { 200: ok('Profile'), 400: error, 401: error, 409: error } } },
      '/v1/me': {
        get: { summary: 'Your profile', security: bearer, responses: { 200: ok('Profile'), 401: error } },
        delete: { summary: 'Delete your account (irreversible)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string', const: 'delete my account' } } } } } }, responses: { 200: ok('Deleted'), 400: error, 401: error } },
      },
      '/v1/me/posts': { post: { summary: 'Publish a public post', security: bearer, requestBody: textBody('body', maxPostLength), responses: { 201: ok('The new post', { $ref: '#/components/schemas/Post' }), 400: error, 401: error } } },
      '/v1/me/posts/{id}': { delete: { summary: 'Delete one of your posts', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Deleted'), 401: error, 403: error } } },
      '/v1/posts/{id}/report': { post: { summary: 'Report a post for review', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', enum: [...reportReasons] }, details: { type: 'string', maxLength: 1000 } } } } } }, responses: { 200: ok('Reported'), 400: error, 401: error } } },
      '/v1/me/conversations': {
        get: { summary: 'Your conversations with recent messages', security: bearer, responses: { 200: ok('Conversations'), 401: error } },
        post: { summary: 'Start a conversation with a handle', security: bearer, requestBody: textBody('handle', 24), responses: { 201: ok('The conversation'), 404: error, 401: error } },
      },
      '/v1/me/conversations/{id}/messages': { post: { summary: 'Send a message', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: textBody('body', 8000), responses: { 201: ok('Sent'), 400: error, 401: error, 403: error } } },
      '/v1/me/export': { get: { summary: 'Export a readable copy of your data', security: bearer, responses: { 200: ok('Your data'), 401: error } } },
      '/v1/me/email': { get: { summary: 'Your stored email, newest first', security: bearer, parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 } }], responses: { 200: ok('Email'), 401: error } } },
      '/v1/me/contacts': {
        get: { summary: 'Your contacts (private; stored encrypted)', security: bearer, responses: { 200: ok('Your contact cards'), 401: error } },
        put: { summary: 'Create or replace contact cards by id (up to 500)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'array', maxItems: 500, items: { type: 'object', required: ['id', 'name', 'phones', 'emails', 'links', 'rejected', 'nicknames', 'notes'], properties: { id: { type: 'string', format: 'uuid' }, source: { type: 'string', enum: ['device', 'manual'] }, name: { type: 'string' }, nicknames: { type: 'array', items: { type: 'string' } }, phones: { type: 'array', items: { type: 'string' } }, emails: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, links: { type: 'array', items: { type: 'object' } }, rejected: { type: 'array', items: { type: 'string' } }, updatedAt: { type: 'string' } } } } } } }, responses: { 200: ok('Saved'), 400: error, 401: error } },
      },
      '/v1/me/contacts/{id}': { delete: { summary: 'Delete one of your contact cards', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Deleted'), 404: error, 401: error } } },
      '/v1/me/linked-accounts': { put: { summary: 'Set the open-network accounts shown on your public profile (public, up to 8)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'array', maxItems: 8, items: { type: 'object', required: ['network', 'handle'], properties: { network: { type: 'string', enum: ['farcaster', 'lens', 'hive', 'deso'] }, handle: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$' } } } } } } }, responses: { 200: ok('Saved'), 400: error, 401: error } } },
      '/v1/me/listings': { post: { summary: 'Offer a product or service as a public post', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind', 'title'], properties: { kind: { type: 'string', enum: ['product', 'service'] }, title: { type: 'string', maxLength: 120 }, price: { type: 'string', description: 'e.g. "25.50"; omit for ask-for-price' }, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, location: { type: 'string', maxLength: 120 }, remote: { type: 'boolean' }, text: { type: 'string' } } } } } }, responses: { 201: ok('The post with its listing'), 400: error, 401: error } } },
      '/v1/me/listings/{postId}': { patch: { summary: 'Change a listing’s availability, price or place', security: bearer, parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { availability: { type: 'string', enum: ['available', 'limited', 'sold_out'] }, priceMinor: { type: ['integer', 'null'] }, location: { type: ['string', 'null'] }, remote: { type: 'boolean' } } } } } }, responses: { 200: ok('The listing'), 400: error, 401: error } } },
      '/v1/me/listings/{postId}/rating': {
        put: { summary: 'Rate a listing 1–5 stars (verified people who show their legal name only)', security: bearer, parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['stars'], properties: { stars: { type: 'integer', minimum: 1, maximum: 5 } } } } } }, responses: { 200: ok('The listing’s rating summary'), 400: error, 401: error, 403: error } },
        delete: { summary: 'Withdraw your rating', security: bearer, parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('The listing’s rating summary'), 401: error } },
      },
      '/v1/me/identity': {
        get: { summary: 'Your identity tier, tick, shown name, privacy and verification status', security: bearer, responses: { 200: ok('Your identity'), 401: error } },
        put: { summary: 'Choose the name others see and whether your account is private', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { nameDisclosure: { type: 'string', enum: ['handle_only', 'declared', 'verified_legal'] }, visibility: { type: 'string', enum: ['public', 'private'] } } } } } }, responses: { 200: ok('Updated identity'), 400: error, 401: error, 409: error } },
      },
      '/v1/me/verification': { post: { summary: 'Start identity verification with Stripe Identity (returns a link to open)', security: bearer, responses: { 201: ok('Verification link'), 401: error, 503: error } } },
      '/v1/me/follows': {
        get: { summary: 'Who you follow, your followers and requests waiting for you', security: bearer, responses: { 200: ok('Follows'), 401: error } },
        post: { summary: 'Follow someone (private accounts get a request)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['handle'], properties: { handle: { type: 'string' } } } } } }, responses: { 201: ok('Following or requested'), 400: error, 401: error } },
      },
      '/v1/me/follows/{handle}': { delete: { summary: 'Unfollow, or withdraw a request', security: bearer, parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Done'), 401: error } } },
      '/v1/me/follow-requests/{id}': { post: { summary: 'Accept or decline a follow request', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accept'], properties: { accept: { type: 'boolean' } } } } } }, responses: { 200: ok('Done'), 401: error } } },
      '/v1/me/followers/{id}': { delete: { summary: 'Remove a follower', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Done'), 401: error } } },
      '/v1/verification/stripe/webhook': { post: { summary: 'Stripe Identity webhook (signed by Stripe; not for clients)', responses: { 200: ok('Received'), 400: error, 503: error } } },
      '/v1/payments/stripe/webhook': { post: { summary: 'Stripe payments and Connect webhook (signed by Stripe; not for clients). Each event is re-read from Stripe before it changes a payment.', responses: { 200: ok('Received'), 400: error, 503: error } } },
      '/v1/me/payments/setup': { get: { summary: 'Your card payouts, linked wallets, tips setting, fees and what this server supports', security: bearer, responses: { 200: ok('Payment setup'), 401: error } } },
      '/v1/me/payments/payouts': { post: { summary: 'Start or continue Stripe payouts setup (returns a link to open)', security: bearer, responses: { 201: ok('Stripe link'), 401: error, 503: error } } },
      '/v1/me/payments/payouts/refresh': { post: { summary: 'Re-read your Stripe account status', security: bearer, responses: { 200: ok('Payment setup'), 401: error, 404: error } } },
      '/v1/me/ondc': {
        get: { summary: 'Your ONDC store (ADR 0015), or null', security: bearer, responses: { 200: ok('ONDC store'), 401: error } },
        put: { summary: 'Save your ONDC store. Turning it on needs every detail and the declaration; your phone, email and address are then shown to ONDC buyers. Orders through ONDC are not accepted yet.', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['enabled'], properties: {
          enabled: { type: 'boolean' }, storeName: { type: 'string' }, category: { type: 'string', enum: ['ONDC:RET12', 'ONDC:RET13', 'ONDC:RET14', 'ONDC:RET15', 'ONDC:RET16'] }, building: { type: 'string' }, locality: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' },
          areaCode: { type: 'string', pattern: '^[1-9][0-9]{5}$' }, stdCode: { type: 'string', examples: ['080'] }, gps: { type: 'string', examples: ['12.9716,77.5946'] }, phone: { type: 'string' }, email: { type: 'string', format: 'email' },
          timeToShip: { type: 'string', enum: ['PT24H', 'P2D', 'P3D', 'P5D', 'P7D'] }, returnable: { type: 'boolean' }, returnWindow: { type: 'string', enum: ['P7D', 'P10D', 'P15D', 'P30D'] }, cancellable: { type: 'boolean' }, declarationAccepted: { type: 'boolean' },
        } } } } }, responses: { 200: ok('ONDC store'), 400: error, 401: error } },
      },
      '/v1/me/payments/tips': { put: { summary: 'Turn tips on or off', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } } } } }, responses: { 200: ok('Tips setting'), 400: error, 401: error } } },
      '/v1/me/payments': {
        get: { summary: 'Payments you sent and received', security: bearer, parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }], responses: { 200: ok('Payments'), 401: error } },
        post: { summary: 'Start a payment for a listing, a tip or a paid post. The amount and recipient come from Open Media, except a tip’s amount. Card returns checkoutUrl; USDC returns the transfer for your wallet. Nothing is paid until Stripe or the network confirms it.', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['contextType', 'contextId', 'rail'], properties: {
          contextType: { type: 'string', enum: ['listing', 'tip', 'paid_post'] }, contextId: { type: 'string', format: 'uuid' }, rail: { type: 'string', enum: ['card', 'onchain'] }, chain: { type: 'string', enum: ['base-sepolia', 'base'] },
          amountMinor: { type: 'integer', minimum: 100, maximum: 50000, description: 'Tips only, in cents' }, idempotencyKey: { type: 'string', format: 'uuid' },
        } } } } }, responses: { 201: ok('Payment started'), 400: error, 401: error, 409: error, 503: error } },
      },
      '/v1/me/payments/{id}': { get: { summary: 'One of your payments', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Payment'), 401: error, 404: error } } },
      '/v1/me/payments/{id}/transaction': { post: { summary: 'Report the USDC transaction that paid; Open Media checks it on the network', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: textBody('txHash', 66), responses: { 200: ok('Payment and check result'), 202: asyncPayment, 400: error, 401: error, 404: error } } },
      '/v1/me/payments/{id}/check': { post: { summary: 'Check a payment again', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Payment and check result'), 202: asyncPayment, 401: error, 404: error } } },
      '/v1/me/wallets': { post: { summary: 'Link a wallet with a signature of Open Media’s message from that wallet (at most 10 minutes old)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message', 'signature'], properties: { message: { type: 'string' }, signature: { type: 'string' } } } } } }, responses: { 201: ok('Linked wallet'), 400: error, 401: error, 409: error } } },
      '/v1/me/wallets/{id}': { delete: { summary: 'Unlink a wallet', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Removed'), 401: error, 404: error } } },
      '/v1/me/listings/{postId}/payment-options': { get: { summary: 'How a listing can be paid for: card, USDC networks, price and fee', security: bearer, parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Options'), 401: error, 404: error } } },
      '/v1/me/posts/{id}/payment-options': { get: { summary: 'How a post can be paid for: tips, unlocking, card, USDC networks and fees', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Options'), 401: error, 404: error } } },
      '/v1/me/posts/{id}/paid': { get: { summary: 'The paid part of a post, if you wrote it or paid for it; otherwise its price only', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Paid part'), 401: error, 404: error } } },
      '/v1/me/paid-posts': { post: { summary: 'Publish a post with a free preview and a paid part', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['preview', 'paidText', 'priceMinor'], properties: { preview: { type: 'string', maxLength: maxPostLength }, paidText: { type: 'string', maxLength: 10000 }, priceMinor: { type: 'integer', minimum: 50 }, currency: { type: 'string', minLength: 3, maxLength: 3 } } } } } }, responses: { 201: ok('Published'), 400: error, 401: error } } },
      '/v1/me/blocks': { post: { summary: 'Block or unblock someone', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['handle'], properties: { handle: { type: 'string' }, blocked: { type: 'boolean', default: true } } } } } }, responses: { 200: ok('Done'), 404: error, 401: error } } },
      '/v1/me/conversations/{id}/report': { post: { summary: 'Report unwanted contact', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['handle'], properties: { handle: { type: 'string' }, messageId: { type: 'string', format: 'uuid' } } } } } }, responses: { 200: ok('Reported'), 401: error } } },
      '/v1/mail-accounts': {
        get: { summary: 'Your connected mailboxes', security: bearer, responses: { 200: ok('Mailboxes'), 401: error } },
        post: { summary: 'Connect a mailbox (tested before it is saved; the password is stored encrypted)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'protocol', 'host', 'port', 'secure', 'username', 'password'], properties: {
          email: { type: 'string', format: 'email' }, protocol: { type: 'string', enum: ['imap', 'pop3'] }, host: { type: 'string' }, port: { type: 'integer' }, secure: { type: 'boolean', const: true }, username: { type: 'string' }, password: { type: 'string', description: 'An app password.' },
          smtp: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' }, security: { type: 'string', enum: ['tls', 'starttls'] } } },
        } } } } }, responses: { 201: ok('Connected'), 400: error, 401: error, 429: error } },
      },
      '/v1/mail-accounts/{id}': { delete: { summary: 'Remove a mailbox and its stored mail', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Removed'), 404: error } } },
      '/v1/mail-accounts/{id}/sync': { post: { summary: 'Fetch new mail', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Synced messages'), 404: error, 429: error } } },
      '/v1/mail-accounts/{id}/send': { post: { summary: 'Send an email', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'subject', 'text'], properties: { to: { type: 'array', items: { type: 'string', format: 'email' }, maxItems: 10 }, subject: { type: 'string' }, text: { type: 'string' }, inReplyTo: { type: 'string' } } } } } }, responses: { 201: ok('Sent'), 409: error, 429: error } } },
      '/v1/bridges': { get: { summary: 'Chat networks this server bridges, and your connections', security: bearer, responses: { 200: ok('Networks') } } },
      '/v1/bridges/conversations': { get: { summary: 'Your bridged chats', security: bearer, responses: { 200: ok('Chats') } } },
      '/v1/bridges/rooms/{id}/messages': { post: { summary: 'Reply in a bridged chat', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: textBody('body', 8000), responses: { 201: ok('Sent'), 404: error } } },
      '/v1/bridges/{network}/flows': { get: { summary: 'Sign-in options for a chat network', security: bearer, parameters: [{ name: 'network', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Options') } } },
      '/v1/bridges/{network}/login/start': { post: { summary: 'Start connecting a chat network', security: bearer, parameters: [{ name: 'network', in: 'path', required: true, schema: { type: 'string' } }], requestBody: textBody('flow', 64), responses: { 200: ok('The first sign-in step') } } },
      '/v1/bridges/{network}/login/step': { post: { summary: 'Continue a sign-in step', security: bearer, parameters: [{ name: 'network', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('The next step, or complete') } } },
      '/v1/bridges/{network}/login/cancel': { post: { summary: 'Cancel a sign-in', security: bearer, parameters: [{ name: 'network', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Cancelled') } } },
      '/v1/bridges/{network}/logout': { post: { summary: 'Disconnect a chat network', security: bearer, parameters: [{ name: 'network', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Disconnected') } } },
      '/v1/cross-posting/status': { get: { summary: 'Which networks this server helps cross-post to', responses: { 200: ok('Status') } } },
      '/v1/search/assist': { post: { summary: 'AI summary of public posts you pass in, with citations', responses: { 200: ok('Summary'), 429: error, 503: error } } },
    },
    components: {
      ...base.components,
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'The person’s Open Media access token (Settings → Developers and agents). Expires after about an hour.' } },
      schemas: {
        ...base.components.schemas,
        AgentPost: { type: 'object', properties: {
          id: { type: 'string' }, network: { type: 'string', enum: [...sources] },
          author: { type: 'object', properties: { name: { type: 'string' }, handle: { type: 'string' }, avatarUrl: { type: ['string', 'null'] } } },
          title: { type: ['string', 'null'] }, text: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, url: { type: ['string', 'null'], format: 'uri' },
          media: { type: 'array', items: { type: 'object' } }, engagement: { type: ['object', 'null'] },
          why: { type: 'object', properties: { used: { type: 'array', items: { type: 'string' } }, filters: { type: 'array', items: { type: 'string' } }, notUsed: { type: 'array', items: { type: 'string' } } } },
        } },
      },
    },
    'x-mcp-servers': agentInterfaces.mcp.map((server) => ({ ...server, url: `${origin}${server.path}` })),
  };
}

// ─── REST router ─────────────────────────────────────────────────────────────

const idempotentWrites = new Set(['POST /v1/me/posts', 'POST /v1/me/listings', 'POST /v1/me/paid-posts', 'POST /v1/me/payments']);

/** A unique, readable operationId from the method and path, e.g. GET /v1/me/payments/{id} → getMePaymentsById. */
function operationIdFor(method: string, path: string): string {
  const words = path.replace(/^\/v1/, '').split('/').filter(Boolean).flatMap((part) => {
    const param = part.match(/^\{(.+)\}$/);
    return param ? ['by', param[1]] : part.replace(/^\./, 'well-known-').split(/[^a-zA-Z0-9]+/);
  }).filter(Boolean);
  const name = [method.toLowerCase(), ...words].map((word, index) => index === 0 ? word : word[0].toUpperCase() + word.slice(1)).join('');
  return path === '/' ? `${method.toLowerCase()}Root` : name;
}

/**
 * The OpenAPI document with what agents rely on added to every operation: a unique operationId,
 * a description, Idempotency-Key where writes honour it, and the error, rate-limit, versioning
 * and sandbox conventions.
 */
export function fullOpenApi(origin: string) {
  const document = baseOpenApi(origin) as Record<string, any>;
  for (const [path, operations] of Object.entries(document.paths as Record<string, Record<string, any>>)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      operation.operationId ??= operationIdFor(method, path);
      operation.description ??= operation.summary;
      operation.responses[429] ??= { description: 'Rate limited. Wait for Retry-After seconds.', headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait' } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
      if (idempotentWrites.has(`${method.toUpperCase()} ${path}`)) {
        operation.parameters = [...(operation.parameters ?? []), { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Retrying with the same key returns the first result instead of creating a second one.' }];
      }
    }
  }
  document.info = {
    ...document.info,
    'x-api-lifecycle': { versioning: 'Path-versioned (/v1). Fields may be added; nothing is removed or changed incompatibly without at least 90 days’ notice, a Deprecation header and a Sunset header.', documentation: `${origin}/docs#versioning-and-deprecation` },
    'x-rate-limits': { policy: 'About 120 requests per minute per client IP on public and agent routes.', headers: ['RateLimit-Policy', 'Retry-After'] },
    'x-sandbox': { description: 'Payments run in Stripe test mode and on Base Sepolia until live payments are approved; GET /v1/me/payments/setup reports the mode. For a private sandbox, run the open-source stack locally with `npm run local`.', documentation: `${origin}/developers` },
  };
  document.servers = [{ url: origin, description: 'Open Media API' }];
  document.externalDocs = { description: 'API documentation', url: `${origin}/docs` };
  return document;
}

export async function handleAgentRequest(request: Request, env: AgentEnv, internal?: InternalHandler): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const origin = url.origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...publicHeaders, 'access-control-max-age': '86400' } });
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limited = () => new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' } }), { status: 429, headers: { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', 'retry-after': '60' } });
  // Same per-client limit as the read-only API: feed and search fan out to four other networks.
  // The IP limit always applies, so minting agent identities cannot multiply it; a registered
  // agent (auth.md) also gets its own bucket, so one busy agent cannot starve others on its IP.
  if (!(await withinLimit(env.PUBLIC_API_RATE_LIMITER, `ip:${ip}`))) return limited();
  const agent = await agentFromRequest(env, origin, request);
  if (agent && !(await withinLimit(env.PUBLIC_API_RATE_LIMITER, agent))) return limited();
  // Bodies on these routes are small JSON; refuse large ones before reading them.
  if (Number(request.headers.get('content-length') ?? '0') > 262_144) return json({ error: { code: 'too_large', message: 'The request body is too large.' } }, 0, 413);
  try {
    if (path === '/ask' && (request.method === 'POST' || request.method === 'GET')) return nlwebAsk(request, env, origin);
    if (request.method === 'GET' && path === '/feeds/posts.jsonl') return postsFeed(env, origin);
    if (request.method === 'POST' && path === '/agent/identity') {
      if (!(await withinLimit(env.REGISTRATION_RATE_LIMITER, `ip:${ip}`))) return limited();
      try { return json(await registerAgent(env, origin, await request.json().catch(() => ({}))), 0); }
      catch (error) {
        if (error instanceof AgentAuthError) return json({ error: error.code, error_description: error.message }, 0, error.status);
        throw error;
      }
    }
    // A person signs in from an agent with the code Open Media emails them (personSignIn.ts).
    if (request.method === 'POST' && path.startsWith('/v1/auth/')) {
      const body = await request.json().catch(() => ({}));
      // Codes are emailed and checked at most a few times a minute per address, and per IP.
      const email = typeof (body as { email?: unknown }).email === 'string' ? (body as { email: string }).email.trim().toLowerCase() : '';
      if (!(await withinLimit(env.AUTH_RATE_LIMITER, `ip:${ip}`))) return limited();
      if (email && (path === '/v1/auth/email-code' || path === '/v1/auth/verify') && !(await withinLimit(env.AUTH_EMAIL_RATE_LIMITER, `${path}:${email}`))) return limited();
      try {
        if (path === '/v1/auth/email-code') return json(await requestSignInCode(env, origin, body), 0);
        if (path === '/v1/auth/verify') return json(await verifySignInCode(env, origin, body), 0);
        if (path === '/v1/auth/refresh') return json(await refreshSignIn(env, origin, body), 0);
        if (path === '/v1/auth/sign-out') return json(await signOut(env, request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')), 0);
      } catch (error) {
        if (!(error instanceof SignInError)) throw error;
        const response = json({ error: { code: error.code, message: error.message } }, 0, error.status);
        if (error.retryAfterSeconds) response.headers.set('retry-after', String(error.retryAfterSeconds));
        return response;
      }
    }
    // Pages, Markdown and discovery documents for people and agents.
    const site = await handleSiteRequest(request);
    if (site) return site;
    if (request.method === 'GET' && (path === '/' || path === '/v1')) return json(apiIndex(origin), 300);
    if (request.method === 'GET' && path === '/v1/openapi.json') return json(fullOpenApi(origin), 300);
    if (path === '/llms.txt') return new Response(llmsTxt(origin), { headers: { ...publicHeaders, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (path === '/.well-known/mcp.json' || path === '/.well-known/mcp-server') return json(serverCard(origin), 3600);
    if (path === '/open/mcp') return withCors(await openMcp(env, origin).fetch(request));
    if (path === '/me/mcp') {
      const account = await Account.fromRequest(request, env, origin, internal);
      return withCors(await accountMcp(env, origin, account).fetch(request));
    }

    if (request.method === 'GET' && path === '/v1/feed') {
      const requested = url.searchParams.get('sources') ?? url.searchParams.get('networks');
      const chosen = requested ? requested.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
      if (chosen?.some((item) => !sources.includes(item as Source))) throw new AgentError(400, 'bad_request', `sources must be a comma-separated list of ${sources.join(', ')}.`);
      const kind = url.searchParams.get('kind') ?? 'feed';
      const mode = url.searchParams.get('mode') ?? 'raw';
      if (kind !== 'feed' && kind !== 'clips') throw new AgentError(400, 'bad_request', 'kind must be feed or clips.');
      if (mode !== 'raw' && mode !== 'relevant') throw new AgentError(400, 'bad_request', 'mode must be raw or relevant.');
      const page = await feed(env, origin, { sources: chosen as Source[] | undefined, kind, mode, cursor: url.searchParams.get('cursor') ?? undefined });
      return json({ ...page, next: page.nextCursor ? withParams(url, { cursor: page.nextCursor }) : null }, 30);
    }
    if (request.method === 'GET' && path === '/v1/search') return json(await search(env, origin, url.searchParams.get('q') ?? ''), 30);
    if (request.method === 'GET' && path === '/v1/networks') return json(networksDescription(env), 300);
    if (request.method === 'GET' && path === '/v1/settings') return json(settingsLookup(url.searchParams.get('q')), 3600);
    if (request.method === 'GET' && path === '/v1/about') return json(aboutOpenMedia(origin), 3600);
    if (request.method === 'GET' && path === '/v1/events/upcoming') {
      try {
        return json(await upcomingEvents(env, { area: url.searchParams.get('area') ?? undefined, days: Number(url.searchParams.get('days') ?? 7), query: url.searchParams.get('q') ?? undefined, limit: Number(url.searchParams.get('limit') ?? 20) }), 300);
      } catch (error) { throw error instanceof EventsUnavailable ? new AgentError(400, 'bad_request', error.message) : error; }
    }
    const personPath = path.match(/^\/v1\/people\/([^/]+)\/([^/]+)$/);
    if (request.method === 'GET' && personPath) return json(await personTimeline(env, origin, decodeURIComponent(personPath[1]), decodeURIComponent(personPath[2]), url.searchParams.get('cursor') ?? undefined), 60);

    if (request.method === 'POST' && path === '/v1/verification/stripe/webhook') {
      try { return json(await handleVerificationWebhook(env, await request.text(), request.headers.get('stripe-signature')), 0); }
      catch (error) { throw error instanceof VerificationError ? new AgentError(error.status, error.code, error.message) : error; }
    }

    if (request.method === 'POST' && path === '/v1/payments/stripe/webhook') {
      return json(await paymentsCall(async () => handlePaymentsWebhook(env, await request.text(), request.headers.get('stripe-signature'))), 0);
    }

    // Account routes: every one needs the person's own token.
    const account = await Account.fromRequest(request, env, origin, internal);
    const raw = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ? await request.json().catch(() => ({})) as unknown : {};
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    // Idempotency-Key: a retried write with the same key returns the first result instead of a copy.
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (idempotencyKey !== undefined && !uuid.test(idempotencyKey)) throw new AgentError(400, 'bad_request', 'Idempotency-Key must be a UUID.');
    if (request.method === 'GET' && path === '/v1/me') return json(await account.me(), 0);
    if (request.method === 'PUT' && path === '/v1/me/profile') return json(await account.setUpProfile(body), 0);
    if (request.method === 'POST' && path === '/v1/me/posts') return json(await account.publish(body.body ?? body.text, idempotencyKey), 0, 201);
    const postMatch = path.match(/^\/v1\/me\/posts\/([^/]+)$/);
    if (request.method === 'DELETE' && postMatch) return json(await account.deletePost(decodeURIComponent(postMatch[1])), 0);
    const reportMatch = path.match(/^\/v1\/posts\/([^/]+)\/report$/);
    if (request.method === 'POST' && reportMatch) return json(await account.report(decodeURIComponent(reportMatch[1]), body.reason, body.details), 0);
    if (request.method === 'GET' && path === '/v1/me/conversations') return json(await account.conversations(), 0);
    if (request.method === 'POST' && path === '/v1/me/conversations') return json(await account.startConversation(body.handle), 0, 201);
    const messageMatch = path.match(/^\/v1\/me\/conversations\/([^/]+)\/messages$/);
    if (request.method === 'POST' && messageMatch) return json(await account.send(decodeURIComponent(messageMatch[1]), body.body ?? body.text), 0, 201);
    if (request.method === 'GET' && path === '/v1/me/export') return json(await account.exportData(), 0);
    if (request.method === 'GET' && path === '/v1/me/email') return json(await account.email(Number(url.searchParams.get('limit') ?? 50)), 0);
    if (request.method === 'POST' && path === '/v1/me/blocks') return json(await account.block(body.handle, body.blocked), 0);
    const conversationReport = path.match(/^\/v1\/me\/conversations\/([^/]+)\/report$/);
    if (request.method === 'POST' && conversationReport) return json(await account.reportConversation(decodeURIComponent(conversationReport[1]), body.handle, body.messageId), 0);
    if (request.method === 'DELETE' && path === '/v1/me') return json(await account.deleteAccount(body.confirmation), 0);
    if (request.method === 'GET' && path === '/v1/me/contacts') return json(await account.contacts(), 0);
    if (request.method === 'PUT' && path === '/v1/me/contacts') return json(await account.saveContacts(Array.isArray(raw) ? raw : body.cards), 0);
    const contactMatch = path.match(/^\/v1\/me\/contacts\/([^/]+)$/);
    if (request.method === 'DELETE' && contactMatch) return json(await account.deleteContact(decodeURIComponent(contactMatch[1])), 0);
    if (request.method === 'PUT' && path === '/v1/me/linked-accounts') return json(await account.setLinkedAccounts(Array.isArray(raw) ? raw : body.accounts), 0);
    if (request.method === 'POST' && path === '/v1/me/listings') return json(await account.publishListing(body, idempotencyKey), 0, 201);
    const listingMatch = path.match(/^\/v1\/me\/listings\/([^/]+)$/);
    if (request.method === 'PATCH' && listingMatch) return json(await account.updateListing(decodeURIComponent(listingMatch[1]), body) as object, 0);
    const ratingMatch = path.match(/^\/v1\/me\/listings\/([^/]+)\/rating$/);
    if (request.method === 'PUT' && ratingMatch) return json(await account.rateListing(decodeURIComponent(ratingMatch[1]), body.stars) as object, 0);
    if (request.method === 'DELETE' && ratingMatch) return json(await account.rateListing(decodeURIComponent(ratingMatch[1]), null) as object, 0);
    if (request.method === 'GET' && path === '/v1/me/identity') return json(await account.identity(), 0);
    if (request.method === 'PUT' && path === '/v1/me/identity') return json(await account.setIdentity(body), 0);
    if (request.method === 'POST' && path === '/v1/me/verification') return json(await account.startVerification(), 0, 201);
    if (request.method === 'GET' && path === '/v1/me/payments') return json(await account.payments(Number(url.searchParams.get('limit') ?? 50)), 0);
    if (request.method === 'POST' && path === '/v1/me/payments') return json(await account.pay(idempotencyKey ? { ...body, idempotencyKey } : body), 0, 201);
    if (request.method === 'GET' && path === '/v1/me/payments/setup') return json(await account.paymentSetup(), 0);
    if (request.method === 'POST' && path === '/v1/me/payments/payouts') return json(await account.startPayouts(), 0, 201);
    if (request.method === 'POST' && path === '/v1/me/payments/payouts/refresh') return json(await account.refreshPayouts(), 0);
    const paymentMatch = path.match(/^\/v1\/me\/payments\/([^/]+)$/);
    if (request.method === 'GET' && paymentMatch) return json(await account.payment(decodeURIComponent(paymentMatch[1])), 0);
    const transactionMatch = path.match(/^\/v1\/me\/payments\/([^/]+)\/transaction$/);
    if (request.method === 'POST' && transactionMatch) return paymentProgress(await account.submitTransaction(decodeURIComponent(transactionMatch[1]), body.txHash), origin);
    const checkMatch = path.match(/^\/v1\/me\/payments\/([^/]+)\/check$/);
    if (request.method === 'POST' && checkMatch) return paymentProgress(await account.checkPayment(decodeURIComponent(checkMatch[1])), origin);
    if (request.method === 'PUT' && path === '/v1/me/payments/tips') return json(await account.setTips(body.enabled), 0);
    if (request.method === 'GET' && path === '/v1/me/ondc') return json(await account.ondcStore(), 0);
    if (request.method === 'PUT' && path === '/v1/me/ondc') return json(await account.setOndcStore(body), 0);
    if (request.method === 'POST' && path === '/v1/me/paid-posts') return json(await account.publishPaidPost(body, idempotencyKey), 0, 201);
    const postOptionsMatch = path.match(/^\/v1\/me\/posts\/([^/]+)\/payment-options$/);
    if (request.method === 'GET' && postOptionsMatch) return json(await account.postPaymentOptions(decodeURIComponent(postOptionsMatch[1])), 0);
    const paidMatch = path.match(/^\/v1\/me\/posts\/([^/]+)\/paid$/);
    if (request.method === 'GET' && paidMatch) return json(await account.paidContent(decodeURIComponent(paidMatch[1])), 0);
    if (request.method === 'POST' && path === '/v1/me/wallets') return json(await account.linkWallet(body) as object, 0, 201);
    const walletMatch = path.match(/^\/v1\/me\/wallets\/([^/]+)$/);
    if (request.method === 'DELETE' && walletMatch) return json(await account.removeWallet(decodeURIComponent(walletMatch[1])), 0);
    const optionsMatch = path.match(/^\/v1\/me\/listings\/([^/]+)\/payment-options$/);
    if (request.method === 'GET' && optionsMatch) return json(await account.paymentOptions(decodeURIComponent(optionsMatch[1])), 0);
    if (request.method === 'GET' && path === '/v1/me/follows') return json(await account.follows() as object, 0);
    if (request.method === 'POST' && path === '/v1/me/follows') return json(await account.follow(body.handle) as object, 0, 201);
    const followMatch = path.match(/^\/v1\/me\/follows\/([^/]+)$/);
    if (request.method === 'DELETE' && followMatch) return json(await account.unfollow(decodeURIComponent(followMatch[1])) as object, 0);
    const requestMatch = path.match(/^\/v1\/me\/follow-requests\/([^/]+)$/);
    if (request.method === 'POST' && requestMatch) return json(await account.answerFollowRequest(decodeURIComponent(requestMatch[1]), body.accept) as object, 0);
    const followerMatch = path.match(/^\/v1\/me\/followers\/([^/]+)$/);
    if (request.method === 'DELETE' && followerMatch) return json(await account.removeFollower(decodeURIComponent(followerMatch[1])) as object, 0);
    throw new AgentError(404, 'not_found', 'No such endpoint. See /v1 or /llms.txt.');
  } catch (error) {
    if (error instanceof AgentError) {
      const response = json({ error: { code: error.code, message: error.message } }, 0, error.status);
      if (error.status === 401) response.headers.set('www-authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
      return response;
    }
    console.error(JSON.stringify({ event: 'agent_api_failed', path, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
    return json({ error: { code: 'upstream_unavailable', message: 'Open Media is temporarily unavailable. Try again shortly.' } }, 0, 502);
  }
}

/**
 * A USDC payment the network has not settled yet is still running: 202 Accepted, with the payment
 * to poll in Location and a job object, so agents follow it instead of retrying.
 */
function paymentProgress(outcome: { payment: Payment; detail?: string }, origin: string): Response {
  if (outcome.payment.status !== 'submitted') return json(outcome, 0);
  const poll = `${origin}/v1/me/payments/${outcome.payment.id}`;
  const response = json({ ...outcome, job: { id: outcome.payment.id, status: 'running', poll, check: `${poll}/check`, retryAfterSeconds: 5 } }, 0, 202);
  response.headers.set('location', poll);
  response.headers.set('retry-after', '5');
  return response;
}

// ─── NLWeb ───────────────────────────────────────────────────────────────────

/**
 * NLWeb v0.55 /ask: a plain-language question answered with schema.org items from the docs and
 * from public posts on every network. Failures keep HTTP 200, as the spec describes. With
 * prefer.streaming and Accept: text/event-stream the same items arrive as start, result and
 * complete events.
 */
async function nlwebAsk(request: Request, env: AgentEnv, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const input = request.method === 'POST' ? await request.json().catch(() => ({})) as { query?: { text?: unknown }; prefer?: { streaming?: unknown } } : { query: { text: url.searchParams.get('query') ?? url.searchParams.get('q') }, prefer: {} };
  const text = typeof input.query?.text === 'string' ? input.query.text.trim() : '';
  const meta = { version: '0.55' };
  if (!text || text.length > 500) return json({ _meta: { ...meta, response_type: 'failure' }, error: { code: 'INVALID_QUERY', message: 'Send query.text with 1 to 500 characters.' } }, 0);
  const docs: object[] = searchDocs(origin, text).slice(0, 3).map((page) => ({ '@type': 'TechArticle', name: page.title, description: page.description, url: page.url, grounding: { source: 'Open Media documentation', excerpts: page.matches.slice(0, 3) } }));
  const streaming = input.prefer?.streaming === true && /text\/event-stream/.test(request.headers.get('accept') ?? '');
  // Some networks answer slowly; posts that miss the budget are left out rather than holding up the answer.
  const posts = nlwebPosts(env, origin, text, streaming ? 4000 : 2500);
  if (!streaming) {
    const results = [...docs, ...await posts];
    if (!results.length) return json({ _meta: { ...meta, response_type: 'failure' }, error: { code: 'NO_RESULTS', message: 'Nothing on Open Media or the open networks matched.' } }, 0);
    return json({ _meta: { ...meta, response_type: 'answer', response_format: 'conversational_search' }, results }, 0);
  }
  const event = (name: string, data: object) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  // Documentation results go out at once; posts follow when the networks answer.
  const { readable: body, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  void (async () => {
    await writer.write(event('start', { _meta: { ...meta, response_type: 'answer', streaming: true } }));
    for (const [index, item] of docs.entries()) await writer.write(event('result', { index, item }));
    const later = await posts;
    for (const [index, item] of later.entries()) await writer.write(event('result', { index: docs.length + index, item }));
    if (!docs.length && !later.length) await writer.write(event('error', { code: 'NO_RESULTS', message: 'Nothing matched.' }));
    await writer.write(event('complete', { _meta: { ...meta, response_type: 'answer' } }));
    await writer.close();
  })().catch(() => writer.abort().catch(() => undefined));
  return new Response(body, { headers: { ...publicHeaders, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Public posts from every network matching the question, as schema.org items, within a time budget. */
async function nlwebPosts(env: AgentEnv, origin: string, text: string, budgetMs: number): Promise<object[]> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, budgetMs));
  const found = await Promise.race([(search(env, origin, text) as Promise<{ posts?: AgentPost[] }>).catch(() => undefined), timeout]);
  return (found?.posts ?? []).slice(0, 10).map((post) => ({
    '@type': 'SocialMediaPosting', name: post.title ?? post.text.slice(0, 80), description: post.text.slice(0, 500), url: post.url, datePublished: post.createdAt,
    author: { '@type': 'Person', name: post.author.name, identifier: post.author.handle }, isPartOf: post.network, grounding: { source: post.network, why: post.why.used },
  }));
}

/** Schema feed: Open Media's newest public posts as JSON Lines of schema.org SocialMediaPosting. */
async function postsFeed(env: AgentEnv, origin: string): Promise<Response> {
  let records: PublicPostRecord[];
  try {
    records = await callRpc<PublicPostRecord[]>(env, fetch, 'open_media_public_posts', { p_limit: 50, p_before_created_at: null, p_before_id: null, p_author_handle: null, p_media: null });
  } catch {
    return new Response(JSON.stringify({ error: { code: 'upstream_unavailable', message: 'The posts feed is unavailable right now.' } }), { status: 503, headers: { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', 'retry-after': '30' } });
  }
  const lines = (Array.isArray(records) ? records : []).map((record) => JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SocialMediaPosting', identifier: record.id, url: `${origin}/v1/posts/${record.id}`, datePublished: record.createdAt,
    articleBody: record.body, author: { '@type': 'Person', name: record.author.displayName, identifier: `@${record.author.handle}`, url: `${origin}/v1/profiles/${record.author.handle}` },
  }));
  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), { headers: { ...publicHeaders, 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

function json(body: Json | object, maxAgeSeconds: number, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAgeSeconds > 0 ? `public, max-age=${maxAgeSeconds}` : 'no-store' },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(publicHeaders)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function withParams(url: URL, params: Record<string, string>): string {
  const next = new URL(url.toString());
  for (const [key, value] of Object.entries(params)) next.searchParams.set(key, value);
  return next.toString();
}

function encodeJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeFeedCursor(value: string): FeedCursor {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
    return parsed as FeedCursor;
  } catch {
    throw new AgentError(400, 'bad_request', 'The cursor is invalid. Use nextCursor from a previous response.');
  }
}

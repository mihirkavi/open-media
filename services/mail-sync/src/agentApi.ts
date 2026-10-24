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
import { networkConnectors } from '../../../src/connectors/networkFeeds';
import { networkSearches } from '../../../src/connectors/networkSearch';
import { collapseRepeatedPosts, NetworkId, networks } from '../../../src/domain/networkPosts';
import { explainFeedPost, FeedMode, SocialPost } from '../../../src/domain/posts';
import { maxPostLength, PublicPostRecord, socialPostFromPublic } from '../../../src/domain/publicPosts';
import { parseSearchQuery, postMatchesSearch } from '../../../src/domain/searchQuery';
import { searchSettings, settingIndex } from '../../../src/domain/settings';
import { availableNetworks, BridgesEnv } from './bridges.js';
import { callRpc, formatPost, formatProfile, openApiDocument, PublicApiEnv, UpstreamPost, UpstreamProfile } from './publicApi.js';
import { authenticate } from './session.js';

export type AgentEnv = PublicApiEnv & BridgesEnv;

const version = '1.0.0';
const sources = ['open-media', 'farcaster', 'lens', 'hive', 'deso'] as const;
type Source = typeof sources[number];
const networkIds: NetworkId[] = ['farcaster', 'lens', 'hive', 'deso'];
const reportReasons = ['spam', 'harassment', 'other'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const handlePattern = /^[a-z0-9_]{3,24}$/i;

const publicHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'mcp-session-id',
  'x-content-type-options': 'nosniff',
};

export class AgentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Paths served here. They are matched before the read-only public API and the mail routes. */
export function isAgentPath(pathname: string, method: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (['/', '/v1', '/v1/openapi.json', '/llms.txt', '/.well-known/mcp.json', '/.well-known/mcp-server', '/open/mcp', '/me/mcp'].includes(path)) return true;
  if (['/v1/feed', '/v1/search', '/v1/networks', '/v1/settings', '/v1/about'].includes(path)) return true;
  if (path === '/v1/me' || path.startsWith('/v1/me/')) return true;
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
  const wanted = networkSearches.filter((network) => !parsed.networks || parsed.networks.includes(network.id));
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

// ─── Account capabilities (the person's own access token) ───────────────────

/** Acts as one signed-in person through Supabase's REST API; row-level security enforces it. */
export class Account {
  constructor(private readonly env: AgentEnv, private readonly token: string, readonly userId: string, private readonly origin: string) {}

  static async fromRequest(request: Request, env: AgentEnv, origin: string): Promise<Account> {
    try {
      const { token, userId } = await authenticate(request, env.SUPABASE_URL.replace(/\/$/, ''));
      return new Account(env, token, userId, origin);
    } catch {
      throw new AgentError(401, 'unauthorized', 'Send your Open Media access token as “Authorization: Bearer …”. Get one in the app: Settings → Developers and agents.');
    }
  }

  async me() {
    const [profile] = await this.rest<{ id: string; handle: string; display_name: string; bio: string; avatar_url: string | null }[]>('GET', `/rest/v1/profiles?id=eq.${this.userId}&select=id,handle,display_name,bio,avatar_url`);
    if (!profile) throw new AgentError(404, 'no_profile', 'Finish setting up your profile in the app first.');
    return { id: profile.id, handle: profile.handle, displayName: profile.display_name, bio: profile.bio, avatarUrl: profile.avatar_url, url: `${this.origin}/v1/profiles/${profile.handle}` };
  }

  async publish(body: unknown) {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new AgentError(400, 'bad_request', 'Write something before publishing.');
    if (text.length > maxPostLength) throw new AgentError(400, 'bad_request', `Posts can be up to ${maxPostLength} characters.`);
    const post = await this.rpc<UpstreamPost>('open_media_create_post', { p_client_id: crypto.randomUUID(), p_body: text, p_video: null });
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
    const profiles = people.length ? await this.rest<{ id: string; handle: string; display_name: string }[]>('GET', `/rest/v1/profiles?id=in.(${people.join(',')})&select=id,handle,display_name`) : [];
    const byId = new Map(profiles.map((row) => [row.id, row]));
    const name = (id: string) => byId.get(id)?.display_name || byId.get(id)?.handle || 'Someone';
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
    const [person] = await this.rest<{ id: string }[]>('GET', `/rest/v1/profiles?handle=eq.${clean}&select=id`);
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

  private rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.rest<T>('POST', `/rest/v1/rpc/${name}`, args);
  }

  private async rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        apikey: this.env.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' && !path.includes('/rpc/') ? { prefer: 'return=minimal' } : {}),
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

function result(payload: unknown) {
  const text = JSON.stringify(payload);
  return { content: [{ type: 'text' as const, text: text.length > 60_000 ? `${text.slice(0, 60_000)}…` : text }] };
}

function failure(error: unknown) {
  const message = error instanceof AgentError ? error.message : 'Open Media hit an error. Try again shortly.';
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof AgentError ? error.code : 'internal_error', message }) }] };
}

function tool(server: McpServer, name: string, config: { title: string; description: string; input: z.ZodRawShape; readOnly: boolean }, run: (args: Record<string, unknown>) => Promise<unknown> | unknown) {
  server.registerTool(name, {
    title: config.title,
    description: config.description,
    inputSchema: z.object(config.input),
    annotations: { readOnlyHint: config.readOnly, openWorldHint: true, destructiveHint: !config.readOnly && name.startsWith('delete') },
  }, (async (args: Record<string, unknown>) => {
    try { return result(await run(args ?? {})); } catch (error) { return failure(error); }
  }) as never);
}

function registerPublicTools(server: McpServer, env: AgentEnv, origin: string) {
  const sourceEnum = z.enum(sources);
  tool(server, 'get_feed', { title: 'Read the feed', description: 'The mixed feed: Open Media plus Farcaster, Lens, Hive and DeSo public posts, newest first (raw) or ranked (relevant). Each post includes its network, source link and “why” reasons. Pass nextCursor back to read further.', input: { sources: z.array(sourceEnum).optional(), kind: z.enum(['feed', 'clips']).optional().describe('clips = short videos only'), mode: z.enum(['raw', 'relevant']).optional(), cursor: z.string().optional() }, readOnly: true },
    (args) => feed(env, origin, { sources: args.sources as Source[] | undefined, kind: args.kind as 'feed' | 'clips' | undefined, mode: args.mode as FeedMode | undefined, cursor: args.cursor as string | undefined }));
  tool(server, 'search', { title: 'Search everything public', description: 'Plain-language search across public posts on Open Media, Farcaster, Lens, Hive and DeSo, plus matching app settings. Understands phrases like “videos about ethereum on lens today” and says what it understood and how each network was searched.', input: { query: z.string().min(1).max(200) }, readOnly: true },
    (args) => search(env, origin, String(args.query)));
  tool(server, 'get_post', { title: 'Get a post', description: 'One public Open Media post by id.', input: { id: z.string() }, readOnly: true }, (args) => publicPost(env, origin, String(args.id)));
  tool(server, 'get_profile', { title: 'Get a profile', description: 'A public Open Media profile by handle, with recent posts.', input: { handle: z.string() }, readOnly: true }, (args) => publicProfile(env, origin, String(args.handle)));
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
}

function openMcp(env: AgentEnv, origin: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'open-media', title: 'Open Media', version }, { instructions });
    registerPublicTools(server, env, origin);
    return server;
  }, { legacy: 'stateless', responseMode: 'json' });
}

function accountMcp(env: AgentEnv, origin: string, account: Account) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'open-media-account', title: 'Open Media (your account)', version }, { instructions: `${instructions} These tools act as the signed-in person; ask before publishing, deleting or sending anything.` });
    registerPublicTools(server, env, origin);
    registerAccountTools(server, account);
    return server;
  }, { legacy: 'stateless', responseMode: 'json' });
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export function llmsTxt(origin: string): string {
  const line = (item: { method?: string; path: string; description: string }) => `- ${item.method ? `${item.method} ` : ''}[${item.path}](${origin}${item.path.replace(/\{[^}]+\}/g, ':id').replace(/=$/, '=…')}): ${item.description}`;
  return [
    '# Open Media',
    '',
    `> ${tagline} ${promise} ${mission}`,
    '',
    `${philosophy.line} ${philosophy.body}`,
    '',
    'Public data needs no account or key. Account calls take the person’s own short-lived access token (“Authorization: Bearer …”), which they copy from the app (Settings → Developers and agents), and act only as them.',
    '',
    '## Discovery',
    ...agentInterfaces.discovery.map(line),
    '',
    '## MCP servers',
    ...agentInterfaces.mcp.map((server) => `- [${server.path}](${origin}${server.path}) (${server.auth}): ${server.description}`),
    '',
    '## Public API',
    ...agentInterfaces.public.map(line),
    '',
    '## Account API',
    ...agentInterfaces.account.map(line),
    '',
    '## Rules',
    '- Open Media’s own public posts and profiles may be read and indexed freely; please use the API and cache responses.',
    '- Posts from other networks keep their source and link back to it. Messages, email and contacts are never public.',
    '- Agents identify as agents and never pose as people. Confirm with the person before publishing, deleting or sending.',
    '',
    '## Principles',
    ...principles.map((item) => `- ${item}`),
    '',
    '## Status',
    ...honestStatus.map((item) => `- ${item}`),
    '',
    `Source code (MIT): ${sourceRepository}`,
    '',
  ].join('\n');
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
      { name: 'open-media-account', title: 'Open Media (your account)', url: `${origin}/me/mcp`, transport: 'streamable-http', authentication: { type: 'bearer', description: 'The person’s Open Media access token, copied from Settings → Developers and agents. It expires after about an hour.' }, tools: ['get_me', 'publish_post', 'delete_post', 'report_post', 'list_conversations', 'start_conversation', 'send_message', 'export_my_data', 'plus every public tool'] },
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
export function fullOpenApi(origin: string) {
  const base = openApiDocument(origin) as { info: Record<string, unknown>; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } } & Record<string, unknown>;
  const error = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  const ok = (description: string, schema: unknown = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
  const bearer = [{ bearerAuth: [] }];
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
      '/v1/about': { get: { summary: 'Mission, principles, promises, roadmap and honest status', responses: { 200: ok('About Open Media') } } },
      '/v1/me': { get: { summary: 'Your profile', security: bearer, responses: { 200: ok('Profile'), 401: error } } },
      '/v1/me/posts': { post: { summary: 'Publish a public post', security: bearer, requestBody: textBody('body', maxPostLength), responses: { 201: ok('The new post', { $ref: '#/components/schemas/Post' }), 400: error, 401: error } } },
      '/v1/me/posts/{id}': { delete: { summary: 'Delete one of your posts', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: ok('Deleted'), 401: error, 403: error } } },
      '/v1/posts/{id}/report': { post: { summary: 'Report a post for review', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', enum: [...reportReasons] }, details: { type: 'string', maxLength: 1000 } } } } } }, responses: { 200: ok('Reported'), 400: error, 401: error } } },
      '/v1/me/conversations': {
        get: { summary: 'Your conversations with recent messages', security: bearer, responses: { 200: ok('Conversations'), 401: error } },
        post: { summary: 'Start a conversation with a handle', security: bearer, requestBody: textBody('handle', 24), responses: { 201: ok('The conversation'), 404: error, 401: error } },
      },
      '/v1/me/conversations/{id}/messages': { post: { summary: 'Send a message', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: textBody('body', 8000), responses: { 201: ok('Sent'), 400: error, 401: error, 403: error } } },
      '/v1/me/export': { get: { summary: 'Export a readable copy of your data', security: bearer, responses: { 200: ok('Your data'), 401: error } } },
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

export async function handleAgentRequest(request: Request, env: AgentEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const origin = url.origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...publicHeaders, 'access-control-max-age': '86400' } });
  // Same per-client limit as the read-only API: feed and search fan out to four other networks.
  if (env.PUBLIC_API_RATE_LIMITER) {
    const { success } = await env.PUBLIC_API_RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' } }), { status: 429, headers: { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', 'retry-after': '60' } });
  }
  try {
    if (request.method === 'GET' && (path === '/' || path === '/v1')) return json(apiIndex(origin), 300);
    if (request.method === 'GET' && path === '/v1/openapi.json') return json(fullOpenApi(origin), 300);
    if (path === '/llms.txt') return new Response(llmsTxt(origin), { headers: { ...publicHeaders, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (path === '/.well-known/mcp.json' || path === '/.well-known/mcp-server') return json(serverCard(origin), 3600);
    if (path === '/open/mcp') return withCors(await openMcp(env, origin).fetch(request));
    if (path === '/me/mcp') {
      const account = await Account.fromRequest(request, env, origin);
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

    // Account routes: every one needs the person's own token.
    const account = await Account.fromRequest(request, env, origin);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) as Record<string, unknown> : {};
    if (request.method === 'GET' && path === '/v1/me') return json(await account.me(), 0);
    if (request.method === 'POST' && path === '/v1/me/posts') return json(await account.publish(body.body ?? body.text), 0, 201);
    const postMatch = path.match(/^\/v1\/me\/posts\/([^/]+)$/);
    if (request.method === 'DELETE' && postMatch) return json(await account.deletePost(decodeURIComponent(postMatch[1])), 0);
    const reportMatch = path.match(/^\/v1\/posts\/([^/]+)\/report$/);
    if (request.method === 'POST' && reportMatch) return json(await account.report(decodeURIComponent(reportMatch[1]), body.reason, body.details), 0);
    if (request.method === 'GET' && path === '/v1/me/conversations') return json(await account.conversations(), 0);
    if (request.method === 'POST' && path === '/v1/me/conversations') return json(await account.startConversation(body.handle), 0, 201);
    const messageMatch = path.match(/^\/v1\/me\/conversations\/([^/]+)\/messages$/);
    if (request.method === 'POST' && messageMatch) return json(await account.send(decodeURIComponent(messageMatch[1]), body.body ?? body.text), 0, 201);
    if (request.method === 'GET' && path === '/v1/me/export') return json(await account.exportData(), 0);
    throw new AgentError(404, 'not_found', 'No such endpoint. See /v1 or /llms.txt.');
  } catch (error) {
    if (error instanceof AgentError) return json({ error: { code: error.code, message: error.message } }, 0, error.status);
    console.error(JSON.stringify({ event: 'agent_api_failed', path, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
    return json({ error: { code: 'upstream_unavailable', message: 'Open Media is temporarily unavailable. Try again shortly.' } }, 0, 502);
  }
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

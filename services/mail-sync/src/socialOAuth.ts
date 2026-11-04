import { UserFacingError } from './errors.js';

/**
 * Cross-posting to closed networks through their official OAuth APIs (ADR 0033): X, Threads,
 * LinkedIn, Instagram and Facebook Pages. Each network needs Open Media's own developer app
 * there, whose secret only this server holds.
 *
 * The server is a pass-through. It builds the authorize URL, exchanges the code with the app
 * secret, and forwards posts. It stores nothing: the person's token goes back to their device,
 * which sends it with each post, as with every other network.
 */
export type SocialNetwork = 'x' | 'threads' | 'linkedin' | 'instagram' | 'facebook';
export const socialNetworks: SocialNetwork[] = ['x', 'threads', 'linkedin', 'instagram', 'facebook'];

export interface SocialOAuthEnv {
  X_CLIENT_ID?: string; X_CLIENT_SECRET?: string;
  THREADS_APP_ID?: string; THREADS_APP_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string; LINKEDIN_CLIENT_SECRET?: string;
  INSTAGRAM_APP_ID?: string; INSTAGRAM_APP_SECRET?: string;
  FACEBOOK_APP_ID?: string; FACEBOOK_APP_SECRET?: string;
  CONVO_APP_ORIGIN: string;
}

const credentialNames: Record<SocialNetwork, [keyof SocialOAuthEnv, keyof SocialOAuthEnv]> = {
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  threads: ['THREADS_APP_ID', 'THREADS_APP_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  instagram: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
};

const names: Record<SocialNetwork, string> = { x: 'X', threads: 'Threads', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook' };
const graphVersion = 'v23.0';
const linkedInVersion = '202510';

export function isSocialNetwork(value: string): value is SocialNetwork {
  return (socialNetworks as string[]).includes(value);
}

function credentials(network: SocialNetwork, env: SocialOAuthEnv): { id: string; secret: string } | undefined {
  const [id, secret] = credentialNames[network].map((name) => env[name]);
  return id && secret ? { id, secret } : undefined;
}

/** Which networks this server can connect, for `/v1/social/status` (no secrets). */
export function socialStatus(env: SocialOAuthEnv): Record<SocialNetwork, boolean> {
  return Object.fromEntries(socialNetworks.map((network) => [network, Boolean(credentials(network, env))])) as Record<SocialNetwork, boolean>;
}

function appCredentials(network: SocialNetwork, env: SocialOAuthEnv) {
  const found = credentials(network, env);
  if (!found) throw new UserFacingError(`Open Media’s ${names[network]} app isn’t set up on this server yet.`);
  return found;
}

export function callbackURL(network: SocialNetwork, serverOrigin: string): string {
  return `${serverOrigin}/v1/social/${network}/callback`;
}

/** `omc_<32 hex>_<w|n>`: random, plus where the person's app is (web page or phone app). */
const statePattern = /^omc_[0-9a-f]{32}_(w|n)$/;

export function parseState(state: string | null): { client: 'web' | 'native' } | undefined {
  const match = state?.match(statePattern);
  return match ? { client: match[1] === 'n' ? 'native' : 'web' } : undefined;
}

export function authorizeURL(network: SocialNetwork, env: SocialOAuthEnv, serverOrigin: string, input: { state: string; challenge?: string }): string {
  if (!parseState(input.state)) throw new UserFacingError('That connect request isn’t valid. Try again.');
  const { id } = appCredentials(network, env);
  const redirect = callbackURL(network, serverOrigin);
  switch (network) {
    case 'x':
      if (!input.challenge || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)) throw new UserFacingError('That connect request isn’t valid. Try again.');
      return `https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirect, scope: 'tweet.read tweet.write users.read like.write offline.access', state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256' })}`;
    case 'threads':
      return `https://threads.net/oauth/authorize?${new URLSearchParams({ client_id: id, redirect_uri: redirect, scope: 'threads_basic,threads_content_publish', response_type: 'code', state: input.state })}`;
    case 'linkedin':
      return `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirect, state: input.state, scope: 'openid profile w_member_social' })}`;
    case 'instagram':
      return `https://www.instagram.com/oauth/authorize?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'instagram_business_basic,instagram_business_content_publish', state: input.state })}`;
    case 'facebook':
      return `https://www.facebook.com/${graphVersion}/dialog/oauth?${new URLSearchParams({ client_id: id, redirect_uri: redirect, state: input.state, scope: 'pages_show_list,pages_manage_posts,pages_read_engagement', response_type: 'code' })}`;
  }
}

/** Where the network's redirect goes next: back into the app that started connecting. */
export function appReturnURL(env: SocialOAuthEnv, serverOrigin: string, params: URLSearchParams): string {
  const state = params.get('state');
  const parsed = parseState(state);
  if (!parsed) throw new UserFacingError('That sign-in didn’t come from Open Media.');
  const forward = new URLSearchParams({ state: state! });
  const code = params.get('code');
  if (code && code.length <= 2048) forward.set('code', code);
  else forward.set('error', params.get('error') === 'access_denied' || params.get('error_reason') === 'user_denied' ? 'access_denied' : 'failed');
  if (parsed.client === 'native') return `openmedia://oauth?${forward}`;
  const origin = env.CONVO_APP_ORIGIN && env.CONVO_APP_ORIGIN !== '*' ? env.CONVO_APP_ORIGIN.split(',')[0].trim() : serverOrigin;
  return `${origin.replace(/\/$/, '')}/auth?${forward}`;
}

// ---------- network calls ----------

export interface SocialSession {
  token: string;
  refreshToken?: string;
  /** Milliseconds since 1970. */
  expiresAt?: number;
  /** The account's (or Facebook Page's) ID on the network. */
  accountId: string;
  handle: string;
  profileURL?: string;
}

type Fetcher = typeof fetch;

async function call<T>(fetcher: Fetcher, network: SocialNetwork, url: string, init: RequestInit = {}): Promise<{ body: T; headers: Headers }> {
  const response = await fetcher(url, { ...init, headers: { accept: 'application/json', ...init.headers } });
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (response.status === 401) throw new UserFacingError(`Your ${names[network]} sign-in ended. Connect ${names[network]} again in Settings → Cross-posting.`);
  if (response.status === 429) throw new UserFacingError(`${names[network]} is limiting posts right now. Try again later.`);
  if (!response.ok) {
    const record = body as { error?: { message?: string } | string; detail?: string; message?: string; error_description?: string };
    const detail = typeof record.error === 'object' ? record.error?.message : record.error_description ?? record.detail ?? record.message ?? record.error;
    throw new UserFacingError(detail && detail.length < 200 ? `${names[network]}: ${detail}` : `${names[network]} didn’t accept that. Try again.`);
  }
  return { body: body as T, headers: response.headers };
}

const form = (values: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() });
const basic = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`;
const expiry = (seconds?: number) => seconds ? Date.now() + seconds * 1000 : undefined;

export async function exchangeCode(network: SocialNetwork, env: SocialOAuthEnv, serverOrigin: string, input: { code: string; verifier?: string }, fetcher: Fetcher = fetch): Promise<SocialSession> {
  const { id, secret } = appCredentials(network, env);
  const redirect = callbackURL(network, serverOrigin);
  switch (network) {
    case 'x': {
      if (!input.verifier) throw new UserFacingError('That connect request isn’t valid. Try again.');
      const token = (await call<{ access_token: string; refresh_token?: string; expires_in?: number }>(fetcher, network, 'https://api.x.com/2/oauth2/token', { ...form({ code: input.code, grant_type: 'authorization_code', redirect_uri: redirect, code_verifier: input.verifier, client_id: id }), headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(id, secret) } })).body;
      const me = (await call<{ data: { id: string; username: string } }>(fetcher, network, 'https://api.x.com/2/users/me', { headers: { authorization: `Bearer ${token.access_token}` } })).body.data;
      return { token: token.access_token, refreshToken: token.refresh_token, expiresAt: expiry(token.expires_in), accountId: me.id, handle: `@${me.username}`, profileURL: `https://x.com/${me.username}` };
    }
    case 'threads': {
      const short = (await call<{ access_token: string }>(fetcher, network, 'https://graph.threads.net/oauth/access_token', form({ client_id: id, client_secret: secret, code: input.code, grant_type: 'authorization_code', redirect_uri: redirect }))).body;
      const long = (await call<{ access_token: string; expires_in?: number }>(fetcher, network, `https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token })}`)).body;
      const me = (await call<{ id: string; username: string }>(fetcher, network, `https://graph.threads.net/v1.0/me?${new URLSearchParams({ fields: 'id,username', access_token: long.access_token })}`)).body;
      return { token: long.access_token, expiresAt: expiry(long.expires_in), accountId: me.id, handle: `@${me.username}`, profileURL: `https://www.threads.net/@${me.username}` };
    }
    case 'linkedin': {
      const token = (await call<{ access_token: string; expires_in?: number; refresh_token?: string }>(fetcher, network, 'https://www.linkedin.com/oauth/v2/accessToken', form({ grant_type: 'authorization_code', code: input.code, redirect_uri: redirect, client_id: id, client_secret: secret }))).body;
      const me = (await call<{ sub: string; name?: string }>(fetcher, network, 'https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } })).body;
      return { token: token.access_token, refreshToken: token.refresh_token, expiresAt: expiry(token.expires_in), accountId: me.sub, handle: me.name ?? 'LinkedIn member' };
    }
    case 'instagram': {
      const short = (await call<{ access_token: string }>(fetcher, network, 'https://api.instagram.com/oauth/access_token', form({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirect, code: input.code }))).body;
      const long = (await call<{ access_token: string; expires_in?: number }>(fetcher, network, `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: short.access_token })}`)).body;
      const me = (await call<{ user_id: string; username: string }>(fetcher, network, `https://graph.instagram.com/${graphVersion}/me?${new URLSearchParams({ fields: 'user_id,username', access_token: long.access_token })}`)).body;
      return { token: long.access_token, expiresAt: expiry(long.expires_in), accountId: me.user_id, handle: `@${me.username}`, profileURL: `https://www.instagram.com/${me.username}` };
    }
    case 'facebook': {
      const short = (await call<{ access_token: string }>(fetcher, network, `https://graph.facebook.com/${graphVersion}/oauth/access_token?${new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirect, code: input.code })}`)).body;
      const long = (await call<{ access_token: string }>(fetcher, network, `https://graph.facebook.com/${graphVersion}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: short.access_token })}`)).body;
      // Facebook lets apps post to Pages only, never to personal profiles. Use the first Page the person manages.
      const pages = (await call<{ data?: { id: string; name: string; access_token: string }[] }>(fetcher, network, `https://graph.facebook.com/${graphVersion}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token', access_token: long.access_token })}`)).body.data ?? [];
      const page = pages[0];
      if (!page) throw new UserFacingError('Facebook lets apps post only to Pages, and this account doesn’t manage one.');
      return { token: page.access_token, accountId: page.id, handle: page.name, profileURL: `https://www.facebook.com/${page.id}` };
    }
  }
}

/** X tokens last two hours; the device refreshes through here. Other networks' tokens are long-lived. */
export async function refreshSession(network: SocialNetwork, env: SocialOAuthEnv, session: SocialSession, fetcher: Fetcher = fetch): Promise<SocialSession> {
  if (!session.refreshToken) throw new UserFacingError(`Your ${names[network]} sign-in ended. Connect ${names[network]} again in Settings → Cross-posting.`);
  const { id, secret } = appCredentials(network, env);
  if (network === 'x') {
    const token = (await call<{ access_token: string; refresh_token?: string; expires_in?: number }>(fetcher, network, 'https://api.x.com/2/oauth2/token', { ...form({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: id }), headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(id, secret) } })).body;
    return { ...session, token: token.access_token, refreshToken: token.refresh_token ?? session.refreshToken, expiresAt: expiry(token.expires_in) };
  }
  if (network === 'linkedin') {
    const token = (await call<{ access_token: string; refresh_token?: string; expires_in?: number }>(fetcher, network, 'https://www.linkedin.com/oauth/v2/accessToken', form({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: id, client_secret: secret }))).body;
    return { ...session, token: token.access_token, refreshToken: token.refresh_token ?? session.refreshToken, expiresAt: expiry(token.expires_in) };
  }
  return session;
}

export interface SocialPostInput { text: string; videoUrl?: string }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function publishSocial(network: SocialNetwork, session: SocialSession, post: SocialPostInput, fetcher: Fetcher = fetch): Promise<{ externalId: string; url?: string }> {
  const text = post.text.slice(0, 63_206);
  switch (network) {
    case 'x': {
      const created = (await call<{ data: { id: string } }>(fetcher, network, 'https://api.x.com/2/tweets', { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).body.data;
      return { externalId: created.id, url: `https://x.com/${session.handle.replace(/^@/, '')}/status/${created.id}` };
    }
    case 'threads': {
      const container = (await call<{ id: string }>(fetcher, network, `https://graph.threads.net/v1.0/me/threads`, form({ media_type: 'TEXT', text, access_token: session.token }))).body;
      const published = (await call<{ id: string }>(fetcher, network, `https://graph.threads.net/v1.0/me/threads_publish`, form({ creation_id: container.id, access_token: session.token }))).body;
      const permalink = await call<{ permalink?: string }>(fetcher, network, `https://graph.threads.net/v1.0/${published.id}?${new URLSearchParams({ fields: 'permalink', access_token: session.token })}`).then((result) => result.body.permalink, () => undefined);
      return { externalId: published.id, url: permalink };
    }
    case 'linkedin': {
      const created = await call(fetcher, network, 'https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json', 'LinkedIn-Version': linkedInVersion, 'X-Restli-Protocol-Version': '2.0.0' },
        body: JSON.stringify({ author: `urn:li:person:${session.accountId}`, commentary: escapeLinkedIn(text), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
      });
      const urn = created.headers.get('x-restli-id') ?? '';
      return { externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : undefined };
    }
    case 'instagram': {
      if (!post.videoUrl) throw new UserFacingError('Instagram posts need a video.');
      const base = `https://graph.instagram.com/${graphVersion}`;
      const container = (await call<{ id: string }>(fetcher, network, `${base}/${session.accountId}/media`, form({ media_type: 'REELS', video_url: post.videoUrl, caption: text, access_token: session.token }))).body;
      // Instagram downloads and processes the video before it can be published.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const status = (await call<{ status_code?: string }>(fetcher, network, `${base}/${container.id}?${new URLSearchParams({ fields: 'status_code', access_token: session.token })}`)).body.status_code;
        if (status === 'FINISHED') break;
        if (status === 'ERROR' || status === 'EXPIRED') throw new UserFacingError('Instagram couldn’t process the video.');
        if (attempt === 19) throw new UserFacingError('Instagram is still processing the video. Try again in a minute.');
        await wait(3000);
      }
      const published = (await call<{ id: string }>(fetcher, network, `${base}/${session.accountId}/media_publish`, form({ creation_id: container.id, access_token: session.token }))).body;
      const permalink = await call<{ permalink?: string }>(fetcher, network, `${base}/${published.id}?${new URLSearchParams({ fields: 'permalink', access_token: session.token })}`).then((result) => result.body.permalink, () => undefined);
      return { externalId: published.id, url: permalink };
    }
    case 'facebook': {
      const created = (await call<{ id: string }>(fetcher, network, `https://graph.facebook.com/${graphVersion}/${session.accountId}/feed`, form({ message: text, access_token: session.token }))).body;
      return { externalId: created.id, url: `https://www.facebook.com/${created.id}` };
    }
  }
}

/** LinkedIn's "little text" format treats these characters as markup unless escaped. */
export function escapeLinkedIn(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);
}

export function parseSession(value: unknown): SocialSession {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = (key: string, max = 4096) => typeof record[key] === 'string' && (record[key] as string).length <= max ? record[key] as string : undefined;
  const token = text('token'); const accountId = text('accountId', 256); const handle = text('handle', 256);
  if (!token || !accountId || !handle) throw new UserFacingError('Connect this network again in Settings → Cross-posting.');
  return { token, accountId, handle, refreshToken: text('refreshToken'), expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : undefined, profileURL: text('profileURL', 512) };
}

export function parsePost(value: unknown): SocialPostInput {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text : '';
  const videoUrl = typeof record.videoUrl === 'string' && /^https:\/\/[^\s]{1,2040}$/.test(record.videoUrl) ? record.videoUrl : undefined;
  if (!text.trim() && !videoUrl) throw new UserFacingError('There is nothing to post.');
  if (text.length > 63_206) throw new UserFacingError('That post is too long.');
  return { text, videoUrl };
}

/**
 * Mail sync and the public read API, independent of the hosting runtime. The
 * Cloudflare Worker (worker.ts) and the local Node.js server (localServer.ts)
 * both call handleMailRequest.
 */
import { z } from 'zod';

import { Bridges, BridgesEnv, withoutReadTimes } from './bridges.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { createSignedKeyRequest, FarcasterSignerEnv, farcasterPublishingConfigured, forwardSignedMessage, parseEd25519PublicKey } from './farcasterSigner.js';
import { UserFacingError } from './errors.js';
import { formatCursor, parseCursor } from './mailCursor.js';
import { markSeenImap, syncImap, testImap } from './imap.js';
import { findSenderIcon, isIconDomain } from './senderIcons.js';
import { resolveMailHost } from './networkSafety.js';
import { handleAgentRequest, isAgentPath } from './agentApi.js';
import { handlePublicApiRequest, isPublicApiPath } from './publicApi.js';
import { authenticate } from './session.js';
import { appReturnURL, authorizeURL, exchangeCode, isSocialNetwork, parsePost, parseSession, publishSocial, refreshSession, SocialOAuthEnv, socialStatus } from './socialOAuth.js';
import { runSearchAssist, SearchAssistEnv } from './searchAssist.js';
import { AiChatEnv, ownSearchModel, recordSearch } from './aiChat.js';
import { runTranslate, TranslateEnv } from './translate.js';
import { readDictationAudio, transcribe } from './dictate.js';
import { parseGifQuery, searchGifs, GifSearchEnv } from './gifSearch.js';
import { syncPop3, testPop3 } from './pop3.js';
import { sendSmtp, SmtpConnection, testSmtp } from './smtp.js';
import { SupabaseRestRepository } from './supabaseRestRepository.js';
import { MailAccountInput, OutgoingMail, SmtpSettings } from './types.js';
import { describeValidationError } from './validation.js';

export interface Limiter { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface MailEnv extends FarcasterSignerEnv, SocialOAuthEnv, SearchAssistEnv, AiChatEnv, TranslateEnv, BridgesEnv, GifSearchEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  MAIL_CREDENTIALS_KEY: string;
  CONVO_APP_ORIGIN: string;
  /** Local development only: allow mail servers on this machine (e.g. Mailpit). Never set in production. */
  MAIL_ALLOW_LOCAL_SERVERS?: string;
  MAIL_CONNECT_RATE_LIMITER: Limiter;
  MAIL_SYNC_RATE_LIMITER: Limiter;
  MAIL_SEND_RATE_LIMITER: Limiter;
  PUBLIC_API_RATE_LIMITER?: Limiter;
  DICTATION_RATE_LIMITER?: Limiter;
}

const seenSchema = z.object({ messageIds: z.array(z.string().min(1).max(998).refine((value) => !/[\r\n]/.test(value))).min(1).max(100), unseen: z.boolean().optional() });
const noNewlines = z.string().min(1).max(1024).refine((value) => !/[\r\n]/.test(value), 'Credentials cannot contain line breaks.');
const schema = z.object({
  email: z.email(),
  protocol: z.enum(['imap', 'pop3']),
  host: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/i),
  port: z.number().int().min(1).max(65535),
  secure: z.literal(true),
  username: noNewlines,
  password: noNewlines,
  smtp: z.object({
    host: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/i),
    port: z.number().int().min(1).max(65535),
    security: z.enum(['tls', 'starttls']),
  }).optional(),
});
/**
 * How long a live sync waits for new mail before answering. Browsers, Cloudflare (100 s) and the
 * phones' network stacks (iOS gives up after 60 s of silence) all keep a request open this long.
 */
const mailWaitMs = 40_000;
const mailPorts = new Set([993, 143, 995, 110, 465, 587, 2525]);
const address = z.email().max(320);
const sendSchema = z.object({
  to: z.array(address).min(1).max(10),
  cc: z.array(address).max(20).optional(),
  subject: z.string().max(998).refine((value) => !/[\r\n]/.test(value), 'Subjects cannot contain line breaks.'),
  text: z.string().min(1).max(50_000),
  inReplyTo: z.string().max(998).refine((value) => !/[\r\n]/.test(value)).optional(),
});

/** Icons are images from other sites: never sniffed, and an SVG opened directly is sandboxed. */
const iconHeaders = {
  'access-control-allow-origin': '*',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
};

async function senderIconResponse(request: Request, domain: string, env: MailEnv): Promise<Response> {
  if (!isIconDomain(domain)) return new Response(null, { status: 404, headers: iconHeaders });
  const cache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL(`/v1/sender-icons/${domain}`, request.url).toString());
  const cached = await cache?.match(key);
  if (cached) return cached;
  const limiter = env.PUBLIC_API_RATE_LIMITER;
  if (limiter && !(await limiter.limit({ key: `icon:${request.headers.get('cf-connecting-ip') ?? 'local'}` })).success) return new Response(null, { status: 429, headers: iconHeaders });
  const icon = await findSenderIcon(domain);
  const response = icon
    ? new Response(new Uint8Array(icon.bytes), { headers: { ...iconHeaders, 'content-type': icon.contentType, 'cache-control': 'public, max-age=604800' } })
    : new Response(null, { status: 404, headers: { ...iconHeaders, 'cache-control': 'public, max-age=86400' } });
  await cache?.put(key, response.clone());
  return response;
}

export async function handleMailRequest(request: Request, env: MailEnv): Promise<Response> {
  // Programs and AI agents: discovery, the mixed feed, search, MCP servers and the account API.
  if (isAgentPath(new URL(request.url).pathname, request.method)) return handleAgentRequest(request, env, (inner) => handleMailRequest(inner, env));
  // Public, unauthenticated read API for posts and profiles (open CORS).
  if (isPublicApiPath(new URL(request.url).pathname)) return handlePublicApiRequest(request, env);

  const headers = corsHeaders(env.CONVO_APP_ORIGIN);
  let path = '/';
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    path = url.pathname;
    if (request.method === 'GET' && url.pathname === '/health') return json(200, { ok: true }, headers);
    // Which cross-posting networks this server can help with (no secrets, no account data).
    if (request.method === 'GET' && url.pathname === '/v1/cross-posting/status') return json(200, { farcaster: farcasterPublishingConfigured(env) }, headers);
    // Closed networks' official OAuth (ADR 0033): which are set up, and the redirect back into the app.
    if (request.method === 'GET' && url.pathname === '/v1/social/status') return json(200, socialStatus(env), headers);
    const socialCallback = request.method === 'GET' && url.pathname.match(/^\/v1\/social\/([a-z]+)\/callback$/);
    if (socialCallback && isSocialNetwork(socialCallback[1])) return new Response(null, { status: 302, headers: { location: appReturnURL(env, url.origin, url.searchParams), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    // Basic AI search over public posts; no account needed, rate limited per IP.
    if (request.method === 'POST' && url.pathname === '/v1/search/assist') {
      const limiter = env.PUBLIC_API_RATE_LIMITER;
      if (limiter && !(await limiter.limit({ key: `assist:${request.headers.get('cf-connecting-ip') ?? 'local'}` })).success) return rateLimited(headers);
      // Signed in, the person's own AI key writes the summary, and the search and its summary also
      // go into their AI chat (ADR 0028). Without a usable key the free built-in model writes it.
      const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
      const own = bearer ? await ownSearchModel(env, bearer).catch(() => undefined) : undefined;
      if (!env.AI && !own) return json(503, { error: 'AI summaries aren’t available on this server.' }, headers);
      const result = await runSearchAssist(await readJSON(request), env, own);
      const recorded = bearer ? await recordSearch(env, bearer, result).then(() => true, () => false) : false;
      return json(200, { ...result, recorded }, headers);
    }

    // Automatic translation (ADR 0022). Public text is cached by its hash; private text (messages,
    // bridged chats, email) needs the person's session and is never stored, cached or logged.
    if (url.pathname === '/v1/translate' && (request.method === 'POST' || request.method === 'GET')) {
      const input = request.method === 'GET'
        ? { texts: [url.searchParams.get('text') ?? ''], to: url.searchParams.get('to') ?? undefined, from: url.searchParams.get('from') ?? undefined }
        : await readJSON(request, 98_304);
      const privacy = request.method === 'POST' && (input as { private?: unknown } | null)?.private === true ? 'private' : 'public';
      const caller = privacy === 'private' ? `user:${(await authenticate(request, env.SUPABASE_URL)).userId}` : `ip:${request.headers.get('cf-connecting-ip') ?? 'local'}`;
      const limiter = env.PUBLIC_API_RATE_LIMITER;
      if (limiter && !(await limiter.limit({ key: `translate:${caller}` })).success) return rateLimited(headers);
      if (!env.AI) return json(503, { error: 'Translation isn’t available on this server.' }, headers);
      return json(200, await runTranslate(input, env, privacy), { ...headers, 'cache-control': privacy === 'private' ? 'no-store' : 'private, max-age=300' });
    }

    // Dictation (ADR 0031): GET says whether this server can transcribe; POST a WAV and get text
    // back. Signed in, the limit is per person; otherwise per address. Nothing is stored or logged.
    if (url.pathname === '/v1/dictate' && request.method === 'GET') return json(200, { available: Boolean(env.AI), model: env.AI ? 'whisper-large-v3-turbo' : undefined }, headers);
    if (url.pathname === '/v1/dictate' && request.method === 'POST') {
      const signedIn = /^Bearer \S+$/.test(request.headers.get('authorization') ?? '');
      const caller = signedIn ? `user:${(await authenticate(request, env.SUPABASE_URL)).userId}` : `ip:${request.headers.get('cf-connecting-ip') ?? 'local'}`;
      const limiter = env.DICTATION_RATE_LIMITER ?? env.PUBLIC_API_RATE_LIMITER;
      if (limiter && !(await limiter.limit({ key: `dictate:${caller}` })).success) return rateLimited(headers);
      if (!env.AI) return json(503, { error: 'Dictation isn’t available on this server.' }, headers);
      return json(200, await transcribe(await readDictationAudio(request), env), headers);
    }

    // GIFs for the message media picker (ADR 0029): GIPHY through this server, so its key stays a secret.
    if (request.method === 'GET' && url.pathname === '/v1/media/gifs') {
      const limiter = env.PUBLIC_API_RATE_LIMITER;
      if (limiter && !(await limiter.limit({ key: `gifs:${request.headers.get('cf-connecting-ip') ?? 'local'}` })).success) return rateLimited(headers);
      if (!env.GIPHY_API_KEY) return json(503, { error: 'GIF search isn’t set up on this server.' }, headers);
      const { query, offset, kind } = parseGifQuery(url);
      return json(200, { gifs: await searchGifs(env, query, offset, kind), attribution: 'Powered by GIPHY' }, { ...headers, 'cache-control': 'public, max-age=600' });
    }

    // Sharp company logos for email senders (public site icons, cached; no account data).
    const iconMatch = request.method === 'GET' && url.pathname.match(/^\/v1\/sender-icons\/([^/]+)$/);
    if (iconMatch) return await senderIconResponse(request, iconMatch[1].toLowerCase(), env);

    // Unknown paths are a 404 for everyone, so agents learn a URL is wrong rather than that they need a token.
    if (!/^\/v1\/(mail-accounts|bridges|cross-posting|social)(\/|$)/.test(url.pathname)) return json(404, { error: 'Not found. Start at /llms.txt or /docs.' }, headers);
    const session = await authenticate(request, env.SUPABASE_URL);
    const repository = new SupabaseRestRepository(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, session.token);

    if (request.method === 'GET' && url.pathname === '/v1/mail-accounts') {
      return json(200, { accounts: await repository.listAccounts(session.userId) }, headers);
    }

    if (request.method === 'POST' && url.pathname === '/v1/mail-accounts') {
      if (!await allowed(env.MAIL_CONNECT_RATE_LIMITER, session.userId)) return rateLimited(headers);
      const input = schema.parse(await readJSON(request)) as MailAccountInput;
      // Only the standard mail ports, so mailbox setup cannot be used to probe other services.
      if (env.MAIL_ALLOW_LOCAL_SERVERS !== 'true' && (!mailPorts.has(input.port) || (input.smtp && !mailPorts.has(input.smtp.port)))) {
        throw new UserFacingError('Use your provider’s standard mail ports: 993 or 143 for IMAP, 995 or 110 for POP, 465 or 587 for SMTP.');
      }
      await testConnection(await connectionInput(input, env));
      if (input.smtp) await testSmtp(await smtpConnection(input.smtp, env), input);
      const account = await repository.saveAccount(session.userId, input, encryptSecret(input.password, env.MAIL_CREDENTIALS_KEY));
      return json(201, { id: account.id, email: account.email, protocol: account.protocol, status: account.status, canSend: Boolean(input.smtp) }, headers);
    }

    const syncMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/mail-accounts\/([^/]+)\/sync$/);
    if (syncMatch) {
      // Per mailbox, so several mailboxes and devices following mail live don't crowd each other out.
      if (!await allowed(env.MAIL_SYNC_RATE_LIMITER, `${session.userId}:${syncMatch[1]}`)) return rateLimited(headers);
      const account = await repository.findAccount(session.userId, syncMatch[1]);
      if (!account) return json(404, { error: 'Mailbox not found.' }, headers);
      const input = await connectionInput({ ...account, password: decryptSecret(account.encryptedSecret, env.MAIL_CREDENTIALS_KEY) }, env);
      const since = parseCursor(url.searchParams.get('cursor'));
      let cursor: string | undefined;
      let readChanged = false;
      // IMAP downloads only new mail and saves batch by batch, so attachments never pile up in
      // memory. With ?wait=1 it then waits for new mail, so the app can long-poll (ADR 0025).
      const messages = account.protocol === 'imap'
        ? await syncImap(input, {
          save: (batch) => repository.saveMessages(session.userId, account.id, batch),
          known: (ids) => repository.knownSenders(account.id, ids),
          waitMs: url.searchParams.get('wait') === '1' ? mailWaitMs : undefined,
          cursor: since?.kind === 'imap' ? since.imap : undefined,
          onCursor: (imap) => { cursor = formatCursor({ kind: 'imap', imap }); },
          onSeen: async ({ seen, unseen }) => { if (await repository.setSeen(account.id, seen, unseen)) readChanged = true; },
        })
        : await syncPop3(input, undefined, {
          cursor: since?.kind === 'pop' ? since.pop : undefined,
          onCursor: (pop) => { cursor = formatCursor({ kind: 'pop', pop }); },
          known: (ids) => repository.knownSenders(account.id, ids),
        });
      if (account.protocol !== 'imap' && messages.length) await repository.saveMessages(session.userId, account.id, messages);
      // File bytes stay on the server; clients read stored mail through the database.
      const summaries = messages.map(({ attachments, ...message }) => ({ ...message, attachmentCount: attachments?.length ?? 0 }));
      return json(200, { messages: summaries, count: messages.length, mode: account.protocol === 'imap' ? 'sync' : 'import', cursor, ...(readChanged ? { readChanged } : {}) }, headers);
    }

    // Opening an email conversation reads its mail (ADR 0026): stored as read, and marked \Seen on an
    // IMAP server like any mail app. POP has no read state on the server; its mail is stored as read.
    const seenMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/mail-accounts\/([^/]+)\/seen$/);
    if (seenMatch) {
      // Reading through emails quickly marks many conversations read, so this has its own, larger
      // budget (120 a minute) instead of sharing the mail sync limit.
      if (!await allowed(env.PUBLIC_API_RATE_LIMITER ?? env.MAIL_SYNC_RATE_LIMITER, `seen:${session.userId}:${seenMatch[1]}`)) return rateLimited(headers);
      // `unseen: true` is the reverse, swiping a conversation to mark it unread: \Seen comes off.
      const { messageIds: ids, unseen } = seenSchema.parse(await readJSON(request));
      const account = await repository.findAccount(session.userId, seenMatch[1]);
      if (!account) return json(404, { error: 'Mailbox not found.' }, headers);
      const changed = unseen ? await repository.setSeen(account.id, [], ids) : await repository.setSeen(account.id, ids);
      let server = false;
      if (account.protocol === 'imap') {
        const input = await connectionInput({ ...account, password: decryptSecret(account.encryptedSecret, env.MAIL_CREDENTIALS_KEY) }, env);
        server = await markSeenImap(input, ids, !unseen).then(() => true, () => false);
      }
      return json(200, { changed, server }, headers);
    }

    const sendMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/mail-accounts\/([^/]+)\/send$/);
    if (sendMatch) {
      if (!await allowed(env.MAIL_SEND_RATE_LIMITER, session.userId)) return rateLimited(headers);
      const mail = sendSchema.parse(await readJSON(request)) as OutgoingMail;
      const account = await repository.findAccount(session.userId, sendMatch[1]);
      if (!account) return json(404, { error: 'Mailbox not found.' }, headers);
      if (!account.smtp) return json(409, { error: 'Add outgoing mail (SMTP) settings to this mailbox before sending.' }, headers);
      const sent = await sendSmtp(await smtpConnection(account.smtp, env), { ...account, password: decryptSecret(account.encryptedSecret, env.MAIL_CREDENTIALS_KEY) }, mail);
      await repository.saveMessages(session.userId, account.id, [sent]);
      return json(201, { message: sent }, headers);
    }

    // Cross-posting: sign a Farcaster key request for a key generated on the person's device.
    if (request.method === 'POST' && url.pathname === '/v1/cross-posting/farcaster/signed-key-request') {
      if (!await allowed(env.MAIL_CONNECT_RATE_LIMITER, session.userId)) return rateLimited(headers);
      const { key } = (await readJSON(request)) as { key?: unknown };
      return json(201, await createSignedKeyRequest(parseEd25519PublicKey(key), env), headers);
    }

    if (request.method === 'POST' && url.pathname === '/v1/cross-posting/farcaster/messages') {
      if (!await allowed(env.MAIL_SEND_RATE_LIMITER, session.userId)) return rateLimited(headers);
      return json(201, await forwardSignedMessage(await request.arrayBuffer()), headers);
    }

    // Closed networks (ADR 0033). The person's token lives on their device and is sent with each
    // post; nothing here is stored or logged.
    const social = request.method === 'POST' && url.pathname.match(/^\/v1\/social\/([a-z]+)\/(authorize|token|publish)$/);
    if (social && isSocialNetwork(social[1])) {
      const network = social[1];
      const body = (await readJSON(request)) as Record<string, unknown> | null;
      if (social[2] === 'authorize') {
        if (!await allowed(env.MAIL_CONNECT_RATE_LIMITER, session.userId)) return rateLimited(headers);
        return json(200, { url: authorizeURL(network, env, url.origin, { state: String(body?.state ?? ''), challenge: typeof body?.challenge === 'string' ? body.challenge : undefined }) }, headers);
      }
      if (social[2] === 'token') {
        if (!await allowed(env.MAIL_CONNECT_RATE_LIMITER, session.userId)) return rateLimited(headers);
        const code = typeof body?.code === 'string' && body.code.length <= 2048 ? body.code : '';
        if (!code) return json(400, { error: 'That sign-in didn’t finish. Try again.' }, headers);
        return json(201, await exchangeCode(network, env, url.origin, { code, verifier: typeof body?.verifier === 'string' ? body.verifier : undefined }), headers);
      }
      if (!await allowed(env.MAIL_SEND_RATE_LIMITER, session.userId)) return rateLimited(headers);
      let current = parseSession(body?.session);
      if (current.expiresAt && current.expiresAt < Date.now() + 60_000) current = await refreshSession(network, env, current);
      const published = await publishSocial(network, current, parsePost(body?.post));
      return json(201, { ...published, session: current }, headers);
    }

    // Bridged chats (ADR 0011): every call acts only as this person's own Matrix user.
    if (url.pathname.startsWith('/v1/bridges')) {
      const bridges = new Bridges(env, session.userId);
      if (request.method === 'GET' && url.pathname === '/v1/bridges') return json(200, await bridges.status(), headers);
      if (request.method === 'GET' && url.pathname === '/v1/bridges/conversations') {
        // Read receipts are reciprocal (ADR 0026): someone who doesn't send them doesn't see others'.
        const [snapshot, share] = await Promise.all([bridges.conversations(), repository.shareReadReceipts()]);
        return json(200, share ? snapshot : withoutReadTimes(snapshot), headers);
      }
      const readMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/bridges\/rooms\/([^/]+)\/read$/);
      if (readMatch) {
        if (!await allowed(env.MAIL_SYNC_RATE_LIMITER, `${session.userId}:bridge-read`)) return rateLimited(headers);
        const { eventId } = (await readJSON(request)) as { eventId?: unknown };
        await bridges.markRead(decodeURIComponent(readMatch[1]), eventId, await repository.shareReadReceipts());
        return json(200, { read: true }, headers);
      }
      const unreadMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/bridges\/rooms\/([^/]+)\/unread$/);
      if (unreadMatch) {
        if (!await allowed(env.MAIL_SYNC_RATE_LIMITER, `${session.userId}:bridge-read`)) return rateLimited(headers);
        await bridges.markUnread(decodeURIComponent(unreadMatch[1]));
        return json(200, { unread: true }, headers);
      }
      const roomMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/bridges\/rooms\/([^/]+)\/messages$/);
      if (roomMatch) {
        if (!await allowed(env.MAIL_SEND_RATE_LIMITER, session.userId)) return rateLimited(headers);
        const { body } = (await readJSON(request)) as { body?: unknown };
        await bridges.send(decodeURIComponent(roomMatch[1]), body);
        return json(201, { sent: true }, headers);
      }
      const flowsMatch = request.method === 'GET' && url.pathname.match(/^\/v1\/bridges\/([a-z]+)\/flows$/);
      if (flowsMatch) return json(200, { flows: await bridges.flows(flowsMatch[1]) }, headers);
      const loginMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/bridges\/([a-z]+)\/(login\/start|login\/step|login\/cancel|logout)$/);
      if (loginMatch) {
        const [, network, action] = loginMatch;
        const input = (await readJSON(request)) as Record<string, unknown>;
        if (action === 'login/start') {
          if (!await allowed(env.MAIL_CONNECT_RATE_LIMITER, session.userId)) return rateLimited(headers);
          return json(200, await bridges.startLogin(network, input.flow), headers);
        }
        if (action === 'login/step') return json(200, await bridges.continueLogin(network, input), headers);
        if (action === 'login/cancel') { await bridges.cancelLogin(network, input.loginId); return json(200, {}, headers); }
        await bridges.logout(network, input.loginId);
        return json(200, {}, headers);
      }
      return json(404, { error: 'Not found.' }, headers);
    }

    const deleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/v1\/mail-accounts\/([^/]+)$/);
    if (deleteMatch) {
      const deleted = await repository.deleteAccount(session.userId, deleteMatch[1]);
      return deleted ? json(200, { deleted: true }, headers) : json(404, { error: 'Mailbox not found.' }, headers);
    }

    return json(404, { error: 'Not found.' }, headers);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? describeValidationError(error)
      : error instanceof UserFacingError ? error.message
      : error instanceof Error ? error.message.replace(/password[^ ]*/gi, 'credential') : 'Request failed.';
    const status = message.includes('session') ? 401 : 400;
    console.error(JSON.stringify({ event: 'mail_request_failed', method: request.method, path, status, errorType: error instanceof Error ? error.name : 'UnknownError' }));
    return json(status, { error: message }, headers);
  }
}

async function allowed(limiter: Limiter, userId: string): Promise<boolean> {
  return (await limiter.limit({ key: userId })).success;
}

function rateLimited(headers: HeadersInit): Response {
  return json(429, { error: 'Too many requests. Wait a minute and try again.' }, { ...headers, 'retry-after': '60' });
}

async function testConnection(input: MailAccountInput) {
  return input.protocol === 'imap' ? testImap(input) : testPop3(input);
}

async function connectionInput(input: MailAccountInput, env: MailEnv): Promise<MailAccountInput> {
  const { address, local } = await resolveMailHost(input.host, env.MAIL_ALLOW_LOCAL_SERVERS === 'true');
  return { ...input, host: address, tlsServername: input.host, allowPlaintext: local };
}

async function smtpConnection(settings: SmtpSettings, env: MailEnv): Promise<SmtpConnection> {
  const { address, local } = await resolveMailHost(settings.host, env.MAIL_ALLOW_LOCAL_SERVERS === 'true');
  return { ...settings, address, allowPlaintext: local };
}

async function readJSON(request: Request, maxBytes = 16_384): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) throw new Error('Request too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Request too large.');
  return JSON.parse(text);
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'cache-control': 'no-store',
  };
}

function json(status: number, body: unknown, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

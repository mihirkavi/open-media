/**
 * Mail sync and the public read API, independent of the hosting runtime. The
 * Cloudflare Worker (worker.ts) and the local Node.js server (localServer.ts)
 * both call handleMailRequest.
 */
import { z } from 'zod';

import { Bridges, BridgesEnv } from './bridges.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { createSignedKeyRequest, FarcasterSignerEnv, farcasterPublishingConfigured, forwardSignedMessage, parseEd25519PublicKey } from './farcasterSigner.js';
import { UserFacingError } from './errors.js';
import { syncImap, testImap } from './imap.js';
import { resolveMailHost } from './networkSafety.js';
import { handleAgentRequest, isAgentPath } from './agentApi.js';
import { handlePublicApiRequest, isPublicApiPath } from './publicApi.js';
import { authenticate } from './session.js';
import { runSearchAssist, SearchAssistEnv } from './searchAssist.js';
import { syncPop3, testPop3 } from './pop3.js';
import { sendSmtp, SmtpConnection, testSmtp } from './smtp.js';
import { SupabaseRestRepository } from './supabaseRestRepository.js';
import { MailAccountInput, OutgoingMail, SmtpSettings } from './types.js';
import { describeValidationError } from './validation.js';

export interface Limiter { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface MailEnv extends FarcasterSignerEnv, SearchAssistEnv, BridgesEnv {
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
}

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
const address = z.email().max(320);
const sendSchema = z.object({
  to: z.array(address).min(1).max(10),
  subject: z.string().max(998).refine((value) => !/[\r\n]/.test(value), 'Subjects cannot contain line breaks.'),
  text: z.string().min(1).max(50_000),
  inReplyTo: z.string().max(998).refine((value) => !/[\r\n]/.test(value)).optional(),
});

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
    // Basic AI search over public posts; no account needed, rate limited per IP.
    if (request.method === 'POST' && url.pathname === '/v1/search/assist') {
      const limiter = env.PUBLIC_API_RATE_LIMITER;
      if (limiter && !(await limiter.limit({ key: `assist:${request.headers.get('cf-connecting-ip') ?? 'local'}` })).success) return rateLimited(headers);
      if (!env.AI) return json(503, { error: 'AI summaries aren’t available on this server.' }, headers);
      return json(200, await runSearchAssist(await readJSON(request), env), headers);
    }

    const session = await authenticate(request, env.SUPABASE_URL);
    const repository = new SupabaseRestRepository(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, session.token);

    if (request.method === 'GET' && url.pathname === '/v1/mail-accounts') {
      return json(200, { accounts: await repository.listAccounts(session.userId) }, headers);
    }

    if (request.method === 'POST' && url.pathname === '/v1/mail-accounts') {
      if (!await allowed(env.MAIL_CONNECT_RATE_LIMITER, session.userId)) return rateLimited(headers);
      const input = schema.parse(await readJSON(request)) as MailAccountInput;
      await testConnection(await connectionInput(input, env));
      if (input.smtp) await testSmtp(await smtpConnection(input.smtp, env), input);
      const account = await repository.saveAccount(session.userId, input, encryptSecret(input.password, env.MAIL_CREDENTIALS_KEY));
      return json(201, { id: account.id, email: account.email, protocol: account.protocol, status: account.status, canSend: Boolean(input.smtp) }, headers);
    }

    const syncMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/mail-accounts\/([^/]+)\/sync$/);
    if (syncMatch) {
      if (!await allowed(env.MAIL_SYNC_RATE_LIMITER, session.userId)) return rateLimited(headers);
      const account = await repository.findAccount(session.userId, syncMatch[1]);
      if (!account) return json(404, { error: 'Mailbox not found.' }, headers);
      const input = await connectionInput({ ...account, password: decryptSecret(account.encryptedSecret, env.MAIL_CREDENTIALS_KEY) }, env);
      const messages = account.protocol === 'imap' ? await syncImap(input) : await syncPop3(input);
      await repository.saveMessages(session.userId, account.id, messages);
      // File bytes stay on the server; clients read stored mail through the database.
  const summaries = messages.map(({ attachments, ...message }) => ({ ...message, attachmentCount: attachments?.length ?? 0 }));
  return json(200, { messages: summaries, count: messages.length, mode: account.protocol === 'imap' ? 'sync' : 'import' }, headers);
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

    // Bridged chats (ADR 0011): every call acts only as this person's own Matrix user.
    if (url.pathname.startsWith('/v1/bridges')) {
      const bridges = new Bridges(env, session.userId);
      if (request.method === 'GET' && url.pathname === '/v1/bridges') return json(200, await bridges.status(), headers);
      if (request.method === 'GET' && url.pathname === '/v1/bridges/conversations') return json(200, await bridges.conversations(), headers);
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

async function readJSON(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error('Request too large.');
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

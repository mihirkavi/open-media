import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

import { decryptSecret, encryptSecret } from './crypto.js';
import { syncImap, testImap } from './imap.js';
import { resolvePublicMailHost } from './networkSafety.js';
import { syncPop3, testPop3 } from './pop3.js';
import { SupabaseRestRepository } from './supabaseRestRepository.js';
import { MailAccountInput } from './types.js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  MAIL_CREDENTIALS_KEY: string;
  CONVO_APP_ORIGIN: string;
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
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(env.CONVO_APP_ORIGIN);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json(200, { ok: true }, headers);

      const session = await authenticate(request, env.SUPABASE_URL);
      const repository = new SupabaseRestRepository(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, session.token);

      if (request.method === 'POST' && url.pathname === '/v1/mail-accounts') {
        const input = schema.parse(await readJSON(request)) as MailAccountInput;
        await testConnection(await connectionInput(input));
        const account = await repository.saveAccount(session.userId, input, encryptSecret(input.password, env.MAIL_CREDENTIALS_KEY));
        return json(201, { id: account.id, email: account.email, protocol: account.protocol, status: account.status }, headers);
      }

      const syncMatch = request.method === 'POST' && url.pathname.match(/^\/v1\/mail-accounts\/([^/]+)\/sync$/);
      if (syncMatch) {
        const account = await repository.findAccount(session.userId, syncMatch[1]);
        if (!account) return json(404, { error: 'Mailbox not found.' }, headers);
        const input = await connectionInput({ ...account, password: decryptSecret(account.encryptedSecret, env.MAIL_CREDENTIALS_KEY) });
        const messages = account.protocol === 'imap' ? await syncImap(input) : await syncPop3(input);
        await repository.saveMessages(session.userId, account.id, messages);
        return json(200, { messages, count: messages.length, mode: account.protocol === 'imap' ? 'sync' : 'import' }, headers);
      }

      return json(404, { error: 'Not found.' }, headers);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/password[^ ]*/gi, 'credential') : 'Request failed.';
      return json(message.includes('session') ? 401 : 400, { error: message }, headers);
    }
  },
};

async function authenticate(request: Request, supabaseURL: string): Promise<{ token: string; userId: string }> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('A valid Open Media session is required.');
  const token = authorization.slice(7);
  const jwks = createRemoteJWKSet(new URL(`${supabaseURL}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseURL}/auth/v1` });
  if (!payload.sub) throw new Error('A valid Open Media session is required.');
  return { token, userId: payload.sub };
}

async function testConnection(input: MailAccountInput) {
  return input.protocol === 'imap' ? testImap(input) : testPop3(input);
}

async function connectionInput(input: MailAccountInput): Promise<MailAccountInput> {
  return { ...input, host: await resolvePublicMailHost(input.host), tlsServername: input.host };
}

async function readJSON(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error('Request too large.');
  return JSON.parse(text);
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'cache-control': 'no-store',
  };
}

function json(status: number, body: unknown, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

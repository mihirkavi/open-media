import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

import { authenticate } from './auth.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { syncImap, testImap } from './imap.js';
import { syncPop3, testPop3 } from './pop3.js';
import { createRepository } from './repository.js';
import { resolvePublicMailHost } from './networkSafety.js';
import { MailAccountInput } from './types.js';

const noNewlines = z.string().min(1).max(1024).refine((value) => !/[\r\n]/.test(value), 'Credentials cannot contain line breaks.');
const schema = z.object({ email: z.email(), protocol: z.enum(['imap','pop3']), host: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/i), port: z.number().int().min(1).max(65535), secure: z.literal(true), username: noNewlines, password: noNewlines });
const repository = createRepository(process.env.DATABASE_URL);
const key = process.env.MAIL_CREDENTIALS_KEY || (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production' ? randomBytes(32).toString('base64') : '');
if (!key) throw new Error('MAIL_CREDENTIALS_KEY is required in production.');

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') { response.writeHead(204, corsHeaders()); return response.end(); }
    if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true });
    if (request.method === 'POST' && request.url === '/v1/mail-accounts') {
      const userId = await authenticate(request);
      const input = schema.parse(await readJSON(request)) as MailAccountInput;
      await testConnection(await connectionInput(input));
      const account = await repository.saveAccount(userId, input, encryptSecret(input.password, key));
      return json(response, 201, { id: account.id, email: account.email, protocol: account.protocol, status: account.status });
    }
    const syncMatch = request.method === 'POST' && request.url?.match(/^\/v1\/mail-accounts\/([^/]+)\/sync$/);
    if (syncMatch) {
      const userId = await authenticate(request); const account = await repository.findAccount(userId, syncMatch[1]);
      if (!account) return json(response, 404, { error: 'Mailbox not found.' });
      const input = await connectionInput({ ...account, password: decryptSecret(account.encryptedSecret, key) });
      const messages = account.protocol === 'imap' ? await syncImap(input) : await syncPop3(input);
      await repository.saveMessages(userId, account.id, messages);
      return json(response, 200, { messages, count: messages.length, mode: account.protocol === 'imap' ? 'sync' : 'import' });
    }
    return json(response, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/password[^ ]*/gi, 'credential') : 'Request failed.';
    return json(response, message.includes('session') ? 401 : 400, { error: message });
  }
});

async function testConnection(input: MailAccountInput) { return input.protocol === 'imap' ? testImap(input) : testPop3(input); }
async function connectionInput(input: MailAccountInput): Promise<MailAccountInput> { return { ...input, host: await resolvePublicMailHost(input.host), tlsServername: input.host }; }
async function readJSON(request: IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 16_384) { request.destroy(); throw new Error('Request too large.'); } chunks.push(buffer); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function corsHeaders() { return { 'access-control-allow-origin': process.env.CONVO_APP_ORIGIN ?? 'http://localhost:3200', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-convo-local-user', 'cache-control': 'no-store' }; }
function json(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'content-type': 'application/json', ...corsHeaders() }); response.end(JSON.stringify(body)); }

const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
server.listen(Number(process.env.PORT ?? 8787), host, () => { console.log(`Open Media mail sync listening on ${host}:${process.env.PORT ?? 8787}`); });

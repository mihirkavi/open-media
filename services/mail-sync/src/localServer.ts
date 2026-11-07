// Local development server: runs mail sync and the public API on Node.js.
// Production runs the same handler in the Cloudflare Worker (src/worker.ts).
// The IMAP library stalls on some servers (e.g. Gmail) inside the Workers
// runtime, so local development uses Node.js. Settings come from .dev.vars,
// which `npm run local` writes.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { handleMailRequest, Limiter, MailEnv } from './mailHandler.js';
import { createSignInHandoff, latestSignInCode } from './localSignIn.js';
import { AiBinding } from './searchAssist.js';
import { PaymentsEnv } from './payments.js';
import { VerificationEnv } from './verification.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
if (process.env.NODE_ENV === 'production') throw new Error('The local mail server is for development only. Deploy src/worker.ts instead.');

/** Fixed-window limiter matching the Worker's rate-limit bindings. */
function limiter(limit: number, periodSeconds = 60): Limiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async limit({ key }) {
      const now = Date.now();
      const current = windows.get(key);
      if (!current || now - current.start >= periodSeconds * 1000) {
        windows.set(key, { start: now, count: 1 });
        return { success: true };
      }
      current.count += 1;
      return { success: current.count <= limit };
    },
  };
}

const env: MailEnv & PaymentsEnv & VerificationEnv & { PROFILE_IMPORT_ALLOW_LOCAL?: string } = {
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_PUBLISHABLE_KEY: required('SUPABASE_PUBLISHABLE_KEY'),
  MAIL_CREDENTIALS_KEY: required('MAIL_CREDENTIALS_KEY'),
  CONVO_APP_ORIGIN: process.env.CONVO_APP_ORIGIN ?? 'http://localhost:8081',
  MAIL_ALLOW_LOCAL_SERVERS: process.env.MAIL_ALLOW_LOCAL_SERVERS,
  PROFILE_IMPORT_ALLOW_LOCAL: process.env.PROFILE_IMPORT_ALLOW_LOCAL,
  FARCASTER_APP_FID: process.env.FARCASTER_APP_FID,
  FARCASTER_APP_MNEMONIC: process.env.FARCASTER_APP_MNEMONIC,
  BRIDGES_HOMESERVER_URL: process.env.BRIDGES_HOMESERVER_URL,
  BRIDGES_SERVER_NAME: process.env.BRIDGES_SERVER_NAME,
  BRIDGES_AS_TOKEN: process.env.BRIDGES_AS_TOKEN,
  BRIDGES_PROVISIONING_SECRET: process.env.BRIDGES_PROVISIONING_SECRET,
  BRIDGES_WHATSAPP_URL: process.env.BRIDGES_WHATSAPP_URL,
  BRIDGES_TELEGRAM_URL: process.env.BRIDGES_TELEGRAM_URL,
  BRIDGES_SIGNAL_URL: process.env.BRIDGES_SIGNAL_URL,
  BRIDGES_GMESSAGES_URL: process.env.BRIDGES_GMESSAGES_URL,
  BRIDGES_INSTAGRAM_URL: process.env.BRIDGES_INSTAGRAM_URL,
  BRIDGES_MESSENGER_URL: process.env.BRIDGES_MESSENGER_URL,
  BRIDGES_LINKEDIN_URL: process.env.BRIDGES_LINKEDIN_URL,
  BRIDGES_TWITTER_URL: process.env.BRIDGES_TWITTER_URL,
  BRIDGES_BLUESKY_URL: process.env.BRIDGES_BLUESKY_URL,
  BRIDGES_SLACK_URL: process.env.BRIDGES_SLACK_URL,
  BRIDGES_DISCORD_URL: process.env.BRIDGES_DISCORD_URL,
  BRIDGES_GVOICE_URL: process.env.BRIDGES_GVOICE_URL,
  // Server-only steps (payments, verification). Stripe stays off unless test keys are added.
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_IDENTITY_WEBHOOK_SECRET: process.env.STRIPE_IDENTITY_WEBHOOK_SECRET,
  STRIPE_PAYMENTS_WEBHOOK_SECRET: process.env.STRIPE_PAYMENTS_WEBHOOK_SECRET,
  STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  PAYMENTS_RETURN_URL: process.env.PAYMENTS_RETURN_URL ?? process.env.CONVO_APP_ORIGIN ?? 'http://localhost:8081',
  BASE_SEPOLIA_RPC_URL: process.env.BASE_SEPOLIA_RPC_URL,
  // Optional: GIF search in the message media picker (ADR 0029).
  GIPHY_API_KEY: process.env.GIPHY_API_KEY,
  MAIL_CONNECT_RATE_LIMITER: limiter(5),
  MAIL_SYNC_RATE_LIMITER: limiter(12),
  MAIL_SEND_RATE_LIMITER: limiter(10),
  PUBLIC_API_RATE_LIMITER: limiter(120),
  DICTATION_RATE_LIMITER: limiter(20),
};

// Optional: translation and AI search through the owner's Workers AI, borrowed from Wrangler
// (OPEN_MEDIA_LOCAL_AI=true npm run local). It bills that Cloudflare account; off by default.
if (process.env.OPEN_MEDIA_LOCAL_AI === 'true') {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ AI: AiBinding }>({ configPath: fileURLToPath(new URL('../wrangler.local-ai.jsonc', import.meta.url)) });
  env.AI = proxy.env.AI;
  console.log('Workers AI: on (translation and AI search use your Cloudflare account)');
}

const inboxURL = process.env.LOCAL_INBOX_URL;
const appOrigin = process.env.CONVO_APP_ORIGIN ?? 'http://localhost:8081';
const signInHandoff = createSignInHandoff();

createServer(async (incoming, outgoing) => {
  try {
    const requestURL = new URL(incoming.url ?? '/', 'http://local');
    // Local-only: a sign-in link opened in another browser hands its code to the app window.
    // Only the app's own origin may use it (any browser on this Mac opening the app sends it).
    if (inboxURL && requestURL.pathname === '/local/sign-in-handoff') {
      const headers = { 'access-control-allow-origin': appOrigin, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store', 'content-type': 'application/json' };
      if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, headers); return outgoing.end(); }
      if (incoming.headers.origin !== appOrigin) { outgoing.writeHead(403, headers); return outgoing.end(JSON.stringify({ error: 'Forbidden.' })); }
      if (incoming.method === 'POST') {
        let body = '';
        for await (const chunk of incoming) { body += chunk; if (body.length > 2000) break; }
        let code = '';
        try { code = String((JSON.parse(body) as { code?: unknown }).code ?? ''); } catch { /* bad JSON */ }
        const accepted = signInHandoff.put(code);
        outgoing.writeHead(accepted ? 204 : 400, headers);
        return outgoing.end(accepted ? undefined : JSON.stringify({ error: 'Bad request.' }));
      }
      const code = signInHandoff.take();
      // 204 while there's nothing yet: the app polls, and browsers log every 404 to the console.
      outgoing.writeHead(code ? 200 : 204, headers);
      return outgoing.end(code ? JSON.stringify({ code }) : undefined);
    }
    // Local-only: hand the app the sign-in code from the local test inbox.
    if (inboxURL && requestURL.pathname === '/local/sign-in-code') {
      const headers = { 'access-control-allow-origin': appOrigin, 'cache-control': 'no-store', 'content-type': 'application/json' };
      if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, headers); return outgoing.end(); }
      const email = (requestURL.searchParams.get('email') ?? '').trim().toLowerCase();
      const since = new Date(requestURL.searchParams.get('since') ?? 0);
      // The web app sends its Origin; the iOS/Android app (simulator/emulator on this Mac) sends
      // none. Browsers always attach an Origin to cross-site requests, so other websites can't read
      // codes, and requests without one are accepted only from this computer.
      const remote = incoming.socket.remoteAddress ?? '';
      const fromThisComputer = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      const allowedCaller = incoming.headers.origin === appOrigin || (incoming.headers.origin === undefined && fromThisComputer);
      if (!allowedCaller || !/^[^\s@"]+@[^\s@"]+$/.test(email) || Number.isNaN(since.getTime())) {
        outgoing.writeHead(400, headers);
        return outgoing.end(JSON.stringify({ error: 'Bad request.' }));
      }
      const code = await latestSignInCode(inboxURL, email, since);
      outgoing.writeHead(code ? 200 : 204, headers);
      return outgoing.end(code ? JSON.stringify({ code }) : undefined);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length && incoming.method !== 'GET' && incoming.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(', '));
    }
    headers.set('cf-connecting-ip', incoming.socket.remoteAddress ?? 'local');
    const request = new Request(`http://${incoming.headers.host ?? `${host}:${port}`}${incoming.url ?? '/'}`, { method: incoming.method, headers, body });
    const response = await handleMailRequest(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'Unexpected error.' }));
  }
}).listen(port, host, () => {
  console.log(`Open Media mail service (local) listening on http://${host}:${port}`);
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (run \`npm run local\` once to write .dev.vars).`);
  return value;
}

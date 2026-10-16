// Local development server: runs mail sync and the public API on Node.js.
// Production runs the same handler in the Cloudflare Worker (src/worker.ts).
// The IMAP library stalls on some servers (e.g. Gmail) inside the Workers
// runtime, so local development uses Node.js. Settings come from .dev.vars,
// which `npm run local` writes.
import { createServer } from 'node:http';

import { handleMailRequest, Limiter, MailEnv } from './mailHandler.js';

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

const env: MailEnv = {
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_PUBLISHABLE_KEY: required('SUPABASE_PUBLISHABLE_KEY'),
  MAIL_CREDENTIALS_KEY: required('MAIL_CREDENTIALS_KEY'),
  CONVO_APP_ORIGIN: process.env.CONVO_APP_ORIGIN ?? 'http://localhost:8081',
  MAIL_ALLOW_LOCAL_SERVERS: process.env.MAIL_ALLOW_LOCAL_SERVERS,
  MAIL_CONNECT_RATE_LIMITER: limiter(5),
  MAIL_SYNC_RATE_LIMITER: limiter(12),
  MAIL_SEND_RATE_LIMITER: limiter(10),
  PUBLIC_API_RATE_LIMITER: limiter(120),
};

createServer(async (incoming, outgoing) => {
  try {
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

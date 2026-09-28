// Local development server for the public API. Production runs src/worker.ts on Cloudflare.
import { createServer } from 'node:http';

import { handlePublicApiRequest } from './api.js';

const port = Number(process.env.PUBLIC_API_PORT ?? 8790);
const host = process.env.PUBLIC_API_HOST ?? '127.0.0.1';
const env = {
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_PUBLISHABLE_KEY: required('SUPABASE_PUBLISHABLE_KEY'),
};

createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://${incoming.headers.host ?? `${host}:${port}`}${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
    });
    const response = await handlePublicApiRequest(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: { code: 'internal', message: 'Unexpected error.' } }));
  }
}).listen(port, host, () => {
  console.log(`Open Media public API listening on http://${host}:${port}`);
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting the public API.`);
  return value;
}

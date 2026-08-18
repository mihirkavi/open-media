import { createServer, IncomingMessage, ServerResponse } from 'node:http';

interface MatrixAuth { accessToken: string; userId: string; }
interface MatrixEvent { event_id?: string; sender?: string; origin_server_ts?: number; type?: string; state_key?: string; content?: Record<string, unknown>; }
interface JoinedRoom { state?: { events?: MatrixEvent[] }; timeline?: { events?: MatrixEvent[] }; }
interface SyncResponse { next_batch?: string; rooms?: { join?: Record<string, JoinedRoom> }; }

const port = Number(process.env.MATRIX_BRIDGE_PORT ?? 8789);
const homeserver = required('MATRIX_HOMESERVER').replace(/\/$/, '');
const username = required('MATRIX_USERNAME');
const password = required('MATRIX_PASSWORD');
const allowedOrigin = process.env.OPEN_MEDIA_APP_ORIGIN ?? 'http://localhost:8082';
const host = process.env.MATRIX_BRIDGE_HOST ?? '127.0.0.1';
if (process.env.NODE_ENV === 'production') throw new Error('The single-account Matrix bridge is a development sandbox and must not run in production.');
let authPromise: Promise<MatrixAuth> | undefined;
let nextBatch: string | undefined;
const roomCache = new Map<string, { state: MatrixEvent[]; timeline: MatrixEvent[] }>();

createServer(async (request, response) => {
  try {
    if (!originAllowed(request)) return reply(response, 403, { error: 'Origin is not allowed.' });
    if (request.method === 'OPTIONS') return reply(response, 204, undefined);
    if (request.method === 'GET' && request.url === '/health') return reply(response, 200, { ok: true, protocol: 'matrix', mode: 'development-sandbox' });
    if (request.method === 'GET' && request.url === '/v1/matrix/snapshot') {
      return reply(response, 200, await snapshot());
    }
    const messageMatch = request.url?.match(/^\/v1\/matrix\/rooms\/([^/]+)\/messages$/);
    if (request.method === 'POST' && messageMatch) {
      const input = await readJSON(request) as { body?: unknown };
      const body = typeof input.body === 'string' ? input.body.trim() : '';
      if (!body || body.length > 8000) return reply(response, 400, { error: 'Enter a message up to 8,000 characters.' });
      const auth = await matrixAuth();
      const roomId = decodeURIComponent(messageMatch[1]);
      const transactionId = `openmedia_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await matrixRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${transactionId}`, {
        method: 'PUT',
        body: JSON.stringify({ msgtype: 'm.text', body }),
      }, auth.accessToken);
      return reply(response, 201, { ok: true });
    }
    return reply(response, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Matrix bridge failed.';
    return reply(response, 502, { error: message });
  }
}).listen(port, host, () => console.log(`Open Media Matrix sandbox listening on http://${host}:${port}`));

async function matrixAuth(): Promise<MatrixAuth> {
  if (!authPromise) authPromise = (async () => {
    const response = await matrixRequest('/_matrix/client/v3/login', {
      method: 'POST',
      body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user: username }, password }),
    }) as { access_token?: string; user_id?: string };
    if (!response.access_token || !response.user_id) throw new Error('Matrix login did not return a usable session.');
    return { accessToken: response.access_token, userId: response.user_id };
  })().catch((error) => { authPromise = undefined; throw error; });
  return authPromise;
}

async function snapshot() {
  const auth = await matrixAuth();
  const syncPath = nextBatch
    ? `/_matrix/client/v3/sync?timeout=0&since=${encodeURIComponent(nextBatch)}`
    : '/_matrix/client/v3/sync?timeout=0&full_state=true';
  const sync = await matrixRequest(syncPath, {}, auth.accessToken) as SyncResponse;
  if (sync.next_batch) nextBatch = sync.next_batch;
  for (const [roomId, room] of Object.entries(sync.rooms?.join ?? {})) {
    const cached = roomCache.get(roomId) ?? { state: [], timeline: [] };
    cached.state = mergeState(cached.state, room.state?.events ?? []);
    cached.timeline = mergeTimeline(cached.timeline, room.timeline?.events ?? []);
    roomCache.set(roomId, cached);
  }
  const rooms = [...roomCache.entries()].map(([roomId, room]) => {
    const allEvents = [...room.state, ...room.timeline];
    const nameEvent = [...allEvents].reverse().find((event) => event.type === 'm.room.name');
    const name = typeof nameEvent?.content?.name === 'string' ? nameEvent.content.name : roomId;
    const members = allEvents.filter((event) => event.type === 'm.room.member' && event.content?.membership === 'join' && event.state_key).map((event) => ({
      id: event.state_key as string,
      displayName: typeof event.content?.displayname === 'string' ? event.content.displayname : event.state_key as string,
    })).filter((member, index, list) => list.findIndex((candidate) => candidate.id === member.id) === index);
    const events = allEvents.filter((event) => event.type === 'm.room.message' && event.event_id && event.sender && event.content?.msgtype === 'm.text' && typeof event.content.body === 'string').map((event) => ({
      id: event.event_id as string,
      sender: event.sender as string,
      body: event.content?.body as string,
      timestamp: event.origin_server_ts ?? 0,
    })).filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index);
    return { id: roomId, name, members, events };
  });
  return { userId: auth.userId, rooms };
}

function mergeState(existing: MatrixEvent[], incoming: MatrixEvent[]): MatrixEvent[] {
  const merged = new Map(existing.map((event) => [`${event.type}|${event.state_key ?? ''}`, event]));
  for (const event of incoming) merged.set(`${event.type}|${event.state_key ?? ''}`, event);
  return [...merged.values()];
}

function mergeTimeline(existing: MatrixEvent[], incoming: MatrixEvent[]): MatrixEvent[] {
  const merged = [...existing];
  for (const event of incoming) {
    if (!event.event_id || !merged.some((candidate) => candidate.event_id === event.event_id)) merged.push(event);
  }
  return merged.slice(-200);
}

async function matrixRequest(path: string, init: RequestInit = {}, accessToken?: string): Promise<unknown> {
  const response = await fetch(`${homeserver}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...init.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `Matrix returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function readJSON(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) {
      request.destroy();
      throw new Error('Request is too large.');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return !origin || origin === allowedOrigin;
}

function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

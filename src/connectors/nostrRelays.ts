import { NostrEvent } from '../domain/openNetworkPosts';

/**
 * A minimal Nostr relay client (NIP-01) over the WebSocket built into browsers and React Native.
 * Open Media reads from and publishes to a few large public relays; relays share nothing with each
 * other, so results from all of them are merged and de-duplicated.
 */
export const defaultNostrRelays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];

export type NostrFilter = { ids?: string[]; authors?: string[]; kinds?: number[]; since?: number; until?: number; limit?: number; search?: string } & { [tag: `#${string}`]: string[] };

const queryTimeoutMs = 6000;

/** Events matching `filter` from one relay, until it reports end-of-stored-events or times out. */
function queryRelay(url: string, filter: NostrFilter, timeoutMs: number): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let socket: WebSocket;
    const subscription = `om${Math.random().toString(36).slice(2, 10)}`;
    const finish = () => { clearTimeout(timer); try { socket.send(JSON.stringify(['CLOSE', subscription])); socket.close(); } catch { /* already closed */ } resolve(events); };
    const timer = setTimeout(finish, timeoutMs);
    try { socket = new WebSocket(url); } catch { clearTimeout(timer); resolve(events); return; }
    socket.onopen = () => socket.send(JSON.stringify(['REQ', subscription, filter]));
    socket.onerror = () => finish();
    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data)) as unknown[];
        if (data[0] === 'EVENT' && data[1] === subscription && data[2] && typeof data[2] === 'object') events.push(data[2] as NostrEvent);
        else if ((data[0] === 'EOSE' || data[0] === 'CLOSED') && data[1] === subscription) finish();
      } catch { /* ignore malformed relay messages */ }
    };
  });
}

/** Merged, de-duplicated results from every relay, newest first. */
export async function queryNostr(filter: NostrFilter, relays = defaultNostrRelays, timeoutMs = queryTimeoutMs): Promise<NostrEvent[]> {
  const pages = await Promise.all(relays.map((url) => queryRelay(url, filter, timeoutMs)));
  const seen = new Map<string, NostrEvent>();
  for (const event of pages.flat()) if (typeof event.id === 'string' && !seen.has(event.id)) seen.set(event.id, event);
  return [...seen.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Sends a signed event to every relay; resolves with the relays that accepted it. */
export async function publishNostr(event: NostrEvent, relays = defaultNostrRelays, timeoutMs = 8000): Promise<string[]> {
  const results = await Promise.all(relays.map((url) => new Promise<string | undefined>((resolve) => {
    let socket: WebSocket;
    const timer = setTimeout(() => { try { socket.close(); } catch { /* closed */ } resolve(undefined); }, timeoutMs);
    try { socket = new WebSocket(url); } catch { clearTimeout(timer); resolve(undefined); return; }
    socket.onopen = () => socket.send(JSON.stringify(['EVENT', event]));
    socket.onerror = () => { clearTimeout(timer); resolve(undefined); };
    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data)) as unknown[];
        if (data[0] === 'OK' && data[1] === event.id) { clearTimeout(timer); socket.close(); resolve(data[2] === true ? url : undefined); }
      } catch { /* ignore */ }
    };
  })));
  return results.filter((url): url is string => Boolean(url));
}

/**
 * A long-lived subscription, used while waiting for a remote signer (NIP-46). Returns a function
 * that closes it.
 */
export function subscribeNostr(filter: NostrFilter, onEvent: (event: NostrEvent) => void, relays = defaultNostrRelays): () => void {
  const sockets: WebSocket[] = [];
  const subscription = `om${Math.random().toString(36).slice(2, 10)}`;
  for (const url of relays) {
    try {
      const socket = new WebSocket(url);
      socket.onopen = () => socket.send(JSON.stringify(['REQ', subscription, filter]));
      socket.onmessage = (message) => {
        try {
          const data = JSON.parse(String(message.data)) as unknown[];
          if (data[0] === 'EVENT' && data[1] === subscription && data[2] && typeof data[2] === 'object') onEvent(data[2] as NostrEvent);
        } catch { /* ignore */ }
      };
      sockets.push(socket);
    } catch { /* relay unreachable */ }
  }
  return () => { for (const socket of sockets) { try { socket.send(JSON.stringify(['CLOSE', subscription])); socket.close(); } catch { /* closed */ } } };
}

/**
 * Web Bot Auth: agents that sign their HTTP requests (RFC 9421 HTTP Message Signatures with
 * Ed25519, tag "web-bot-auth") and publish their keys at
 * `{Signature-Agent}/.well-known/http-message-signatures-directory`.
 *
 * A verified signature only proves which agent operator sent the request. It never grants access
 * to anyone's account. Open Media uses it to label listings an agent published and to skip the
 * extra look that unsigned agents' paid listings get (ADR 0016).
 */
import { fetchPublicPage, MarketplaceDeps } from './marketplace.js';

interface Jwk { kty?: string; crv?: string; x?: string; kid?: string }

const directoryPath = '/.well-known/http-message-signatures-directory';
const directoryCache = new Map<string, { keys: Jwk[]; until: number }>();

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7638 JWK thumbprint of an Ed25519 key, the `keyid` agents put in Signature-Input. */
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return bytesToBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))));
}

interface ParsedInput { label: string; raw: string; components: string[]; params: Record<string, string | number> }

/** Reads the Signature-Input member tagged "web-bot-auth". */
export function parseSignatureInput(header: string): ParsedInput | undefined {
  for (const member of header.split(/,(?=\s*[a-z0-9_-]+=\()/i)) {
    const match = member.trim().match(/^([a-z0-9_-]+)=(\(([^)]*)\)(.*))$/i);
    if (!match) continue;
    const components = [...match[3].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    const params: Record<string, string | number> = {};
    for (const param of match[4].matchAll(/;\s*([a-z0-9_-]+)=("([^"]*)"|(-?\d+))/gi)) params[param[1].toLowerCase()] = param[3] ?? Number(param[4]);
    if (params.tag === 'web-bot-auth') return { label: match[1], raw: match[2], components, params };
  }
  return undefined;
}

function signatureFor(header: string, label: string): Uint8Array<ArrayBuffer> | undefined {
  const match = header.match(new RegExp(`(?:^|,)\\s*${label}=:([A-Za-z0-9+/=_-]+):`));
  if (!match) return undefined;
  try { return base64urlToBytes(match[1].replace(/=+$/, '')); } catch { return undefined; }
}

/** The agent's origin from Signature-Agent: a quoted URL, or a dictionary member for this label. */
function agentOrigin(header: string, label: string): string | undefined {
  const value = header.trim();
  const member = value.match(new RegExp(`(?:^|,)\\s*${label}="([^"]+)"`))?.[1] ?? value.match(/^"([^"]+)"$/)?.[1] ?? value;
  try {
    const url = new URL(member);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch { return undefined; }
}

function componentValue(name: string, request: Request): string | undefined {
  const url = new URL(request.url);
  switch (name) {
    case '@authority': return url.host.toLowerCase();
    case '@method': return request.method.toUpperCase();
    case '@path': return url.pathname;
    case '@target-uri': return url.toString();
    case '@scheme': return url.protocol.replace(':', '');
    default: return name.startsWith('@') ? undefined : request.headers.get(name)?.trim() ?? undefined;
  }
}

async function directoryKeys(origin: string, deps: MarketplaceDeps): Promise<Jwk[]> {
  const cached = directoryCache.get(origin);
  const now = (deps.now?.() ?? new Date()).getTime();
  if (cached && cached.until > now) return cached.keys;
  const page = await fetchPublicPage(`${origin}${directoryPath}`, deps, 64_000);
  let keys: Jwk[] = [];
  try { keys = page && page.status === 200 ? ((JSON.parse(page.text) as { keys?: Jwk[] }).keys ?? []).filter((key) => key.kty === 'OKP' && key.crv === 'Ed25519' && typeof key.x === 'string') : []; } catch { keys = []; }
  if (directoryCache.size > 200) directoryCache.clear();
  directoryCache.set(origin, { keys, until: now + 60 * 60 * 1000 });
  return keys;
}

/** The verified agent origin for a signed request, or undefined when it isn't signed or doesn't verify. */
export async function verifyWebBotAuth(request: Request, deps: MarketplaceDeps = {}): Promise<{ agent: string } | undefined> {
  const input = request.headers.get('signature-input');
  const signatureHeader = request.headers.get('signature');
  const agentHeader = request.headers.get('signature-agent');
  if (!input || !signatureHeader || !agentHeader) return undefined;
  const parsed = parseSignatureInput(input);
  if (!parsed || parsed.params.alg && parsed.params.alg !== 'ed25519') return undefined;
  if (!parsed.components.includes('@authority')) return undefined;
  const now = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const created = Number(parsed.params.created);
  const expires = Number(parsed.params.expires);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now + 60 || expires < now || expires - created > 24 * 60 * 60) return undefined;
  const origin = agentOrigin(agentHeader, parsed.label);
  const signature = signatureFor(signatureHeader, parsed.label);
  if (!origin || !signature || typeof parsed.params.keyid !== 'string') return undefined;
  const lines: string[] = [];
  for (const name of parsed.components) {
    const value = componentValue(name, request);
    if (value === undefined) return undefined;
    lines.push(`"${name}": ${value}`);
  }
  lines.push(`"@signature-params": ${parsed.raw}`);
  const base = new TextEncoder().encode(lines.join('\n'));
  for (const jwk of await directoryKeys(origin, deps)) {
    if ((await jwkThumbprint(jwk)) !== parsed.params.keyid) continue;
    try {
      const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, base)) return { agent: origin };
    } catch { /* an unusable key never verifies */ }
  }
  return undefined;
}

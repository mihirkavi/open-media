/**
 * Passkeys in the phone apps (ADR 0034, "Phones"). React Native has no WebAuthn, so the app asks
 * Supabase for the challenge with its own session, opens Open Media's web page `/passkey` in a
 * secure browser sheet (ASWebAuthenticationSession), and the page runs only the passkey prompt.
 * The page sends back the signed response through `openmedia://passkey`; the app verifies it with
 * its own session. No token or session ever goes through the browser: the challenge is public and
 * the signed response is useless without the app's session.
 *
 * Both legs travel in the URL fragment, which browsers never send to a server.
 */

export const passkeyBridgePath = '/passkey';
export const passkeyBridgeReturn = 'openmedia://passkey';

export type PasskeyCeremony = 'create' | 'request';

/** What the app sends the page: Supabase's credential options, in their JSON form. */
export interface PasskeyBridgeRequest {
  v: 1;
  kind: PasskeyCeremony;
  /** `credential_options.publicKey` exactly as Supabase returned it (binary fields base64url). */
  publicKey: Record<string, unknown>;
}

/** What the page sends back: the credential in WebAuthn's JSON form, or why it stopped. */
export type PasskeyBridgeResponse =
  | { v: 1; ok: true; credential: Record<string, unknown> }
  | { v: 1; ok: false; error: string };

/** The relying party and web page for this build: production, or the local stack in development. */
export function passkeyBridgeSite(apiURL: string): { rpId: string; rpOrigins: string[]; webOrigin: string } {
  const host = new URL(apiURL).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return { rpId: 'localhost', rpOrigins: ['http://localhost:8081'], webOrigin: 'http://localhost:8081' };
  // The web app lives on the API's parent domain (api.openmedia.site → openmedia.site).
  const site = host.replace(/^api\./, '');
  return { rpId: site, rpOrigins: [`https://${site}`], webOrigin: `https://${site}` };
}

export function encodeBridge(value: PasskeyBridgeRequest | PasskeyBridgeResponse): string {
  return base64UrlFromText(JSON.stringify(value));
}

export function passkeyBridgeURL(webOrigin: string, request: PasskeyBridgeRequest): string {
  return `${webOrigin}${passkeyBridgePath}#${encodeBridge(request)}`;
}

/** Reads the page's half from the fragment. Anything malformed is refused. */
export function readBridgeRequest(fragment: string): PasskeyBridgeRequest | undefined {
  const value = decode(fragment);
  if (!value || value.v !== 1 || (value.kind !== 'create' && value.kind !== 'request')) return undefined;
  const publicKey = value.publicKey;
  if (!publicKey || typeof publicKey !== 'object' || typeof (publicKey as { challenge?: unknown }).challenge !== 'string') return undefined;
  return { v: 1, kind: value.kind, publicKey: publicKey as Record<string, unknown> };
}

/** Reads the app's half from the return URL; only `openmedia://passkey#…` is accepted. */
export function readBridgeResponse(url: string): PasskeyBridgeResponse | undefined {
  if (!url.startsWith(`${passkeyBridgeReturn}#`)) return undefined;
  const value = decode(url.slice(passkeyBridgeReturn.length + 1));
  if (!value || value.v !== 1) return undefined;
  if (value.ok === true && value.credential && typeof value.credential === 'object') return { v: 1, ok: true, credential: value.credential as Record<string, unknown> };
  if (value.ok === false) return { v: 1, ok: false, error: typeof value.error === 'string' ? value.error.slice(0, 200) : 'unknown' };
  return undefined;
}

function decode(fragment: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(textFromBase64Url(fragment.replace(/^#/, ''))) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Supabase's client hands back challenge options already decoded (challenge, user id and
 * credential ids as bytes). This turns every byte field back into base64url, so the options can
 * travel to the page as the JSON the server sent.
 */
export function optionsToJSON(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return base64UrlFromBytes(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return base64UrlFromBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (Array.isArray(value)) return value.map(optionsToJSON);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, optionsToJSON(item)]));
  return value;
}

// WebAuthn JSON <-> browser objects (used by the page) --------------------------------------------

/**
 * Supabase's JSON options as the browser's `navigator.credentials` options: the challenge, the
 * user id and the credential ids become bytes. Written out here so older Safari (no
 * `parseCreationOptionsFromJSON`) works too.
 */
export function publicKeyFromJSON(kind: PasskeyCeremony, json: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = { ...json, challenge: bytesFromBase64Url(String(json.challenge)) };
  const ids = (list: unknown) => Array.isArray(list) ? list.map((item: { id: string }) => ({ ...item, id: bytesFromBase64Url(item.id) })) : undefined;
  if (kind === 'create') {
    const user = json.user as { id: string; name?: string; displayName?: string };
    options.user = { ...user, id: bytesFromBase64Url(user.id) };
    if (json.excludeCredentials) options.excludeCredentials = ids(json.excludeCredentials);
  } else if (json.allowCredentials) {
    options.allowCredentials = ids(json.allowCredentials);
  }
  return options;
}

interface BrowserCredential {
  id: string;
  type: string;
  authenticatorAttachment?: string | null;
  response: { clientDataJSON: ArrayBuffer; attestationObject?: ArrayBuffer; authenticatorData?: ArrayBuffer; signature?: ArrayBuffer; userHandle?: ArrayBuffer | null; getTransports?: () => string[] };
  getClientExtensionResults?: () => Record<string, unknown>;
  toJSON?: () => Record<string, unknown>;
}

/** A browser credential in WebAuthn's JSON form (what Supabase's verify expects). */
export function credentialToJSON(credential: BrowserCredential): Record<string, unknown> {
  if (typeof credential.toJSON === 'function') return credential.toJSON();
  const bytes = (buffer: ArrayBuffer) => base64UrlFromBytes(new Uint8Array(buffer));
  const { response } = credential;
  const body: Record<string, unknown> = { clientDataJSON: bytes(response.clientDataJSON) };
  if (response.attestationObject) {
    body.attestationObject = bytes(response.attestationObject);
    if (typeof response.getTransports === 'function') body.transports = response.getTransports();
  } else {
    body.authenticatorData = bytes(response.authenticatorData as ArrayBuffer);
    body.signature = bytes(response.signature as ArrayBuffer);
    if (response.userHandle) body.userHandle = bytes(response.userHandle);
  }
  return {
    id: credential.id,
    rawId: credential.id,
    type: 'public-key',
    response: body,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    ...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
  };
}

// base64url ------------------------------------------------------------------------------------

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]; const b = bytes[index + 1]; const c = bytes[index + 2];
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += alphabet[c & 63];
  }
  return out;
}

export function bytesFromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0; let value = 0; let at = 0;
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Not base64url.');
    value = (value << 6) | index; bits += 6;
    if (bits >= 8) { bits -= 8; out[at++] = (value >> bits) & 255; }
  }
  return out.subarray(0, at);
}

// UTF-8 by hand: Hermes on older phones has no TextDecoder.
function base64UrlFromText(text: string): string {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return base64UrlFromBytes(Uint8Array.from(bytes));
}

function textFromBase64Url(text: string): string {
  const bytes = bytesFromBase64Url(text);
  let out = '';
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index];
    const size = byte < 0x80 ? 1 : byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
    let code = size === 1 ? byte : byte & (0xff >> (size + 1));
    for (let next = 1; next < size; next += 1) code = (code << 6) | (bytes[index + next] & 63);
    out += String.fromCodePoint(code);
    index += size;
  }
  return out;
}

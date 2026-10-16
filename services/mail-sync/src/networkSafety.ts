import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);

type Lookup = (host: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;

/**
 * Refuses mail hosts that resolve to loopback, private, link-local, or other
 * reserved addresses. Every IP answer must be public; non-IP answers (some
 * runtimes return CNAME targets) are ignored, and a host with no IP answers is
 * refused. Connections then use the hostname itself: the Workers runtime cannot
 * open sockets to raw IPs, and Cloudflare egress cannot reach private networks.
 */
export async function assertPublicMailHost(host: string, resolve: Lookup = lookup as Lookup): Promise<void> {
  if (isIP(host)) throw new Error('Enter a mail-server hostname, not an IP address.');
  let answers: Array<{ address: string }>;
  try {
    answers = await resolve(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not find the mail server ${host}. Check the server name.`);
  }
  const addresses = answers.map((answer) => answer.address).filter((address) => isIP(address) !== 0);
  if (!addresses.length) throw new Error(`Could not find the mail server ${host}. Check the server name.`);
  if (addresses.some((address) => !isPublicAddress(address))) {
    throw new Error('Mail server resolves to a private or reserved network address.');
  }
}

/**
 * Checks a mail host and returns what to connect to. `allowLocal` is for local
 * development only (a test server such as Mailpit on this machine); production
 * never sets it.
 */
export async function resolveMailHost(host: string, allowLocal: boolean, resolve?: Lookup): Promise<{ address: string; local: boolean }> {
  if (allowLocal && isLocalMailHost(host)) return { address: host === 'localhost' ? '127.0.0.1' : host, local: true };
  await assertPublicMailHost(host, resolve);
  return { address: host, local: false };
}

export function isLocalMailHost(host: string): boolean {
  return localHostnames.has(host.toLowerCase());
}

/** True only for public IP addresses; anything that is not an IP is not public. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 0) return false;
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return false;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(address) === 4 ? address : undefined);
  if (!ipv4) return true;
  const [a, b] = ipv4.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
}

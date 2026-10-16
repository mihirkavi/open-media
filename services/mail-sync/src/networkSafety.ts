import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);

export async function resolvePublicMailHost(host: string): Promise<string> {
  if (isIP(host)) throw new Error('Enter a public mail-server hostname, not an IP address.');
  const answers = await lookup(host, { all: true, verbatim: true });
  const publicAnswer = answers.find((answer) => isPublicAddress(answer.address));
  if (!publicAnswer || answers.some((answer) => !isPublicAddress(answer.address))) {
    throw new Error('Mail server resolves to a private or reserved network address.');
  }
  return publicAnswer.address;
}

/**
 * Resolves a mail host. `allowLocal` is for local development only (a test
 * server such as Mailpit on this machine); production never sets it.
 */
export async function resolveMailHost(host: string, allowLocal: boolean): Promise<{ address: string; local: boolean }> {
  if (allowLocal && isLocalMailHost(host)) return { address: host === 'localhost' ? '127.0.0.1' : host, local: true };
  return { address: await resolvePublicMailHost(host), local: false };
}

export function isLocalMailHost(host: string): boolean {
  return localHostnames.has(host.toLowerCase());
}

export function isPublicAddress(address: string): boolean {
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return false;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(address) === 4 ? address : undefined);
  if (!ipv4) return true;
  const [a, b] = ipv4.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
}

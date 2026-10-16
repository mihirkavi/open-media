/**
 * Verified senders (BIMI). A message gets a verified badge and the brand's
 * logo only when all of these hold, mirroring what large mailbox providers
 * require:
 *
 * 1. The receiving mail server recorded `dmarc=pass` for the From domain in the
 *    topmost Authentication-Results header. Receivers prepend that header, so
 *    lower copies (which a sender can forge) are ignored.
 * 2. The domain's DMARC policy is enforced (p=quarantine or p=reject, pct=100).
 * 3. The domain publishes a BIMI record with an HTTPS SVG logo (l=) and a mark
 *    certificate (a=) that is a BIMI certificate (EKU 1.3.6.1.5.5.7.3.31) for
 *    the domain, is currently valid, and is signed by the next certificate in
 *    its chain.
 *
 * Limitation: the chain is not yet validated up to a pinned Mark Verifying
 * Authority root. The app therefore always shows the domain next to the name.
 */
import { X509Certificate } from 'node:crypto';

export interface SenderBrand {
  verified: boolean;
  logoUrl?: string;
}

interface DomainBrand {
  policyEnforced: boolean;
  logoUrl?: string;
  hasMarkCertificate: boolean;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const BIMI_EKU = '1.3.6.1.5.5.7.3.31';
const cache = new Map<string, { expires: number; brand: Promise<DomainBrand> }>();
const cacheMs = 6 * 60 * 60 * 1000;

/** The DMARC result the receiving server recorded, from the topmost Authentication-Results header. */
export function receivedDmarc(headerLines: ReadonlyArray<{ readonly key: string; readonly line: string }>): { result: string; domain: string } | undefined {
  const top = headerLines.find((header) => header.key === 'authentication-results');
  if (!top) return undefined;
  const value = top.line.replace(/^authentication-results:\s*/i, '').replace(/\r?\n[ \t]+/g, ' ');
  const match = value.match(/\bdmarc=([a-z]+)\b[^;]*?\bheader\.from=([a-z0-9.-]+)/i);
  return match ? { result: match[1].toLowerCase(), domain: match[2].toLowerCase() } : undefined;
}

export async function verifySender(
  fromAddress: string,
  headerLines: ReadonlyArray<{ readonly key: string; readonly line: string }>,
  fetchImpl: Fetch = fetch,
): Promise<SenderBrand> {
  const domain = fromAddress.split('@')[1]?.toLowerCase().replace(/>$/, '');
  if (!domain) return { verified: false };
  const dmarc = receivedDmarc(headerLines);
  if (!dmarc || dmarc.result !== 'pass' || dmarc.domain !== domain) return { verified: false };
  const brand = await domainBrand(domain, fetchImpl);
  const verified = brand.policyEnforced && brand.hasMarkCertificate && Boolean(brand.logoUrl);
  return verified ? { verified, logoUrl: brand.logoUrl } : { verified: false };
}

function domainBrand(domain: string, fetchImpl: Fetch): Promise<DomainBrand> {
  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.brand;
  const brand = lookupDomainBrand(domain, fetchImpl).catch(() => ({ policyEnforced: false, hasMarkCertificate: false }));
  cache.set(domain, { expires: Date.now() + cacheMs, brand });
  return brand;
}

async function lookupDomainBrand(domain: string, fetchImpl: Fetch): Promise<DomainBrand> {
  const organization = domain.split('.').slice(-2).join('.');
  const isSubdomain = organization !== domain;

  const dmarcRecord = (await txtRecord(`_dmarc.${domain}`, fetchImpl, 'v=DMARC1')) ?? (isSubdomain ? await txtRecord(`_dmarc.${organization}`, fetchImpl, 'v=DMARC1') : undefined);
  const dmarc = tags(dmarcRecord ?? '');
  const policy = (isSubdomain && dmarc.sp ? dmarc.sp : dmarc.p)?.toLowerCase();
  const policyEnforced = (policy === 'quarantine' || policy === 'reject') && (!dmarc.pct || dmarc.pct === '100');

  const bimiRecord = (await txtRecord(`default._bimi.${domain}`, fetchImpl, 'v=BIMI1')) ?? (isSubdomain ? await txtRecord(`default._bimi.${organization}`, fetchImpl, 'v=BIMI1') : undefined);
  const bimi = tags(bimiRecord ?? '');
  const logoUrl = bimi.l && /^https:\/\/[^\s]+\.svg(\?[^\s]*)?$/i.test(bimi.l) ? bimi.l : undefined;
  const hasMarkCertificate = bimi.a && /^https:\/\//i.test(bimi.a) ? await isMarkCertificate(bimi.a, [domain, organization], fetchImpl) : false;
  return { policyEnforced, logoUrl, hasMarkCertificate };
}

async function txtRecord(name: string, fetchImpl: Fetch, prefix: string): Promise<string | undefined> {
  const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return undefined;
  const payload = await response.json() as { Answer?: Array<{ type: number; data: string }> };
  return (payload.Answer ?? [])
    .filter((answer) => answer.type === 16)
    .map((answer) => answer.data.replace(/"\s*"/g, '').replace(/^"|"$/g, ''))
    .find((record) => record.toLowerCase().startsWith(prefix.toLowerCase()));
}

function tags(record: string): Record<string, string> {
  return Object.fromEntries(record.split(';').map((part) => part.trim().split('=')).filter(([key, value]) => key && value !== undefined).map(([key, ...rest]) => [key.trim().toLowerCase(), rest.join('=').trim()]));
}

export async function isMarkCertificate(url: string, domains: string[], fetchImpl: Fetch, now = new Date()): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const pem = (await response.text()).slice(0, 65_536);
    return checkMarkCertificatePem(pem, domains, now);
  } catch {
    return false;
  }
}

export function checkMarkCertificatePem(pem: string, domains: string[], now = new Date()): boolean {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length) return false;
  try {
    const [leaf, issuer] = blocks.map((block) => new X509Certificate(block));
    if (new Date(leaf.validFrom) > now || new Date(leaf.validTo) < now) return false;
    if (!(leaf.keyUsage ?? []).includes(BIMI_EKU)) return false;
    const names = (leaf.subjectAltName ?? '').split(',').map((entry) => entry.trim().replace(/^DNS:/i, '').toLowerCase());
    if (!domains.some((domain) => names.includes(domain))) return false;
    if (!issuer) return false;
    return leaf.checkIssued(issuer) && leaf.verify(issuer.publicKey);
  } catch {
    return false;
  }
}

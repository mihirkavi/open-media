import { MailProviderPreset, presetForEmail, presetForMxHosts } from '../domain/mailPresets';

export interface DetectedMailProvider {
  preset: MailProviderPreset;
  /** True when found through the domain's MX records (a custom domain). */
  customDomain: boolean;
}

/**
 * Finds server settings for an email address: known consumer domains first,
 * then the domain's public MX records over DNS-over-HTTPS. Only the domain
 * name is looked up; the address and password never leave the app here.
 */
export async function detectMailProvider(email: string, signal?: AbortSignal): Promise<DetectedMailProvider | undefined> {
  const known = presetForEmail(email);
  if (known) return { preset: known, customDomain: false };
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return undefined;
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: 'application/dns-json' },
      signal,
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { Answer?: Array<{ type: number; data: string }> };
    const hosts = (payload.Answer ?? []).filter((answer) => answer.type === 15).map((answer) => answer.data.split(/\s+/).pop() ?? '');
    const preset = presetForMxHosts(hosts);
    return preset ? { preset, customDomain: true } : undefined;
  } catch {
    return undefined;
  }
}

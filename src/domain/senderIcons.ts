/** Consumer mail providers: their site icon would misrepresent a person, so they get initials. */
const personalMailDomains = new Set([
  'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'fastmail.com', 'fastmail.fm',
  'hey.com', 'mail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'yandex.com', 'yandex.ru', 'zoho.com', 'zohomail.com', 'tutanota.com',
  'tuta.io', 'qq.com', '163.com', 'web.de', 'test.local', 'example.com', 'openmedia.test',
]);

export function isPersonalMailDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  const organization = lower.split('.').slice(-2).join('.');
  return personalMailDomains.has(lower) || personalMailDomains.has(organization) || lower.endsWith('.test') || lower.endsWith('.local');
}

/**
 * Pictures to try for an email sender, best first: the verified BIMI logo (a vector, sharp at
 * any size), then the company's largest site icon through Open Media's icon service
 * (`iconService`, the API origin), which refuses blurry ones. Organization domains only; the
 * avatar falls back to initials when none load.
 */
export function senderIconUrls(address: string, bimiLogoUrl?: string, iconService?: string): string[] {
  const urls = bimiLogoUrl ? [bimiLogoUrl] : [];
  const domain = address.split('@')[1]?.toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || isPersonalMailDomain(domain) || !iconService) return urls;
  const organization = domain.split('.').slice(-2).join('.');
  return [...urls, `${iconService.replace(/\/$/, '')}/v1/sender-icons/${organization}`];
}

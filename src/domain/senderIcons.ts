/** Consumer mail providers: their site icon would misrepresent a person, so they get initials. */
const personalMailDomains = new Set([
  'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'fastmail.com', 'fastmail.fm',
  'hey.com', 'mail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'yandex.com', 'yandex.ru', 'zoho.com', 'zohomail.com', 'tutanota.com',
  'tuta.io', 'qq.com', '163.com', 'web.de', 'test.local', 'example.com', 'openmedia.test',
]);

/**
 * Pictures to try for an email sender, best first: the verified BIMI logo, then
 * the company's own site icon (organization domains only). The avatar falls
 * back to initials when none load.
 */
export function senderIconUrls(address: string, bimiLogoUrl?: string): string[] {
  const urls = bimiLogoUrl ? [bimiLogoUrl] : [];
  const domain = address.split('@')[1]?.toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return urls;
  const organization = domain.split('.').slice(-2).join('.');
  if (personalMailDomains.has(domain) || personalMailDomains.has(organization) || domain.endsWith('.test') || domain.endsWith('.local')) return urls;
  return [...urls, `https://${organization}/apple-touch-icon.png`, `https://www.${organization}/apple-touch-icon.png`, `https://www.${organization}/favicon.ico`];
}

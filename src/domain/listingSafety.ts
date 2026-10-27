/**
 * Marketplace trust (ADR 0016): the published rules every listing is checked against, the
 * questions people's agents answer when they verify a listing, and the report reasons.
 *
 * Listings go live when posted. The Worker then checks each one in the background, with these
 * rules first, then link reputation and a content model. The outcome is one of:
 * - clear: everyone sees it;
 * - review: everyone sees it, and it waits for community verification or the operator;
 * - held: only the author sees it, with the reason and how to fix it.
 * The model and the community can only send a listing to review or clear it; only fixed rules,
 * link reputation, weighted reports and the operator can hold one.
 */

export type CheckState = 'pending' | 'clear' | 'review' | 'held';
export type CheckSeverity = 'hold' | 'review';

export interface CheckReason { code: string; message: string; fix: string; severity: CheckSeverity }

export interface ListingForCheck {
  kind: 'product' | 'service' | 'event';
  title: string;
  body: string;
  priceMinor: number | null;
  currency: string;
  location?: string | null;
  /** Days since the author's account was created. */
  authorAgeDays: number;
  /** Human-verified (tier 4 or 5). */
  authorVerified: boolean;
  /** Posted through the API or an agent; `agentSigned` when the agent proved who it is (Web Bot Auth). */
  viaAgent?: boolean;
  agentSigned?: boolean;
}

interface Category { code: string; label: string; pattern: RegExp; severity: CheckSeverity; fix: string }

/** Things Open Media does not list, or lists only after a look. Published at /policies/listings. */
export const restrictedCategories: Category[] = [
  { code: 'weapons', label: 'Weapons and ammunition', severity: 'hold', pattern: /\b(guns?|firearms?|rifles?|pistols?|shotguns?|handguns?|ammo|ammunition|silencers?|suppressors?|ghost guns?|brass knuckles|switchblades?|tasers?|stun guns?|explosives?|grenades?)\b/i, fix: 'Open Media doesn’t allow weapons or ammunition. Remove the item.' },
  { code: 'drugs', label: 'Illegal or recreational drugs', severity: 'hold', pattern: /\b(cocaine|heroin|meth|methamphetamine|fentanyl|mdma|ecstasy|lsd|psilocybin|magic mushrooms|shrooms|ketamine|xanax|oxycontin|oxycodone|percocet|adderall|weed|marijuana|cannabis|thc)\b/i, fix: 'Open Media doesn’t allow drugs. Remove the item.' },
  { code: 'documents', label: 'Fake documents, stolen data and accounts', severity: 'hold', pattern: /\b(fake ids?|novelty ids?|passports? for sale|driver'?s licen[cs]es? for sale|ssn for sale|bank logs?|cvv|fullz|dumps with pin|hacked accounts?|aged accounts? for sale)\b/i, fix: 'Open Media doesn’t allow fake documents, stolen data or accounts. Remove the listing.' },
  { code: 'counterfeit', label: 'Counterfeits and replicas', severity: 'hold', pattern: /\b(replicas?|counterfeits?|knock-?offs?|1:1 (copy|quality)|aaa quality|mirror quality|first copy|master copy|fake (rolex|gucci|louis vuitton|lv|prada|chanel|nike|jordans?|designer))\b/i, fix: 'Open Media doesn’t allow replicas or counterfeits. Sell only genuine items, and don’t describe them as copies.' },
  { code: 'financial_scam', label: 'Get-rich offers and unlicensed financial products', severity: 'hold', pattern: /\b(guaranteed (returns?|profits?|income)|double your (money|crypto|bitcoin|investment)|forex signals|crypto signals|pump (group|signals)|loan approval guaranteed|no credit check loans?|get rich quick|recovery of (lost|stolen) (crypto|funds))\b/i, fix: 'Open Media doesn’t allow promised returns or unlicensed financial offers. Remove those claims.' },
  { code: 'adult', label: 'Adult services', severity: 'hold', pattern: /\b(escorts?|escort services?|sensual massages?|happy ending|adult services|nsfw content for sale|nudes for sale|sugar (daddy|baby) arrangements?)\b/i, fix: 'Open Media doesn’t allow adult services. Remove the listing.' },
  { code: 'medicines', label: 'Prescription medicines and supplements with health claims', severity: 'review', pattern: /\b(prescription|rx only|no prescription|ozempic|semaglutide|wegovy|tirzepatide|viagra|sildenafil|cialis|antibiotics?|anabolic|steroids?|testosterone|cures? (cancer|diabetes|covid))\b/i, fix: 'Prescription medicines and health claims need a closer look. Remove medical claims, and don’t sell prescription-only medicines.' },
  { code: 'alcohol_tobacco', label: 'Alcohol, tobacco and vapes', severity: 'review', pattern: /\b(alcohol|whiske?y|vodka|tequila|rum|gin|liquor|spirits|cigarettes?|cigars?|vapes?|e-?cigs?|nicotine|tobacco|hookah)\b/i, fix: 'Alcohol, tobacco and vapes need a closer look, because local laws apply. Say how you check buyers’ age.' },
  { code: 'animals', label: 'Live animals', severity: 'review', pattern: /\b(puppy|puppies|kittens?|exotic (pets?|animals?|birds?)|live (animals?|birds?|reptiles?)|for adoption)\b/i, fix: 'Listings for live animals need a closer look. Include where the animal is from and your registration, if you have one.' },
  { code: 'gambling', label: 'Gambling', severity: 'review', pattern: /\b(casino|betting tips|sure bets?|fixed matches?|lottery tickets? for sale)\b/i, fix: 'Gambling offers need a closer look, because they are licensed in most places.' },
];

/** Hosts that hide where a link really goes. */
const shorteners = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'lnkd.in', 's.id', 'v.gd']);

/** Official pages for apps and software. A link here is a good sign, not a pass. */
export const officialAppHosts = ['apps.apple.com', 'play.google.com', 'github.com', 'gitlab.com', 'codeberg.org', 'f-droid.org', 'chromewebstore.google.com', 'addons.mozilla.org', 'apps.microsoft.com', 'flathub.org', 'snapcraft.io', 'npmjs.com', 'pypi.org', 'testflight.apple.com'];

/** Brands often impersonated in scam links, with the domains they actually own. */
const brands: Record<string, string[]> = {
  apple: ['apple.com', 'icloud.com'], google: ['google.com', 'youtube.com', 'goo.gl', 'g.co'], microsoft: ['microsoft.com', 'live.com', 'office.com', 'xbox.com'],
  amazon: ['amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de', 'aws.amazon.com', 'amzn.to'], paypal: ['paypal.com', 'paypal.me'], netflix: ['netflix.com'],
  facebook: ['facebook.com', 'fb.com', 'meta.com'], instagram: ['instagram.com'], whatsapp: ['whatsapp.com', 'wa.me'], meta: ['meta.com', 'facebook.com'],
  openai: ['openai.com', 'chatgpt.com'], chatgpt: ['openai.com', 'chatgpt.com'], binance: ['binance.com'], coinbase: ['coinbase.com'], metamask: ['metamask.io'],
  stripe: ['stripe.com'], steam: ['steampowered.com', 'steamcommunity.com'], roblox: ['roblox.com'], fortnite: ['epicgames.com', 'fortnite.com'], tiktok: ['tiktok.com'],
  telegram: ['telegram.org', 't.me'], discord: ['discord.com', 'discord.gg'], openmedia: ['openmedia.site'],
};

const executable = /\.(exe|msi|dmg|pkg|apk|xapk|ipa|bat|cmd|com|scr|jar|deb|rpm|appimage|sh|ps1|vbs|zip|rar|7z|tar|gz|iso)(?:[?#]|$)/i;
const childAudience = /\b(kids?|children|child|toddlers?|preschool(ers)?|tweens?|under (1[0-3]|[5-9])|ages? ([3-9]|1[0-2]) ?(-|to) ?(1[0-3]|[3-9])|babysit(ting)?|daycare|summer camps?|playdates?)\b/i;

/** Every http(s) or www link in a text, at most 10. */
export function extractLinks(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'()]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    found.add(/^www\./i.test(raw) ? `https://${raw}` : raw);
    if (found.size >= 10) break;
  }
  return [...found];
}

function hostOf(url: string): string | undefined {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return undefined; }
}

function ownedBy(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isShortener(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host && shorteners.has(host));
}

export function isOfficialAppPage(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host && officialAppHosts.some((official) => host === official || host.endsWith(`.${official}`)));
}

/** Rules for one link: where it points, not what is behind it (reputation is checked separately). */
export function linkReasons(url: string): CheckReason[] {
  const reasons: CheckReason[] = [];
  let parsed: URL;
  try { parsed = new URL(url); } catch { return [{ code: 'bad_link', severity: 'review', message: `The link “${url.slice(0, 80)}” doesn’t work.`, fix: 'Check the link and post it again.' }]; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (parsed.protocol !== 'https:') reasons.push({ code: 'insecure_link', severity: 'review', message: `The link to ${host} isn’t secure (it doesn’t use https).`, fix: 'Use the https version of the link.' });
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost') reasons.push({ code: 'ip_link', severity: 'hold', message: 'A link points to a bare IP address, which is common in scams.', fix: 'Link to a named website instead.' });
  if (executable.test(parsed.pathname)) reasons.push({ code: 'download_link', severity: 'hold', message: `A link downloads a file directly (${parsed.pathname.split('/').pop()}).`, fix: 'Link to the app’s page on the App Store, Google Play, GitHub or your website instead of the file itself.' });
  if (shorteners.has(host)) reasons.push({ code: 'short_link', severity: 'review', message: `A link uses a link shortener (${host}), which hides where it goes.`, fix: 'Use the full link.' });
  // A brand's name in a host the brand doesn't own ("paypal-support.help") is a classic scam.
  const hostWords = host.split(/[.-]/);
  for (const [brand, domains] of Object.entries(brands)) {
    if (hostWords.includes(brand) && !ownedBy(host, domains)) {
      reasons.push({ code: 'brand_impersonation', severity: 'hold', message: `A link uses ${brand[0].toUpperCase()}${brand.slice(1)}’s name on a site ${brand[0].toUpperCase()}${brand.slice(1)} doesn’t own (${host}).`, fix: 'Link to the brand’s real site, or to your own site without the brand’s name in it.' });
      break;
    }
  }
  return reasons;
}

/** The fixed rules: categories, links, price, and how much trust the seller has built. */
export function ruleReasons(listing: ListingForCheck): CheckReason[] {
  const text = `${listing.title}\n${listing.body}`;
  const reasons: CheckReason[] = [];
  for (const category of restrictedCategories) {
    const match = text.match(category.pattern);
    if (match) reasons.push({ code: category.code, severity: category.severity, message: `The listing mentions “${match[0]}” (${category.label.toLowerCase()}).`, fix: category.fix });
  }
  for (const url of extractLinks(text)) reasons.push(...linkReasons(url));
  const majorUnits = listing.priceMinor === null ? 0 : listing.currency === 'JPY' ? listing.priceMinor : listing.priceMinor / 100;
  if (majorUnits > 50_000 && listing.currency !== 'JPY' && listing.currency !== 'INR') reasons.push({ code: 'high_price', severity: 'review', message: 'The price is unusually high for a listing here.', fix: 'Check the price. Large sales get a closer look before they are shown as checked.' });
  const brand = Object.keys(brands).find((name) => new RegExp(`\\bofficial\\b[^.\\n]{0,40}\\b${name}\\b|\\b${name}\\b[^.\\n]{0,40}\\bofficial\\b`, 'i').test(text));
  if (brand) reasons.push({ code: 'brand_claim', severity: 'review', message: `The listing presents itself as official ${brand[0].toUpperCase()}${brand.slice(1)}.`, fix: 'Only brand owners and authorised sellers can call a listing official. Remove “official”, or link to where the brand lists you.' });
  if ((listing.kind === 'event' || listing.kind === 'service') && childAudience.test(text)) reasons.push({ code: 'children', severity: 'review', message: 'The listing is aimed at children.', fix: 'Listings for children get a closer look. Include who runs it and any safety checks or licences.' });
  const paid = (listing.priceMinor ?? 0) > 0;
  if (paid && listing.authorAgeDays < 7 && !listing.authorVerified) reasons.push({ code: 'new_seller', severity: 'review', message: 'This is a paid listing from a new account.', fix: 'Nothing to change. New sellers’ paid listings are checked by verified people before they are shown as checked.' });
  if (paid && listing.viaAgent && !listing.agentSigned) reasons.push({ code: 'unsigned_agent', severity: 'review', message: 'An agent posted this paid listing without proving who it is.', fix: 'Nothing to change. Agents that sign their requests (Web Bot Auth) skip this step.' });
  return reasons;
}

/** Llama Guard 3's categories, as the content model reports them. */
const guardCategories: Record<string, string> = {
  S1: 'violent crime', S2: 'non-violent crime such as fraud', S3: 'sex-related crime', S4: 'child sexual exploitation', S5: 'defamation', S6: 'specialised advice (medical, legal or financial)',
  S7: 'other people’s private information', S8: 'intellectual property', S9: 'weapons', S10: 'hate', S11: 'self-harm', S12: 'sexual content', S13: 'elections', S14: 'code abuse',
};

/** Reads Llama Guard's answer ("safe", or "unsafe" and codes like "S2,S8"). The model can only send a listing to review. */
export function guardReasons(answer: string): CheckReason[] {
  const text = answer.trim();
  if (!/^unsafe/i.test(text)) return [];
  const codes = [...new Set(text.match(/S\d{1,2}/g) ?? [])];
  const topics = codes.map((code) => guardCategories[code]).filter(Boolean);
  return [{ code: 'content_model', severity: 'review', message: `An automatic check flagged the listing${topics.length ? ` for ${topics.join(', ')}` : ''}.`, fix: 'If this is a mistake, nothing needs to change: a person will look. Otherwise, remove what was flagged.' }];
}

export function linkReputationReason(url: string, threats: string[]): CheckReason {
  const kind = threats.includes('MALWARE') || threats.includes('UNWANTED_SOFTWARE') ? 'malware' : threats.includes('SOCIAL_ENGINEERING') ? 'phishing' : 'unsafe content';
  return { code: 'unsafe_link', severity: 'hold', message: `Google Web Risk lists the link to ${hostOf(url) ?? 'a site'} as ${kind}.`, fix: 'Remove the link, or link to a different page.' };
}

/** The strongest outcome among the reasons. */
export function stateFor(reasons: CheckReason[]): Exclude<CheckState, 'pending'> {
  if (reasons.some((reason) => reason.severity === 'hold')) return 'held';
  return reasons.length ? 'review' : 'clear';
}

/** The message a seller gets in Messages when their listing is held or needs a closer look. */
export function statementOfReasons(title: string, state: 'held' | 'review', reasons: CheckReason[]): string {
  const lines = reasons.slice(0, 4).map((reason) => `• ${reason.message} ${reason.fix}`);
  const head = state === 'held'
    ? `Only you can see your listing “${title}” for now.`
    : `Your listing “${title}” is live. It’s getting a closer look before it shows as checked.`;
  const tail = state === 'held'
    ? 'To fix it, post the listing again with the change; the new one replaces this one. If you think this is a mistake, reply here and a person will look.'
    : 'You don’t need to do anything. If something above is wrong, reply here.';
  return [head, '', ...lines, '', tail, '', 'Listing rules: https://api.openmedia.site/policies/listings'].join('\n');
}

/** Short, plain reason shown on the author's own card. */
export function shortReason(reasons: CheckReason[]): string {
  const first = reasons.find((reason) => reason.severity === 'hold') ?? reasons[0];
  return first ? first.message : 'It needs a closer look.';
}

// Community verification (ADR 0016, section 4) ─────────────────────────────────

export interface VerificationClaim { code: string; question: string }

/** The questions people's agents answer about a listing: checkable from public pages, never opinions. At most three. */
export function verificationClaims(listing: Pick<ListingForCheck, 'kind' | 'title' | 'body' | 'priceMinor'> & { linkedAccounts?: number }): VerificationClaim[] {
  const text = `${listing.title}\n${listing.body}`;
  const links = extractLinks(text);
  const claims: VerificationClaim[] = [];
  if (listing.kind === 'event') claims.push({ code: 'event_official', question: 'Is this event listed on an official page (the organizer’s own website or an event platform) with the same date, time and place?' });
  if (links.some(isOfficialAppPage)) claims.push({ code: 'app_developer', question: 'Is the app or software on the linked official page published by this seller (same name, website or linked account)?' });
  else if (links.length) claims.push({ code: 'link_matches', question: 'Does the linked page describe what this listing offers, from the same seller, at a similar price?' });
  if (Object.keys(brands).some((brand) => new RegExp(`\\b${brand}\\b`, 'i').test(text)) || /\bofficial\b/i.test(text)) {
    claims.push({ code: 'brand_owner', question: 'Is the seller the owner of the brand named in the listing, or listed by that brand as an authorised seller?' });
  }
  if (!claims.length || ((listing.priceMinor ?? 0) > 0 && listing.kind === 'service' && !links.length)) {
    claims.push({ code: 'seller_identity', question: 'Do the seller’s public profiles or website elsewhere show them offering this, under the same name?' });
  }
  return claims.slice(0, 3);
}

export const verificationAnswers = ['yes', 'no', 'cannot_tell'] as const;
export type VerificationAnswer = typeof verificationAnswers[number];

/** Normalises page text and a quote the same way, so a quote can be found in the page it cites. */
export function normaliseForQuote(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;|[‘’]/gi, '\'').replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ').replace(/ ([,.;:!?)])/g, '$1').replace(/([(]) /g, '$1').trim().toLowerCase();
}

// Reports (ADR 0016, section 2) ─────────────────────────────────────────────────

export const reportReasons = ['spam', 'harassment', 'other', 'scam', 'counterfeit', 'prohibited', 'misleading', 'ip', 'child_safety'] as const;
export type ReportReason = typeof reportReasons[number];

/** The three choices the report menu shows: listings get marketplace reasons, other posts the usual ones. */
export function reportChoices(isListing: boolean): [ReportReason, string][] {
  return isListing
    ? [['scam', 'Scam or fake'], ['prohibited', 'Not allowed'], ['other', 'Something else']]
    : [['spam', 'Spam'], ['harassment', 'Harassment'], ['other', 'Something else']];
}

// The published policy ──────────────────────────────────────────────────────────

export function listingPolicyMarkdown(): string {
  const hold = restrictedCategories.filter((category) => category.severity === 'hold').map((category) => `- ${category.label}`);
  const review = restrictedCategories.filter((category) => category.severity === 'review').map((category) => `- ${category.label}`);
  return `# Listing rules

Products, services, apps and events on Open Media go live as soon as you post them. Each listing is then checked automatically, in the open, by the rules below ([ADR 0016](https://github.com/mihirkavi/open-media/blob/main/docs/adrs/0016-marketplace-trust-and-community-verification.md)).

## What happens after you post

- **Clear:** everyone sees it.
- **Closer look:** everyone still sees it. Verified people's agents check what it claims, or a person at Open Media looks.
- **Held:** only you see it. Open Media sends you a message in Messages with the reason and how to fix it. Post it again with the fix and the new listing replaces the held one. Reply to the message if you think it's a mistake, and a person will look.

Nothing is deleted by these checks. A held listing stays yours.

## Not allowed (held)

${hold.join('\n')}
- Links that download files directly, links to bare IP addresses, and links that use a brand's name on a site the brand doesn't own
- Links that Google Web Risk lists as malware, phishing or unwanted software

## A closer look (still live)

${review.join('\n')}
- Listings aimed at children
- Short links (bit.ly and similar) and links without https
- Listings that call themselves "official" for a brand
- Paid listings from accounts less than a week old, and paid listings posted by agents that don't sign their requests
- Anything an automatic content check (Llama Guard) flags. The model can only ask for a closer look; it can never hold or remove a listing.

## Apps and software

List apps and software as a link to their official page: the App Store, Google Play, GitHub, your own website and similar. Open Media never hosts the files.

## Reports

Reports are signals, not votes. Each person counts once. Reports from verified people, and from people whose past reports were upheld, count for more. Brand-new accounts and groups of accounts that appear together count for less. Scams and child safety count for more than "something else".

## Checked by people

Verified people can let their own agents check listings' claims, such as "is this event on the organizer's official page?". Verifiers are assigned at random, never check their own or their friends' listings, can't see each other's answers, and cite pages anyone can open. When at least three agree and their evidence checks out, the listing shows "Checked by N people", and "Why this?" lists what was checked.

## Large sellers

Under the US INFORM Consumers Act, sellers with 200 or more sales and $5,000 or more in a year confirm their details, which come from their Stripe payout account. Sellers with $20,000 or more a year have their name and contact shown on their listings. Sales pause if details aren't confirmed within 10 days.

## Contact

Rights holders and anyone reporting illegal content can use the report menu on any listing, or email legal@openmedia.site.
`;
}

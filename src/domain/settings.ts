/**
 * The settings graph: every setting in Open Media, where it lives, and how settings relate.
 *
 * Each entry is a node with its exact place in the app (the page, the Settings screen and the
 * anchor of the section that holds it) and the breadcrumb a person sees on the way there.
 * `related` links are the edges, so a search for one setting can offer its neighbours. In-app
 * Search, Settings' own search field, Open Media AI and the agent API all read this one graph, so
 * a setting is findable everywhere as soon as it is listed here. When a setting moves or a new one
 * ships, update its entry in the same change.
 */

/** The broad areas Open Media AI can open (the `open_settings` tool). Kept for agents and older clients. */
export type SettingRoute =
  | 'appearance' | 'feed' | 'language' | 'messages' | 'email' | 'connected-apps' | 'cross-posting' | 'ai' | 'privacy' | 'data' | 'profile' | 'about'
  | 'security' | 'payments' | 'store' | 'people' | 'contacts' | 'account';

/**
 * Where a setting is: `settings` is the Settings tab (its `screen` says which of its pages),
 * `profile` the Profile tab, and `edit-profile` the editor opened from Profile.
 */
export type SettingPage = 'settings' | 'profile' | 'edit-profile';

/**
 * Settings' pages. `home` is the first page, with the everyday controls and one row for each other
 * page, so every setting is at most one tap from Settings (and one result away in Search).
 */
export type SettingsScreen = 'home' | 'account' | 'privacy' | 'payments' | 'store' | 'algorithm' | 'cross-posting' | 'connections' | 'ai' | 'mission' | 'developers';

/** Section anchors the screens mark with `SettingAnchor`, so a result can scroll straight to them. */
export type SettingAnchorId =
  | 'appearance' | 'default-feed' | 'translation' | 'sign-out'
  | 'email' | 'device-contacts' | 'chat-networks'
  | 'security' | 'your-data' | 'delete-account' | 'identity' | 'read-receipts' | 'people';

export interface SettingIndexEntry {
  id: string;
  title: string;
  description: string;
  route: SettingRoute;
  page: SettingPage;
  /** The Settings page it is on, when `page` is `settings`. */
  screen?: SettingsScreen;
  /** The section to scroll to and outline on that page. */
  anchor?: SettingAnchorId;
  /** What a person taps on the way there, ending with the section, e.g. Settings › Account › Password. */
  path: string[];
  keywords: string[];
  /** Neighbouring settings: the graph's edges. */
  related?: string[];
}

const home = (anchor: SettingAnchorId) => ({ page: 'settings' as const, screen: 'home' as const, anchor });
const on = (screen: SettingsScreen, anchor?: SettingAnchorId) => ({ page: 'settings' as const, screen, ...(anchor ? { anchor } : {}) });

export const settingIndex: SettingIndexEntry[] = [
  // Settings: the first page
  { id: 'appearance', title: 'Appearance', description: 'Use System, Light, or Dark appearance.', route: 'appearance', ...home('appearance'), path: ['Settings', 'Appearance'], keywords: ['dark mode', 'light mode', 'night mode', 'theme', 'system', 'colors', 'colours', 'display'], related: ['translation'] },
  { id: 'feed-mode', title: 'Default feed', description: 'Choose transparent Relevant, chronological Raw or Work for jobs and networking.', route: 'feed', ...home('default-feed'), path: ['Settings', 'Default feed'], keywords: ['feed mode', 'default feed', 'chronological feed', 'chronological', 'newest first', 'raw', 'relevant', 'work', 'jobs feed', 'networking', 'feed lens', 'lenses', 'my feed', 'feed filters'], related: ['feed-algorithm', 'feed-networks', 'web-feeds'] },
  { id: 'translation', title: 'Translate automatically', description: 'Show posts, comments, captions, events and messages in other languages in English automatically, with a note to see the original.', route: 'language', ...home('translation'), path: ['Settings', 'Translate automatically'], keywords: ['translate', 'translation', 'language', 'english', 'foreign language', 'show original', 'auto translate', 'spanish', 'portuguese', 'japanese'], related: ['appearance'] },
  { id: 'sign-out', title: 'Sign out', description: 'Sign out of Open Media on this device.', route: 'account', ...home('sign-out'), path: ['Settings', 'Sign out'], keywords: ['sign out', 'log out', 'logout', 'switch account'], related: ['password'] },

  // Settings › Account
  { id: 'password', title: 'Password', description: 'Set or change the password you sign in with on any device, instead of waiting for an email code.', route: 'security', ...on('account', 'security'), path: ['Settings', 'Account', 'Sign-in and security'], keywords: ['password', 'change password', 'set password', 'reset password', 'new password', 'sign in', 'login', 'log in', 'email code', 'security', 'account'], related: ['passkeys', 'sign-out'] },
  { id: 'passkeys', title: 'Passkeys', description: 'Add or remove passkeys, used as a second step after your password.', route: 'security', ...on('account', 'security'), path: ['Settings', 'Account', 'Sign-in and security'], keywords: ['passkey', 'passkeys', 'two factor', 'two-factor', '2fa', 'mfa', 'second step', 'face id', 'touch id', 'security key', 'webauthn'], related: ['password'] },
  { id: 'export', title: 'Export your data', description: 'Download a readable copy of your account. Encrypted mailbox credentials are never included.', route: 'data', ...on('account', 'your-data'), path: ['Settings', 'Account', 'Your data'], keywords: ['export my data', 'download my data', 'download', 'portability', 'backup', 'takeout', 'copy of my data', 'gdpr'], related: ['delete-account'] },
  { id: 'delete-account', title: 'Delete account', description: 'Permanently remove your profile, private mailbox data, authored messages and direct conversations.', route: 'account', ...on('account', 'delete-account'), path: ['Settings', 'Account', 'Delete account'], keywords: ['delete account', 'remove account', 'close account', 'deactivate', 'erase my data'], related: ['export'] },

  // Settings › Privacy and identity
  { id: 'privacy', title: 'Who can see your posts', description: 'Make your account private so only followers you approve see your posts, or public so anyone can read them.', route: 'privacy', ...on('privacy', 'identity'), path: ['Settings', 'Privacy and identity'], keywords: ['privacy', 'private', 'private account', 'public account', 'make account private', 'hide my posts', 'visibility', 'who can see', 'recommendation data', 'tracking'], related: ['identity-name', 'followers', 'read-receipts'] },
  { id: 'identity-name', title: 'Name others see', description: 'Choose the name shown on your posts, and verify your identity with Stripe Identity for the blue tick. Your legal name stays private unless you show it.', route: 'privacy', ...on('privacy', 'identity'), path: ['Settings', 'Privacy and identity'], keywords: ['shown name', 'real name', 'legal name', 'verify identity', 'verification', 'verified', 'blue tick', 'blue check', 'checkmark', 'stripe identity', 'id check'], related: ['privacy', 'edit-profile'] },
  { id: 'followers', title: 'Follower requests', description: 'With a private account, approve or decline people who ask to follow you.', route: 'privacy', ...on('privacy', 'identity'), path: ['Settings', 'Privacy and identity', 'Followers'], keywords: ['followers', 'follow requests', 'approve follower', 'remove follower', 'who follows me'], related: ['privacy'] },
  { id: 'read-receipts', title: 'Read receipts', description: 'Choose whether people see when you’ve read their messages. Receipts are mutual: off means you don’t see theirs either.', route: 'messages', ...on('privacy', 'read-receipts'), path: ['Settings', 'Privacy and identity', 'Read receipts'], keywords: ['read receipts', 'seen', 'message privacy', 'dm privacy', 'messages privacy', 'delivered'], related: ['privacy'] },

  // Settings › Payments and store
  { id: 'payments', title: 'Payments', description: 'Get paid by card with Stripe, link USDC wallets, and see your payment history.', route: 'payments', ...on('payments'), path: ['Settings', 'Payments'], keywords: ['payments', 'get paid', 'card payments', 'stripe', 'payouts', 'wallet', 'wallets', 'usdc', 'crypto', 'payment history', 'money', 'bank'], related: ['tips', 'store'] },
  { id: 'tips', title: 'Accept tips', description: 'Let people tip you from any of your posts, by card or USDC.', route: 'payments', ...on('payments'), path: ['Settings', 'Payments'], keywords: ['tips', 'tipping', 'accept tips', 'donations', 'support me'], related: ['payments'] },
  { id: 'store', title: 'Sell on ONDC (India)', description: 'Set up your ONDC store: category, time to ship, returns and cancellation.', route: 'store', ...on('store'), path: ['Settings', 'Sell on ONDC'], keywords: ['ondc', 'store', 'shop', 'sell', 'seller', 'india', 'returns', 'cancellation', 'shipping', 'products', 'listings'], related: ['payments'] },

  // Settings › Feed and posting
  { id: 'feed-algorithm', title: 'Your algorithm', description: 'See how your feed is ranked and change it in plain words (“a bit more about design”, “newest first”, “undo”).', route: 'feed', ...on('algorithm'), path: ['Settings', 'Your algorithm'], keywords: ['algorithm', 'my algorithm', 'write algorithm', 'tune feed', 'customize feed', 'customise feed', 'why am i seeing this', 'ranking', 'recommendations', 'less noisy', 'manifest', 'source code'], related: ['feed-mode', 'privacy'] },
  { id: 'feed-networks', title: 'Networks in Feed', description: 'Feed mixes public posts from Open Media, Bluesky, Mastodon, Nostr, Farcaster, Lens, Hive, and DeSo into one stream; say “less hive” to change the mix.', route: 'feed', ...on('algorithm'), path: ['Settings', 'Your algorithm'], keywords: ['blockchain', 'bluesky', 'mastodon', 'fediverse', 'nostr', 'farcaster', 'lens', 'hive', 'deso', 'web3', 'decentralized', 'sources'], related: ['feed-mode', 'cross-posting'] },
  { id: 'web-feeds', title: 'Web feeds (RSS, Atom, JSON Feed)', description: 'Follow blogs, news sites, podcasts and weather alerts in your Feed: type or paste a site in Search (“theverge.com”, “bbc”, “weather california”), “unfollow …” to stop, and “import opml” or “export opml” to move feeds between readers.', route: 'feed', ...on('algorithm'), path: ['Settings', 'Your algorithm'], keywords: ['rss', 'atom', 'json feed', 'web feeds', 'feed reader', 'subscribe', 'blogs', 'news', 'news channels', 'weather', 'weather alerts', 'podcasts', 'opml', 'import feeds', 'export feeds'], related: ['feed-mode'] },
  { id: 'cross-posting', title: 'Cross-posting', description: 'Connect Bluesky, Mastodon, Nostr, Farcaster, Lens, Hive, DeSo, X, Threads, LinkedIn, Instagram and Facebook; every post goes to all connected networks unless you turn one off.', route: 'cross-posting', ...on('cross-posting'), path: ['Settings', 'Cross-posting'], keywords: ['stop posting to farcaster', 'stop posting to linkedin', 'publish everywhere', 'destinations', 'connect bluesky', 'connect mastodon', 'connect nostr', 'connect farcaster', 'connect lens', 'connect hive', 'connect deso', 'connect x', 'connect twitter', 'connect threads', 'connect linkedin', 'connect instagram', 'connect facebook', 'fediverse', 'post everywhere', 'share to', 'connected apps', 'disconnect instagram'], related: ['connected-apps', 'people-accounts'] },

  // Settings › Email and chat apps
  { id: 'connected-apps', title: 'Email and chat apps', description: 'Connect email accounts and chat apps so they show up in Messages.', route: 'connected-apps', ...on('connections'), path: ['Settings', 'Email and chat apps'], keywords: ['connections', 'providers', 'integrations', 'linked apps'], related: ['email', 'chat-networks', 'cross-posting'] },
  { id: 'email', title: 'Email', description: 'Connect, sync and remove mail accounts: Gmail, iCloud, Yahoo, Fastmail, Zoho, or any IMAP/SMTP provider. Email shows up in Messages.', route: 'email', ...on('connections', 'email'), path: ['Settings', 'Email and chat apps', 'Email'], keywords: ['add email account', 'connect gmail', 'connect outlook', 'connect icloud', 'imap', 'pop', 'pop3', 'smtp', 'mail', 'mailbox', 'inbox', 'app password', 'sync email', 'remove mailbox', 'outgoing mail'], related: ['chat-networks', 'device-contacts'] },
  { id: 'chat-networks', title: 'Chat networks', description: 'Bring WhatsApp, Signal, Instagram, Messenger, Discord and other chat apps into Messages through opt-in bridges.', route: 'connected-apps', ...on('connections', 'chat-networks'), path: ['Settings', 'Email and chat apps', 'Chat networks'], keywords: ['whatsapp', 'signal', 'telegram', 'instagram dms', 'messenger', 'discord', 'slack', 'linkedin messages', 'bridges', 'bridged chats', 'beeper', 'disconnect whatsapp'], related: ['email', 'connected-apps'] },
  { id: 'device-contacts', title: 'Contacts on this device', description: 'Tidy email and phone formatting in your phone’s contacts. Every change is shown for review first. Phone app only.', route: 'contacts', ...on('connections', 'device-contacts'), path: ['Settings', 'Email and chat apps', 'Contacts'], keywords: ['phone contacts', 'address book', 'clean contacts', 'tidy contacts', 'contact cleanup', 'format phone numbers'], related: ['contacts', 'email'] },

  // Settings › Open Media AI, About
  { id: 'open-media-ai', title: 'Open Media AI', description: 'Add your own API key for ChatGPT, Claude, Gemini, OpenRouter, Groq, Mistral, DeepSeek or Grok, choose which model answers, or remove a key. Keys are encrypted and never shown again.', route: 'ai', ...on('ai'), path: ['Settings', 'Open Media AI'], keywords: ['api key', 'api keys', 'ai key', 'byok', 'bring your own key', 'openai', 'chatgpt', 'gpt', 'claude', 'anthropic', 'gemini', 'openrouter', 'groq', 'mistral', 'deepseek', 'grok', 'xai', 'llama', 'ai model', 'which model', 'who answers', 'ai chat', 'assistant'], related: ['developers'] },
  { id: 'mission', title: 'Our mission', description: 'Why Open Media exists, its principles, and where it is going.', route: 'about', ...on('mission'), path: ['Settings', 'Our mission'], keywords: ['about', 'mission', 'principles', 'roadmap', 'vision', 'open source'], related: ['developers'] },
  { id: 'developers', title: 'Developers and agents', description: 'Use Open Media from code or an AI assistant: APIs, MCP servers and your access token.', route: 'about', ...on('developers'), path: ['Settings', 'Developers and agents'], keywords: ['api', 'mcp', 'agent', 'ai assistant', 'claude', 'chatgpt', 'developer', 'token', 'access token', 'automation', 'llms.txt', 'plugin'], related: ['open-media-ai'] },

  // Profile
  { id: 'edit-profile', title: 'Edit profile', description: 'Change your name, picture, bio, location, links and the open networks shown on your profile.', route: 'profile', page: 'edit-profile', path: ['Profile', 'Edit profile'], keywords: ['profile picture', 'avatar', 'photo', 'change picture', 'display name', 'change my name', 'bio', 'about me', 'location', 'links', 'website', 'username', 'open networks'], related: ['professional', 'identity-name'] },
  { id: 'professional', title: 'Professional profile', description: 'Your headline, experience and skills, and whether you’re open to work or hiring. Type it in Search (“my headline is…”, “I’m open to work”) or ask an agent to import your resume or LinkedIn export.', route: 'profile', page: 'edit-profile', path: ['Profile', 'Edit profile', 'Work'], keywords: ['professional profile', 'headline', 'resume', 'cv', 'linkedin', 'open to work', 'hiring', 'jobs', 'job search', 'networking', 'career', 'work experience', 'experience', 'education', 'skills', 'projects', 'work status'], related: ['edit-profile', 'feed-mode'] },
  { id: 'people-accounts', title: 'Your accounts elsewhere', description: 'Link your accounts on other networks so people who know you there can find you here.', route: 'people', page: 'profile', anchor: 'people', path: ['Profile', 'Your accounts elsewhere'], keywords: ['linked accounts', 'other accounts', 'my accounts', 'bluesky handle', 'mastodon handle', 'find me', 'link account'], related: ['cross-posting', 'contacts'] },
  { id: 'contacts', title: 'Your contacts', description: 'See the people you saved and review suggested matches. Only you can see your contacts; a saved name shows everywhere.', route: 'contacts', page: 'profile', anchor: 'people', path: ['Profile', 'Your contacts'], keywords: ['contacts', 'people', 'address book', 'contact list', 'merge contacts', 'duplicates', 'saved contacts'], related: ['contacts-import', 'device-contacts', 'people-accounts'] },
  { id: 'contacts-import', title: 'Import contacts', description: 'Add contacts from your phone, the browser’s contact picker, or a vCard or CSV file from Apple, Google or Outlook. You review them before anything is saved.', route: 'contacts', page: 'profile', anchor: 'people', path: ['Profile', 'Your contacts'], keywords: ['import contacts', 'add contacts', 'vcard', 'vcf', 'csv contacts', 'upload contacts', 'google contacts', 'outlook contacts'], related: ['contacts', 'device-contacts'] },
];

const byId = new Map(settingIndex.map((entry) => [entry.id, entry]));

export function settingById(id: string): SettingIndexEntry | undefined {
  return byId.get(id);
}

/** “Profile › Sign-in and security”: where a setting is, as a person would read it. */
export function settingPath(entry: SettingIndexEntry): string {
  return entry.path.join(' › ');
}

/** The settings linked to this one, nearest first. */
export function relatedSettings(entry: SettingIndexEntry): SettingIndexEntry[] {
  return (entry.related ?? []).map((id) => byId.get(id)).filter((item): item is SettingIndexEntry => Boolean(item));
}

/** The entry Open Media AI's `open_settings` sections and older focus values stand for. */
const sectionEntries: Record<string, string> = {
  appearance: 'appearance', feed: 'feed-algorithm', language: 'translation', messages: 'read-receipts', email: 'email',
  'connected-apps': 'connected-apps', 'chat-networks': 'chat-networks', 'cross-posting': 'cross-posting', ai: 'open-media-ai',
  privacy: 'privacy', data: 'export', profile: 'edit-profile', about: 'mission', security: 'password', payments: 'payments',
  store: 'store', people: 'people-accounts', contacts: 'contacts', account: 'sign-out',
};

/** Resolves a setting id, or an AI section name like “feed”, to its entry. */
export function settingForSection(section: string): SettingIndexEntry | undefined {
  return byId.get(section) ?? byId.get(sectionEntries[section] ?? '');
}

// ---------------------------------------------------------------------------------------------
// Ranked search. The index is tokenized once, when this module loads; each search then scores
// every entry with plain string and set operations, so it stays fast enough to run on every key.

const stopWords = new Set(['a', 'an', 'the', 'to', 'my', 'i', 'me', 'use', 'show', 'please', 'how', 'do', 'can', 'where', 'is', 'are', 'of', 'for', 'in', 'on', 'turn', 'set', 'change', 'want', 'find', 'open', 'go', 'settings', 'setting']);

/** Words people use for the same thing. Each query word also matches its synonyms. */
const synonyms: Record<string, string[]> = {
  theme: ['appearance', 'dark', 'light'], night: ['dark'], colour: ['color'], colours: ['colors'],
  login: ['sign', 'password'], logon: ['sign'], signin: ['sign'], logout: ['sign', 'out'], pw: ['password'], pass: ['password'], pwd: ['password'],
  '2fa': ['passkeys'], mfa: ['passkeys'], authentication: ['password', 'passkeys'],
  avatar: ['picture', 'photo'], pfp: ['picture', 'photo'], photo: ['picture'], username: ['handle', 'name'],
  mail: ['email'], gmail: ['email'], outlook: ['email'], inbox: ['email'], mailbox: ['email'],
  dm: ['messages'], dms: ['messages'], chat: ['messages', 'chat'], chats: ['chat'],
  twitter: ['x'], fb: ['facebook'], ig: ['instagram'], insta: ['instagram'],
  pay: ['payments'], paid: ['payments'], money: ['payments'], crypto: ['wallets', 'usdc'], tip: ['tips'],
  delete: ['delete', 'remove'], remove: ['remove', 'delete'], erase: ['delete'],
  download: ['export'], backup: ['export'], ai: ['ai', 'model'], llm: ['ai', 'model'], key: ['key', 'api'],
  algo: ['algorithm'], ranking: ['algorithm'], timeline: ['feed'], language: ['translation', 'translate'],
  private: ['privacy', 'private'], visibility: ['privacy'], verify: ['verification', 'verified'], tick: ['verified'], check: ['verified'],
  shop: ['store'], sell: ['store'], contact: ['contacts'], vcard: ['vcf'],
};

interface IndexedEntry { entry: SettingIndexEntry; title: string; titleWords: Set<string>; keywords: string[]; words: Set<string>; text: string }

const words = (text: string) => text.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9.]+/).filter(Boolean);
/** Light stemming: “passkeys” and “passkey”, “translating” and “translate” match. */
const stem = (word: string) => word.length > 4 ? word.replace(/(ings?|ed|es|s)$/, '') : word;

const indexed: IndexedEntry[] = settingIndex.map((entry) => {
  const all = [entry.title, entry.description, ...entry.keywords, ...entry.path];
  const wordSet = new Set(all.flatMap(words).flatMap((word) => [word, stem(word)]));
  return {
    entry,
    title: entry.title.toLocaleLowerCase(),
    titleWords: new Set(words(entry.title).flatMap((word) => [word, stem(word)])),
    keywords: entry.keywords.map((keyword) => keyword.toLocaleLowerCase()),
    words: wordSet,
    text: all.join(' ').toLocaleLowerCase(),
  };
});

/** True when the two words are at most one edit apart (a typo: one letter added, missing, changed or swapped). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; }
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How well one query word matches an entry: 0 for no match. */
function wordScore(token: string, item: IndexedEntry, last: boolean): number {
  const variants = [token, stem(token), ...(synonyms[token] ?? [])];
  let best = 0;
  for (const variant of variants) {
    if (item.titleWords.has(variant)) best = Math.max(best, 6);
    else if (item.words.has(variant)) best = Math.max(best, 3);
  }
  if (best) return best;
  // The word still being typed matches the start of a word: “passw” finds Password.
  if (last && token.length >= 2) {
    for (const word of item.titleWords) if (word.startsWith(token)) return 4;
    for (const word of item.words) if (word.startsWith(token)) return 2;
  }
  // A typo in a longer word: “pasword”, “apperance”.
  if (token.length >= 5) for (const word of item.words) if (word.length >= 4 && oneEditApart(token, word)) return item.titleWords.has(word) ? 3 : 1.5;
  return 0;
}

/** Scores an entry against the query; 0 means it doesn't match. */
function scoreEntry(item: IndexedEntry, phrase: string, tokens: string[]): number {
  let score = 0;
  if (item.title === phrase) score += 40;
  else if (item.title.startsWith(phrase)) score += 24;
  else if (item.title.includes(phrase)) score += 14;
  if (item.keywords.includes(phrase)) score += 20;
  else if (phrase.length >= 3 && item.keywords.some((keyword) => keyword.startsWith(phrase) || keyword.includes(` ${phrase}`))) score += 8;
  if (phrase.length >= 3 && item.text.includes(phrase)) score += 4;
  if (!tokens.length) return score;
  let matched = 0;
  tokens.forEach((token, index) => {
    const value = wordScore(token, item, index === tokens.length - 1);
    if (value) { matched++; score += value; }
  });
  // Every meaningful word should match; one stray word in a longer sentence is forgiven.
  const allowedMisses = tokens.length >= 4 ? 1 : 0;
  if (tokens.length - matched > allowedMisses) return score >= 20 ? score : 0;
  return score;
}

/**
 * Settings that match a natural query (“dark mode”, “change my password”, “stop posting to
 * linkedin”), best first. Matches the exact phrase, every word, synonyms, a word still being typed
 * and small typos.
 */
export function searchSettings(query: string): SettingIndexEntry[] {
  const phrase = query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  if (!phrase) return settingIndex;
  const tokens = words(phrase).filter((token) => !stopWords.has(token));
  const ranked = indexed
    .map((item, order) => ({ item, order, score: scoreEntry(item, phrase, tokens) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  // Weak matches far below the best one are noise (“delete account” shouldn't offer Email).
  const floor = (ranked[0]?.score ?? 0) * 0.3;
  return ranked.filter((result) => result.score >= floor).map((result) => result.item.entry);
}

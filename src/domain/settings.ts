export type SettingRoute = 'appearance' | 'feed' | 'language' | 'messages' | 'email' | 'connected-apps' | 'cross-posting' | 'ai' | 'privacy' | 'data' | 'profile' | 'about';

export interface SettingIndexEntry {
  id: string;
  title: string;
  description: string;
  route: SettingRoute;
  keywords: string[];
}

export const settingIndex: SettingIndexEntry[] = [
  { id: 'appearance', title: 'Appearance', description: 'Use System, Light, or Dark appearance.', route: 'appearance', keywords: ['dark mode', 'light mode', 'theme', 'system'] },
  { id: 'feed-mode', title: 'Feed mode', description: 'Choose transparent Relevant, chronological Raw or Work for jobs and networking, and write your own algorithm in plain words under Your algorithm.', route: 'feed', keywords: ['chronological feed', 'raw', 'relevant', 'work', 'jobs feed', 'networking', 'algorithm', 'feed lens', 'lenses', 'my feed', 'feed filters', 'why am i seeing this', 'my algorithm', 'write algorithm', 'tune feed', 'customize feed'] },
  { id: 'professional', title: 'Professional profile', description: 'Your headline, experience and skills, and whether you’re open to work or hiring. Type it in Search (“my headline is…”, “I’m open to work”) or ask an agent to import your resume or LinkedIn export. Jobs and networking are in the Work feed.', route: 'profile', keywords: ['professional profile', 'headline', 'resume', 'cv', 'linkedin', 'open to work', 'hiring', 'jobs', 'job search', 'networking', 'career', 'work experience', 'skills'] },
  { id: 'translation', title: 'Translation', description: 'Show posts, comments, captions, events and messages in other languages in English automatically, with a note to see the original.', route: 'language', keywords: ['translate', 'translation', 'language', 'english', 'foreign language', 'show original', 'auto translate', 'spanish', 'portuguese', 'japanese'] },
  { id: 'message-privacy', title: 'Message privacy', description: 'Control who can message you.', route: 'messages', keywords: ['who can message me', 'direct messages', 'dm privacy'] },
  { id: 'email', title: 'Email', description: 'Connect and manage mail accounts.', route: 'email', keywords: ['connect gmail', 'connect outlook', 'imap', 'mail'] },
  { id: 'feed-networks', title: 'Networks in Feed', description: 'Feed mixes public posts from Open Media, Farcaster, Lens, Hive, and DeSo into one stream.', route: 'feed', keywords: ['blockchain', 'farcaster', 'lens', 'hive', 'deso', 'web3', 'decentralized', 'sources'] },
  { id: 'web-feeds', title: 'Web feeds (RSS, Atom, JSON Feed)', description: 'Follow blogs, news sites, podcasts and weather alerts in your Feed: type or paste a site in Search (“theverge.com”, “bbc”, “weather california”), “unfollow …” to stop, and “import opml” or “export opml” to move feeds between readers. Official feeds from major news outlets and weather services carry the blue tick.', route: 'feed', keywords: ['rss', 'atom', 'json feed', 'web feeds', 'feed reader', 'subscribe', 'blogs', 'news', 'news channels', 'weather', 'weather alerts', 'podcasts', 'opml', 'import feeds', 'export feeds'] },
  { id: 'connected-apps', title: 'Connected apps', description: 'Review authorized networks and capabilities.', route: 'connected-apps', keywords: ['disconnect instagram', 'connections', 'providers'] },
  { id: 'cross-posting', title: 'Cross-posting', description: 'Connect Farcaster, Lens, Hive, and DeSo; every post goes to all connected networks unless you turn one off.', route: 'cross-posting', keywords: ['stop posting to farcaster', 'publish everywhere', 'destinations', 'connect farcaster', 'connect lens', 'connect hive', 'connect deso', 'post everywhere'] },
  { id: 'open-media-ai', title: 'Open Media AI', description: 'Add your own API key for ChatGPT, Claude, Gemini, OpenRouter, Groq, Mistral, DeepSeek or Grok, choose which model answers, or remove a key. Keys are encrypted and never shown again.', route: 'ai', keywords: ['api key', 'api keys', 'ai key', 'byok', 'bring your own key', 'openai', 'chatgpt', 'gpt', 'claude', 'anthropic', 'gemini', 'openrouter', 'groq', 'mistral', 'deepseek', 'grok', 'xai', 'llama', 'ai model', 'which model', 'ai chat'] },
  { id: 'privacy', title: 'Privacy', description: 'Manage privacy and recommendation data boundaries.', route: 'privacy', keywords: ['private', 'recommendation data', 'tracking'] },
  { id: 'export', title: 'Export your data', description: 'Download portable account data.', route: 'data', keywords: ['export my data', 'download', 'portability'] },
  { id: 'chat-networks', title: 'Chat networks', description: 'Bring WhatsApp, Signal, Instagram, Messenger, Discord and other chat apps into Messages through opt-in bridges.', route: 'connected-apps', keywords: ['whatsapp', 'signal', 'telegram', 'instagram dms', 'messenger', 'discord', 'slack', 'linkedin messages', 'bridges', 'beeper'] },
  { id: 'mission', title: 'Our mission', description: 'Why Open Media exists, its principles, and where it is going.', route: 'about', keywords: ['about', 'mission', 'principles', 'roadmap', 'vision', 'open source'] },
  { id: 'developers', title: 'Developers and agents', description: 'Use Open Media from code or an AI assistant: APIs, MCP servers and your access token.', route: 'about', keywords: ['api', 'mcp', 'agent', 'ai assistant', 'claude', 'chatgpt', 'developer', 'token', 'automation', 'llms.txt'] },
];

export function searchSettings(query: string): SettingIndexEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return settingIndex;
  const meaningfulTokens = normalized.split(/\s+/).filter((token) => !['a', 'an', 'the', 'to', 'my', 'use', 'show', 'me', 'please'].includes(token));
  return settingIndex.filter((entry) => {
    const searchable = [entry.title, entry.description, ...entry.keywords].join(' ').toLocaleLowerCase();
    return searchable.includes(normalized) || meaningfulTokens.every((token) => searchable.includes(token));
  });
}

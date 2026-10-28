export type SettingRoute = 'appearance' | 'feed' | 'messages' | 'email' | 'connected-apps' | 'cross-posting' | 'privacy' | 'data' | 'about';

export interface SettingIndexEntry {
  id: string;
  title: string;
  description: string;
  route: SettingRoute;
  keywords: string[];
}

export const settingIndex: SettingIndexEntry[] = [
  { id: 'appearance', title: 'Appearance', description: 'Use System, Light, or Dark appearance.', route: 'appearance', keywords: ['dark mode', 'light mode', 'theme', 'system'] },
  { id: 'feed-mode', title: 'Feed mode', description: 'Choose transparent Relevant, chronological Raw, or a feed lens you describe in Search.', route: 'feed', keywords: ['chronological feed', 'raw', 'relevant', 'algorithm', 'feed lens', 'lenses', 'my feed', 'feed filters', 'why am i seeing this'] },
  { id: 'message-privacy', title: 'Message privacy', description: 'Control who can message you.', route: 'messages', keywords: ['who can message me', 'direct messages', 'dm privacy'] },
  { id: 'email', title: 'Email', description: 'Connect and manage mail accounts.', route: 'email', keywords: ['connect gmail', 'connect outlook', 'imap', 'mail'] },
  { id: 'feed-networks', title: 'Networks in Feed', description: 'Feed mixes public posts from Open Media, Farcaster, Lens, Hive, and DeSo into one stream.', route: 'feed', keywords: ['blockchain', 'farcaster', 'lens', 'hive', 'deso', 'web3', 'decentralized', 'sources'] },
  { id: 'connected-apps', title: 'Connected apps', description: 'Review authorized networks and capabilities.', route: 'connected-apps', keywords: ['disconnect instagram', 'connections', 'providers'] },
  { id: 'cross-posting', title: 'Cross-posting', description: 'Connect Farcaster, Lens, Hive, and DeSo; every post goes to all connected networks unless you turn one off.', route: 'cross-posting', keywords: ['stop posting to farcaster', 'publish everywhere', 'destinations', 'connect farcaster', 'connect lens', 'connect hive', 'connect deso', 'post everywhere'] },
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

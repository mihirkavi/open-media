export type SettingRoute = 'appearance' | 'feed' | 'messages' | 'email' | 'connected-apps' | 'cross-posting' | 'privacy' | 'data';

export interface SettingIndexEntry {
  id: string;
  title: string;
  description: string;
  route: SettingRoute;
  keywords: string[];
}

export const settingIndex: SettingIndexEntry[] = [
  { id: 'appearance', title: 'Appearance', description: 'Use System, Light, or Dark appearance.', route: 'appearance', keywords: ['dark mode', 'light mode', 'theme', 'system'] },
  { id: 'feed-mode', title: 'Feed mode', description: 'Choose transparent Relevant or chronological Raw.', route: 'feed', keywords: ['chronological feed', 'raw', 'relevant', 'algorithm'] },
  { id: 'message-privacy', title: 'Message privacy', description: 'Control who can message you.', route: 'messages', keywords: ['who can message me', 'direct messages', 'dm privacy'] },
  { id: 'email', title: 'Email', description: 'Connect and manage mail accounts.', route: 'email', keywords: ['connect gmail', 'connect outlook', 'imap', 'mail'] },
  { id: 'connected-apps', title: 'Connected apps', description: 'Review authorized networks and capabilities.', route: 'connected-apps', keywords: ['disconnect instagram', 'connections', 'providers'] },
  { id: 'cross-posting', title: 'Cross-posting', description: 'Choose default publish destinations.', route: 'cross-posting', keywords: ['stop posting to linkedin', 'publish everywhere', 'destinations'] },
  { id: 'privacy', title: 'Privacy', description: 'Manage privacy and recommendation data boundaries.', route: 'privacy', keywords: ['private', 'recommendation data', 'tracking'] },
  { id: 'export', title: 'Export your data', description: 'Download portable account data.', route: 'data', keywords: ['export my data', 'download', 'portability'] },
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

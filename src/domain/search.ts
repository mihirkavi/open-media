import { Conversation } from './models';
import { SocialPost } from './posts';
import { SettingIndexEntry, searchSettings } from './settings';
import { conversationTitle } from './selectors';

export type UniversalSearchResult =
  | { kind: 'post'; id: string; title: string; subtitle: string }
  | { kind: 'conversation'; id: string; title: string; subtitle: string }
  | { kind: 'setting'; id: string; title: string; subtitle: string; setting: SettingIndexEntry };

export function universalSearch(query: string, posts: SocialPost[], conversations: Conversation[]): UniversalSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const postResults: UniversalSearchResult[] = posts
    .filter((post) => [post.author.displayName, post.author.handle, post.body, ...post.topics].join(' ').toLocaleLowerCase().includes(normalized))
    .map((post) => ({ kind: 'post', id: post.id, title: post.author.displayName, subtitle: post.body }));
  const conversationResults: UniversalSearchResult[] = conversations
    .filter((conversation) => [conversationTitle(conversation), conversation.preview, ...conversation.messages.map((message) => message.body)].join(' ').toLocaleLowerCase().includes(normalized))
    .map((conversation) => ({ kind: 'conversation', id: conversation.id, title: conversationTitle(conversation), subtitle: conversation.preview }));
  const settingResults: UniversalSearchResult[] = searchSettings(normalized)
    .map((setting) => ({ kind: 'setting', id: setting.id, title: setting.title, subtitle: setting.description, setting }));
  return [...settingResults, ...conversationResults, ...postResults].slice(0, 24);
}

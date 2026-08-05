import { Conversation } from './models';

export interface ConversationFilters {
  accountId: string | 'all';
  query: string;
  unreadOnly: boolean;
}

export function filterConversations(
  conversations: Conversation[],
  filters: ConversationFilters,
): Conversation[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return conversations
    .filter((conversation) => filters.accountId === 'all' || conversation.accountId === filters.accountId)
    .filter((conversation) => !filters.unreadOnly || conversation.unreadCount > 0)
    .filter((conversation) => {
      if (!normalizedQuery) return true;
      const searchable = [
        conversation.subject,
        conversation.preview,
        ...conversation.participants.flatMap((participant) => [participant.name, participant.address]),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    })
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

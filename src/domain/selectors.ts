import { Conversation, PeopleFilter } from './models';

export interface ConversationFilters {
  peopleFilter: PeopleFilter;
  query: string;
  unreadOnly: boolean;
}

export function filterConversations(
  conversations: Conversation[],
  filters: ConversationFilters,
): Conversation[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return conversations
    .filter((conversation) => {
      if (filters.peopleFilter === 'direct') return conversation.participants.length === 1;
      if (filters.peopleFilter === 'groups') return conversation.participants.length > 1;
      if (filters.peopleFilter === 'favorites') return conversation.participants.some((person) => person.favorite);
      return true;
    })
    .filter((conversation) => !filters.unreadOnly || conversation.unreadCount > 0)
    .filter((conversation) => {
      if (!normalizedQuery) return true;
      const searchable = [
        conversation.groupTitle,
        conversation.preview,
        ...conversation.labels,
        ...conversation.participants.flatMap((person) => [
          person.name,
          ...person.identities.flatMap((identity) => [identity.value, identity.label, identity.source]),
        ]),
        ...conversation.messages.flatMap((message) => [message.body, message.emailContext?.subject]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    })
    // Newest first, with the Open Media AI chat pinned on top (ADR 0028).
    .sort((a, b) => Number(b.sourceSummary.includes('ai')) - Number(a.sourceSummary.includes('ai')) || Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

export function conversationTitle(conversation: Conversation): string {
  return conversation.groupTitle ?? conversation.participants.map((person) => person.name).join(', ');
}

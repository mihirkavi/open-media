import { chatNetwork, chatNetworks } from './chatNetworks';
import { BridgedNetwork, Conversation, Message, MessageSource, Person } from './models';

/** Bridged chats (ADR 0011) as people-first conversations. */

export interface BridgeRoomSnapshot {
  id: string;
  network: string;
  name: string;
  members: { id: string; displayName: string }[];
  events: { id: string; sender: string; body: string; timestamp: number }[];
}

export interface BridgeSnapshot {
  userId: string;
  rooms: BridgeRoomSnapshot[];
}

const bridged = new Set<MessageSource>(chatNetworks.map((network) => network.id));

export function bridgedSourceOf(conversation: Conversation): BridgedNetwork | undefined {
  return conversation.sourceSummary.find((item) => bridged.has(item)) as BridgedNetwork | undefined;
}

export function mapBridgeSnapshot(snapshot: BridgeSnapshot): Conversation[] {
  return snapshot.rooms.flatMap((room) => {
    const network = chatNetwork(room.network);
    if (!network) return [];
    const source: MessageSource = network.id;
    const label = network.name;
    const participants = room.members.map((member) => person(member, source, label));
    const recipientIds = room.members.map((member) => member.id);
    const messages = [...room.events]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((event): Message => {
        const outbound = event.sender === snapshot.userId;
        return {
          id: event.id,
          sourceMessageId: event.id,
          conversationId: room.id,
          senderPersonId: event.sender,
          senderIdentityId: `${source}-${event.sender}`,
          recipientPersonIds: outbound ? recipientIds : [snapshot.userId],
          sentAt: new Date(event.timestamp).toISOString(),
          body: event.body,
          source,
          channel: 'native',
          direction: outbound ? 'outbound' : 'inbound',
          deliveryState: outbound ? 'sent' : 'received',
        };
      });
    const latest = messages[messages.length - 1];
    const group = room.members.length > 1;
    return [{
      id: room.id,
      participants,
      messages,
      sourceSummary: [source],
      lastMessageAt: latest?.sentAt ?? new Date(0).toISOString(),
      preview: latest?.body ?? `${label} chat connected.`,
      unreadCount: 0,
      groupTitle: group ? room.name : undefined,
      labels: group ? [label, 'Group'] : [label],
    } satisfies Conversation];
  }).sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
}

function person(member: { id: string; displayName: string }, source: MessageSource, label: string): Person {
  const name = member.displayName || label;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
  return {
    id: member.id,
    name,
    initials,
    avatarColor: '#525252',
    identities: [{ id: `${source}-${member.id}`, personId: member.id, kind: 'handle', value: name, source, label, verifiedByUser: false }],
  };
}

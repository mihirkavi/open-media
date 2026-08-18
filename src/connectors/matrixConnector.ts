import { Conversation, Message, Person } from '../domain/models';

export interface MatrixMemberSnapshot {
  id: string;
  displayName: string;
}

export interface MatrixEventSnapshot {
  id: string;
  sender: string;
  body: string;
  timestamp: number;
}

export interface MatrixRoomSnapshot {
  id: string;
  name: string;
  members: MatrixMemberSnapshot[];
  events: MatrixEventSnapshot[];
}

export interface MatrixSnapshot {
  userId: string;
  rooms: MatrixRoomSnapshot[];
}

function bridgeURL(): string {
  const configured = process.env.EXPO_PUBLIC_MATRIX_BRIDGE_URL?.replace(/\/$/, '');
  if (!configured) throw new Error('The Matrix bridge is not configured for this build.');
  return configured;
}

export async function loadMatrixConversations(): Promise<Conversation[]> {
  const response = await fetch(`${bridgeURL()}/v1/matrix/snapshot`);
  if (!response.ok) throw new Error(await matrixError(response, 'Could not load Matrix conversations.'));
  return mapMatrixSnapshot(await response.json() as MatrixSnapshot);
}

export async function sendMatrixMessage(conversationId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  if (trimmed.length > 8000) throw new Error('Messages can be up to 8,000 characters.');
  const response = await fetch(`${bridgeURL()}/v1/matrix/rooms/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: trimmed }),
  });
  if (!response.ok) throw new Error(await matrixError(response, 'Matrix could not send the message.'));
}

export function mapMatrixSnapshot(snapshot: MatrixSnapshot): Conversation[] {
  return snapshot.rooms.map((room) => {
    const otherMembers = room.members.filter((member) => member.id !== snapshot.userId);
    const participants = otherMembers.map(personFromMember);
    const recipientIds = otherMembers.map((member) => member.id);
    const messages = room.events
      .filter((event) => event.body.trim())
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((event) => messageFromEvent(room.id, event, snapshot.userId, recipientIds));
    const latest = messages[messages.length - 1];
    const fallbackTime = new Date(0).toISOString();
    const group = room.members.length > 2;
    return {
      id: room.id,
      participants,
      messages,
      sourceSummary: ['matrix'],
      lastMessageAt: latest?.sentAt ?? fallbackTime,
      preview: latest?.body ?? 'Matrix room connected.',
      unreadCount: 0,
      groupTitle: group ? room.name : undefined,
      labels: group ? ['Matrix', 'Group'] : ['Matrix'],
    } satisfies Conversation;
  }).sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
}

function personFromMember(member: MatrixMemberSnapshot): Person {
  const displayName = member.displayName || member.id;
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'MX';
  return {
    id: member.id,
    name: displayName,
    initials,
    avatarColor: '#0D9488',
    identities: [{ id: `matrix-${member.id}`, personId: member.id, kind: 'handle', value: member.id, source: 'matrix', label: 'Matrix', verifiedByUser: false }],
  };
}

function messageFromEvent(roomId: string, event: MatrixEventSnapshot, currentUserId: string, recipientIds: string[]): Message {
  const outbound = event.sender === currentUserId;
  return {
    id: event.id,
    sourceMessageId: event.id,
    conversationId: roomId,
    senderPersonId: event.sender,
    senderIdentityId: `matrix-${event.sender}`,
    recipientPersonIds: recipientIds,
    sentAt: new Date(event.timestamp).toISOString(),
    body: event.body,
    source: 'matrix',
    channel: 'native',
    direction: outbound ? 'outbound' : 'inbound',
    deliveryState: outbound ? 'sent' : 'received',
  };
}

async function matrixError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

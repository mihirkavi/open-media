import { Account, Conversation, Participant } from '../domain/models';
import { colors } from '../theme';

const mihir: Participant = {
  id: 'me',
  name: 'Mihir',
  address: 'mihir@example.com',
  initials: 'MK',
  avatarColor: '#292D36',
};

const people = {
  maya: { id: 'maya', name: 'Maya Chen', address: 'maya@example.com', initials: 'MC', avatarColor: '#7B61FF' },
  jon: { id: 'jon', name: 'Jon Bell', address: 'jon@example.com', initials: 'JB', avatarColor: '#EB5757' },
  priya: { id: 'priya', name: 'Priya Shah', address: 'priya@example.com', initials: 'PS', avatarColor: '#F2994A' },
  alex: { id: 'alex', name: 'Alex Morgan', address: 'alex@example.com', initials: 'AM', avatarColor: '#27AE60' },
  studio: { id: 'studio', name: 'North Studio', address: 'hello@north.example', initials: 'NS', avatarColor: '#2F80ED' },
  ben: { id: 'ben', name: 'Ben Carter', address: 'ben@example.com', initials: 'BC', avatarColor: '#00A6A6' },
} satisfies Record<string, Participant>;

export const mockAccounts: Account[] = [
  {
    id: 'account-icloud',
    label: 'iCloud Mail',
    address: 'mihir@icloud.example',
    source: 'icloud',
    status: 'mock',
    unreadCount: 4,
    color: colors.icloud,
  },
  {
    id: 'account-gmail',
    label: 'Gmail',
    address: 'mihir@gmail.example',
    source: 'gmail',
    status: 'mock',
    unreadCount: 2,
    color: colors.gmail,
  },
];

export const mockConversations: Conversation[] = [
  {
    id: 'weekend-trails',
    accountId: 'account-icloud',
    source: 'icloud',
    subject: 'Saturday trail plan',
    participants: [people.maya, people.jon],
    lastMessageAt: '2026-08-04T18:42:00-07:00',
    preview: 'Maya: Perfect. I’ll bring coffee — meet at the north lot?',
    unreadCount: 2,
    starred: true,
    labels: ['Personal'],
    messages: [
      {
        id: 'trail-1', sourceMessageId: 'mock-trail-1', conversationId: 'weekend-trails', sender: mihir,
        recipients: [people.maya, people.jon], sentAt: '2026-08-04T16:04:00-07:00', direction: 'outbound', deliveryState: 'sent',
        body: 'Thinking the Ridge Loop on Saturday. Early start so we beat the heat?',
      },
      {
        id: 'trail-2', sourceMessageId: 'mock-trail-2', conversationId: 'weekend-trails', sender: people.jon,
        recipients: [mihir, people.maya], sentAt: '2026-08-04T16:22:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'I’m in. 8:00 works for me, and I can drive from the city.',
      },
      {
        id: 'trail-3', sourceMessageId: 'mock-trail-3', conversationId: 'weekend-trails', sender: people.maya,
        recipients: [mihir, people.jon], sentAt: '2026-08-04T18:42:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'Perfect. I’ll bring coffee — meet at the north lot?',
      },
    ],
  },
  {
    id: 'design-review',
    accountId: 'account-gmail',
    source: 'gmail',
    subject: 'Convo interface direction',
    participants: [people.priya],
    lastMessageAt: '2026-08-04T14:18:00-07:00',
    preview: 'The calmer hierarchy is working. Let’s keep the source cues subtle.',
    unreadCount: 1,
    labels: ['Work', 'Design'],
    messages: [
      {
        id: 'design-1', sourceMessageId: 'mock-design-1', conversationId: 'design-review', sender: people.priya,
        recipients: [mihir], sentAt: '2026-08-04T12:06:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'I reviewed the first pass. The unified thread idea feels much more natural than separating every service into tabs.',
      },
      {
        id: 'design-2', sourceMessageId: 'mock-design-2', conversationId: 'design-review', sender: mihir,
        recipients: [people.priya], sentAt: '2026-08-04T13:31:00-07:00', direction: 'outbound', deliveryState: 'sent',
        body: 'Agreed. I’m treating source as useful context, not the organizing principle. Conversations should lead.',
      },
      {
        id: 'design-3', sourceMessageId: 'mock-design-3', conversationId: 'design-review', sender: people.priya,
        recipients: [mihir], sentAt: '2026-08-04T14:18:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'The calmer hierarchy is working. Let’s keep the source cues subtle and make unread state unmistakable.',
      },
    ],
  },
  {
    id: 'dinner',
    accountId: 'account-icloud',
    source: 'icloud',
    subject: 'Dinner next week',
    participants: [people.alex],
    lastMessageAt: '2026-08-03T20:11:00-07:00',
    preview: 'Thursday is great. I booked the little place on Valencia for 7.',
    unreadCount: 0,
    labels: ['Personal'],
    messages: [
      {
        id: 'dinner-1', sourceMessageId: 'mock-dinner-1', conversationId: 'dinner', sender: people.alex,
        recipients: [mihir], sentAt: '2026-08-03T19:47:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'Are you around Wednesday or Thursday for dinner next week?',
      },
      {
        id: 'dinner-2', sourceMessageId: 'mock-dinner-2', conversationId: 'dinner', sender: mihir,
        recipients: [people.alex], sentAt: '2026-08-03T19:55:00-07:00', direction: 'outbound', deliveryState: 'sent',
        body: 'Thursday would be perfect. Somewhere around the Mission?',
      },
      {
        id: 'dinner-3', sourceMessageId: 'mock-dinner-3', conversationId: 'dinner', sender: people.alex,
        recipients: [mihir], sentAt: '2026-08-03T20:11:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'Thursday is great. I booked the little place on Valencia for 7.',
      },
    ],
  },
  {
    id: 'brand-files',
    accountId: 'account-gmail',
    source: 'gmail',
    subject: 'Final brand files',
    participants: [people.studio],
    lastMessageAt: '2026-08-03T15:09:00-07:00',
    preview: 'Everything is in the shared folder. The compact mark is included.',
    unreadCount: 0,
    labels: ['Work'],
    messages: [
      {
        id: 'brand-1', sourceMessageId: 'mock-brand-1', conversationId: 'brand-files', sender: people.studio,
        recipients: [mihir], sentAt: '2026-08-03T15:09:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'Everything is in the shared folder. The compact mark, color tokens, and export notes are all included.',
      },
    ],
  },
  {
    id: 'intro',
    accountId: 'account-icloud',
    source: 'icloud',
    subject: 'Introduction: Ben × Mihir',
    participants: [people.ben],
    lastMessageAt: '2026-08-02T10:34:00-07:00',
    preview: 'Thanks for the intro. Your take on message interoperability resonated.',
    unreadCount: 2,
    labels: ['Networking'],
    messages: [
      {
        id: 'intro-1', sourceMessageId: 'mock-intro-1', conversationId: 'intro', sender: people.ben,
        recipients: [mihir], sentAt: '2026-08-02T10:34:00-07:00', direction: 'inbound', deliveryState: 'received',
        body: 'Thanks for the intro. Your take on message interoperability resonated — I’d enjoy comparing notes sometime.',
      },
    ],
  },
];

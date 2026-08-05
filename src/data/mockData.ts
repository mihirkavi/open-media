import { Account, Conversation, Person } from '../domain/models';

export const currentUser: Person = {
  id: 'me',
  name: 'Mihir',
  initials: 'MK',
  avatarColor: '#292D36',
  identities: [
    { id: 'me-gmail', personId: 'me', kind: 'email', value: 'mihir@gmail.example', source: 'gmail', label: 'Gmail', verifiedByUser: true },
    { id: 'me-icloud', personId: 'me', kind: 'email', value: 'mihir@icloud.example', source: 'icloud', label: 'iCloud', verifiedByUser: true },
    { id: 'me-instagram', personId: 'me', kind: 'handle', value: '@mihir.demo', source: 'instagram', label: 'Instagram', verifiedByUser: true },
    { id: 'me-sms', personId: 'me', kind: 'phone', value: '+1 555 010 0199', source: 'sms', label: 'Mobile', verifiedByUser: true },
  ],
};

export const mockPeople = {
  maya: {
    id: 'maya', name: 'Maya Chen', initials: 'MC', avatarColor: '#7B61FF', favorite: true,
    identities: [
      { id: 'maya-gmail', personId: 'maya', kind: 'email', value: 'maya.chen@example.com', source: 'gmail', label: 'Work email', verifiedByUser: true },
      { id: 'maya-icloud', personId: 'maya', kind: 'email', value: 'maya.weekends@example.com', source: 'icloud', label: 'Personal email', verifiedByUser: true },
      { id: 'maya-instagram', personId: 'maya', kind: 'handle', value: '@mayawanders', source: 'instagram', label: 'Instagram', verifiedByUser: true },
    ],
  },
  jon: {
    id: 'jon', name: 'Jon Bell', initials: 'JB', avatarColor: '#EB5757',
    identities: [
      { id: 'jon-icloud', personId: 'jon', kind: 'email', value: 'jon@example.com', source: 'icloud', label: 'Email', verifiedByUser: true },
      { id: 'jon-instagram', personId: 'jon', kind: 'handle', value: '@jonoutside', source: 'instagram', label: 'Instagram', verifiedByUser: true },
    ],
  },
  priya: {
    id: 'priya', name: 'Priya Shah', initials: 'PS', avatarColor: '#F2994A', favorite: true,
    identities: [
      { id: 'priya-gmail', personId: 'priya', kind: 'email', value: 'priya@example.com', source: 'gmail', label: 'Email', verifiedByUser: true },
      { id: 'priya-linkedin', personId: 'priya', kind: 'handle', value: 'priya-shah-demo', source: 'linkedin', label: 'LinkedIn', verifiedByUser: true },
    ],
  },
  alex: {
    id: 'alex', name: 'Alex Morgan', initials: 'AM', avatarColor: '#27AE60',
    identities: [
      { id: 'alex-snapchat', personId: 'alex', kind: 'handle', value: 'alex-demo', source: 'snapchat', label: 'Snapchat', verifiedByUser: true },
      { id: 'alex-sms', personId: 'alex', kind: 'phone', value: '+1 555 010 0142', source: 'sms', label: 'Mobile', verifiedByUser: true },
    ],
  },
  studio: {
    id: 'studio', name: 'North Studio', initials: 'NS', avatarColor: '#2F80ED',
    identities: [
      { id: 'studio-imap', personId: 'studio', kind: 'email', value: 'hello@north.example', source: 'imap', label: 'Studio email', verifiedByUser: true },
    ],
  },
} satisfies Record<string, Person>;

/** Mock connector accounts only. They never drive the people-first inbox UI. */
export const mockAccounts: Account[] = [
  { id: 'account-icloud', label: 'iCloud Mail', address: 'mihir@icloud.example', source: 'icloud', status: 'mock' },
  { id: 'account-gmail', label: 'Gmail', address: 'mihir@gmail.example', source: 'gmail', status: 'mock' },
];

export const mockConversations: Conversation[] = [
  {
    id: 'maya-direct',
    participants: [mockPeople.maya],
    sourceSummary: ['gmail', 'instagram', 'icloud'],
    lastMessageAt: '2026-08-04T18:42:00-07:00',
    preview: 'Perfect. I’ll bring coffee — north lot at 8?',
    unreadCount: 3,
    starred: true,
    labels: ['Friends'],
    messages: [
      {
        id: 'maya-1', sourceMessageId: 'mock-maya-mail-1', conversationId: 'maya-direct', senderPersonId: 'maya', senderIdentityId: 'maya-gmail', recipientPersonIds: ['me'],
        sentAt: '2026-08-04T09:08:00-07:00', body: 'The quieter hierarchy is working. I left two notes on the conversation header.', source: 'gmail', channel: 'email',
        emailContext: { providerThreadId: 'mock-design-thread', subject: 'Convo interface notes' }, direction: 'inbound', deliveryState: 'received',
      },
      {
        id: 'maya-2', sourceMessageId: 'mock-maya-mail-2', conversationId: 'maya-direct', senderPersonId: 'me', senderIdentityId: 'me-gmail', recipientPersonIds: ['maya'],
        sentAt: '2026-08-04T09:31:00-07:00', body: 'Saw them. I’m making people the stable layer and treating providers as message metadata.', source: 'gmail', channel: 'email',
        emailContext: { providerThreadId: 'mock-design-thread', subject: 'Convo interface notes' }, direction: 'outbound', deliveryState: 'sent',
      },
      {
        id: 'maya-3', sourceMessageId: 'mock-maya-ig-1', conversationId: 'maya-direct', senderPersonId: 'maya', senderIdentityId: 'maya-instagram', recipientPersonIds: ['me'],
        sentAt: '2026-08-04T11:12:00-07:00', body: 'This is exactly how I want it to feel — one chat, wherever we happened to talk.', source: 'instagram', channel: 'social', direction: 'inbound', deliveryState: 'received',
      },
      {
        id: 'maya-4', sourceMessageId: 'mock-maya-mail-3', conversationId: 'maya-direct', senderPersonId: 'maya', senderIdentityId: 'maya-icloud', recipientPersonIds: ['me'],
        sentAt: '2026-08-04T15:46:00-07:00', body: 'Thinking the Ridge Loop on Saturday. Early start so we beat the heat?', source: 'icloud', channel: 'email',
        emailContext: { providerThreadId: 'mock-trail-thread', subject: 'Saturday trail plan' }, direction: 'inbound', deliveryState: 'received',
      },
      {
        id: 'maya-5', sourceMessageId: 'mock-maya-mail-4', conversationId: 'maya-direct', senderPersonId: 'me', senderIdentityId: 'me-icloud', recipientPersonIds: ['maya'],
        sentAt: '2026-08-04T16:04:00-07:00', body: 'Yes. 8:00 works, and I can bring an extra water bottle.', source: 'icloud', channel: 'email',
        emailContext: { providerThreadId: 'mock-trail-thread', subject: 'Saturday trail plan' }, direction: 'outbound', deliveryState: 'sent',
      },
      {
        id: 'maya-6', sourceMessageId: 'mock-maya-ig-2', conversationId: 'maya-direct', senderPersonId: 'maya', senderIdentityId: 'maya-instagram', recipientPersonIds: ['me'],
        sentAt: '2026-08-04T18:42:00-07:00', body: 'Perfect. I’ll bring coffee — north lot at 8?', source: 'instagram', channel: 'social', direction: 'inbound', deliveryState: 'received',
      },
    ],
  },
  {
    id: 'trail-group',
    groupTitle: 'Weekend trail crew',
    participants: [mockPeople.maya, mockPeople.jon],
    sourceSummary: ['instagram', 'icloud'],
    lastMessageAt: '2026-08-04T16:22:00-07:00',
    preview: 'Jon: I can drive from the city.',
    unreadCount: 1,
    labels: ['Group', 'Friends'],
    messages: [
      {
        id: 'group-1', sourceMessageId: 'mock-group-ig-1', conversationId: 'trail-group', senderPersonId: 'maya', senderIdentityId: 'maya-instagram', recipientPersonIds: ['me', 'jon'],
        sentAt: '2026-08-04T15:58:00-07:00', body: 'Starting a tiny trail crew thread so nobody misses the plan.', source: 'instagram', channel: 'social', direction: 'inbound', deliveryState: 'received',
      },
      {
        id: 'group-2', sourceMessageId: 'mock-group-mail-1', conversationId: 'trail-group', senderPersonId: 'jon', senderIdentityId: 'jon-icloud', recipientPersonIds: ['me', 'maya'],
        sentAt: '2026-08-04T16:22:00-07:00', body: 'I can drive from the city. Send me the north lot pin when you have it.', source: 'icloud', channel: 'email',
        emailContext: { providerThreadId: 'mock-group-trail-email', subject: 'Ridge Loop logistics' }, direction: 'inbound', deliveryState: 'received',
      },
    ],
  },
  {
    id: 'priya-direct',
    participants: [mockPeople.priya],
    sourceSummary: ['linkedin', 'gmail'],
    lastMessageAt: '2026-08-04T14:18:00-07:00',
    preview: 'The product story is much sharper when it starts with people.',
    unreadCount: 1,
    labels: ['Work'],
    messages: [
      {
        id: 'priya-1', sourceMessageId: 'mock-priya-linkedin-1', conversationId: 'priya-direct', senderPersonId: 'priya', senderIdentityId: 'priya-linkedin', recipientPersonIds: ['me'],
        sentAt: '2026-08-04T12:06:00-07:00', body: 'The product story is much sharper when it starts with people, not inboxes.', source: 'linkedin', channel: 'social', direction: 'inbound', deliveryState: 'received',
      },
      {
        id: 'priya-2', sourceMessageId: 'mock-priya-mail-1', conversationId: 'priya-direct', senderPersonId: 'me', senderIdentityId: 'me-gmail', recipientPersonIds: ['priya'],
        sentAt: '2026-08-04T13:31:00-07:00', body: 'Agreed. I’m also making identity matches reviewable so convenience never creates a false merge.', source: 'gmail', channel: 'email',
        emailContext: { providerThreadId: 'mock-priya-email', subject: 'People-first product direction' }, direction: 'outbound', deliveryState: 'sent',
      },
      {
        id: 'priya-3', sourceMessageId: 'mock-priya-mail-2', conversationId: 'priya-direct', senderPersonId: 'priya', senderIdentityId: 'priya-gmail', recipientPersonIds: ['me'],
        sentAt: '2026-08-04T14:18:00-07:00', body: 'That safeguard belongs in the product story too. Trust is the feature.', source: 'gmail', channel: 'email',
        emailContext: { providerThreadId: 'mock-priya-email', subject: 'People-first product direction' }, direction: 'inbound', deliveryState: 'received',
      },
    ],
  },
  {
    id: 'alex-direct',
    participants: [mockPeople.alex],
    sourceSummary: ['snapchat', 'sms'],
    lastMessageAt: '2026-08-03T20:11:00-07:00',
    preview: 'Thursday is great. I booked the little place on Valencia for 7.',
    unreadCount: 0,
    labels: ['Friends'],
    messages: [
      {
        id: 'alex-1', sourceMessageId: 'mock-alex-snap-1', conversationId: 'alex-direct', senderPersonId: 'alex', senderIdentityId: 'alex-snapchat', recipientPersonIds: ['me'],
        sentAt: '2026-08-03T19:47:00-07:00', body: 'Are you around Wednesday or Thursday for dinner next week?', source: 'snapchat', channel: 'social', direction: 'inbound', deliveryState: 'received',
      },
      {
        id: 'alex-2', sourceMessageId: 'mock-alex-sms-1', conversationId: 'alex-direct', senderPersonId: 'me', senderIdentityId: 'me-sms', recipientPersonIds: ['alex'],
        sentAt: '2026-08-03T19:55:00-07:00', body: 'Thursday would be perfect. Somewhere around the Mission?', source: 'sms', channel: 'sms', direction: 'outbound', deliveryState: 'sent',
      },
      {
        id: 'alex-3', sourceMessageId: 'mock-alex-sms-2', conversationId: 'alex-direct', senderPersonId: 'alex', senderIdentityId: 'alex-sms', recipientPersonIds: ['me'],
        sentAt: '2026-08-03T20:11:00-07:00', body: 'Thursday is great. I booked the little place on Valencia for 7.', source: 'sms', channel: 'sms', direction: 'inbound', deliveryState: 'received',
      },
    ],
  },
  {
    id: 'studio-direct',
    participants: [mockPeople.studio],
    sourceSummary: ['imap'],
    lastMessageAt: '2026-08-03T15:09:00-07:00',
    preview: 'Everything is in the shared folder. The compact mark is included.',
    unreadCount: 0,
    labels: ['Work'],
    messages: [
      {
        id: 'studio-1', sourceMessageId: 'mock-studio-mail-1', conversationId: 'studio-direct', senderPersonId: 'studio', senderIdentityId: 'studio-imap', recipientPersonIds: ['me'],
        sentAt: '2026-08-03T15:09:00-07:00', body: 'Everything is in the shared folder. The compact mark, color tokens, and export notes are all included.', source: 'imap', channel: 'email',
        emailContext: { providerThreadId: 'mock-brand-thread', subject: 'Final brand files' }, direction: 'inbound', deliveryState: 'received',
      },
    ],
  },
];

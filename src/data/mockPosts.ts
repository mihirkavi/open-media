import { SocialPost } from '../domain/posts';

/** Fictional local content used until authenticated feed connectors exist. */
export const mockPosts: SocialPost[] = [
  {
    id: 'post-open-protocols',
    author: { id: 'maya', displayName: 'Maya Chen', handle: '@mayawanders', initials: 'MC' },
    body: 'The best protocol disappears into a calm product. People should feel portability before they ever have to learn the word interoperability.',
    kind: 'text', createdAt: '2026-08-15T15:34:00-07:00', topics: ['open-web', 'design'],
    provenance: { connectorId: 'open-media' }, engagement: { replies: 18, reposts: 42, likes: 311 },
    relevance: { followsAuthor: true, selectedInterestMatches: ['design', 'open web'] },
  },
  {
    id: 'post-ocean-clip',
    author: { id: 'jon', displayName: 'Jon Bell', handle: '@jonoutside', initials: 'JB' },
    body: 'A quiet sixty seconds above the Pacific.', kind: 'video', createdAt: '2026-08-15T14:02:00-07:00', topics: ['outdoors'],
    media: [{ kind: 'video', aspectRatio: 9 / 16, durationSeconds: 58, altText: 'Golden coastal cliffs above the Pacific Ocean at sunset.' }],
    provenance: { connectorId: 'activitypub', externalId: 'demo-jon-42' }, engagement: { replies: 7, reposts: 19, likes: 204 },
    relevance: { followsAuthor: true, selectedInterestMatches: ['outdoors'] },
  },
  {
    id: 'post-community',
    author: { id: 'priya', displayName: 'Priya Shah', handle: '@priyashah', initials: 'PS' },
    body: 'Small communities become durable when leaving is possible and belonging is still worth choosing.',
    kind: 'text', createdAt: '2026-08-15T12:18:00-07:00', topics: ['communities'],
    provenance: { connectorId: 'atproto', externalId: 'demo-priya-8' }, engagement: { replies: 31, reposts: 55, likes: 428 },
    relevance: { followsAuthor: false, selectedInterestMatches: ['communities'], communityMatch: 'Open Social Builders' },
  },
  {
    id: 'post-studio-clip',
    author: { id: 'studio', displayName: 'North Studio', handle: '@northstudio', initials: 'NS' },
    body: 'From sketch to type system in forty-five seconds.', kind: 'video', createdAt: '2026-08-15T10:07:00-07:00', topics: ['design'],
    media: [{ kind: 'video', aspectRatio: 9 / 16, durationSeconds: 45, altText: 'Hands sketching a black-and-white mobile interface on paper.' }],
    provenance: { connectorId: 'open-media' }, engagement: { replies: 12, reposts: 28, likes: 260 },
    relevance: { followsAuthor: true, selectedInterestMatches: ['design'] },
  },
];

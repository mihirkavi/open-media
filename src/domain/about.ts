/**
 * What Open Media is, in one place: the landing page, the mission page, the developer page, the
 * public API's /v1/about and /llms.txt all read from here, so people and agents are told the same
 * thing. The wording follows the Master Builder Prompt; keep the two aligned.
 */

export const tagline = 'Post everywhere. Message everyone. One app.';

export const promise = 'One app for your social world.';

export const mission =
  'Build the open communication layer for humanity, where people can communicate across networks, control how information reaches them, and keep ownership of their identity, relationships and content, whichever app they use.';

export const philosophy = {
  line: 'Apps are doorways. The person is the constant.',
  body: 'No app should permanently own your identity, audience, social graph, content, recommendations, message history or governance rights. Open Media is one doorway. Anyone should eventually be able to build another on the same open protocol, and you should be able to walk through whichever one you like.',
};

export const promises = [
  {
    title: 'Everything together',
    line: 'One place for your social world.',
    body: 'Posts from several networks in one feed, and every conversation, chat or email, in one inbox organised by person rather than by app. One post goes to every network you choose.',
  },
  {
    title: 'Your feed belongs to you',
    line: 'No secret algorithm.',
    body: 'Choose Raw, simply newest first, or Relevant, a small set of signals you can see, or describe your own feed in plain words and share it. Every feed is an open lens anyone can read, and every post explains itself with “Why this?”, including the private data it did not use.',
  },
  {
    title: 'You are not locked in',
    line: 'Your identity, audience and content move with you.',
    body: 'Export everything or delete your account at any time. Public posts are open to everyone through a free API. The goal is identity and content that work in any app.',
  },
];

export const surfaces = [
  { name: 'Feed', icon: 'home-outline', body: 'One mixed stream from Open Media, Farcaster, Lens, Hive and DeSo, newest first or transparently ranked.' },
  { name: 'Clips', icon: 'play-outline', body: 'Short videos, full screen, one at a time. The same posts as Feed, just a different way to watch.' },
  { name: 'Messages', icon: 'chatbubble-outline', body: 'Open Media chats, email and bridged chat apps side by side, organised by the people you talk to.' },
] as const;

export const principles = [
  'Post everywhere. Message everyone. One app.',
  'Your feed belongs to you.',
  'Your identity, audience and content move with you.',
  'Applications are doorways. The human remains the constant.',
  'Blockchain proves; it does not host the social network.',
  'Money buys services, not political power.',
  'Global destruction is exceptional. Filtering is normal.',
  'Protocol rules determine interoperability. Doorway rules determine presentation.',
  'Build one implementation today as though competing implementations will exist tomorrow.',
  'Open Media should be obvious before it is powerful, and powerful when needed.',
];

export const neverDefaults = [
  'Ranking your feed on private messages, ID documents, precise location or inferred sensitive traits',
  'Optimising for addiction or sending manipulative notifications',
  'Requiring a crypto wallet, tokens or fees to read or post',
  'Advertising by default',
  'Selling governance power: one verified human is one vote',
];

export type RoadmapStatus = 'done' | 'beta' | 'next' | 'planned' | 'later';

export const roadmap: { phase: string; detail: string; status: RoadmapStatus }[] = [
  { phase: 'The app', detail: 'Feed, Clips and Messages on iPhone, Android and the web, in light and dark.', status: 'done' },
  { phase: 'Shared content', detail: 'One post type everywhere, four open networks, short video.', status: 'done' },
  { phase: 'Email and Messages', detail: 'Email inside Messages, conversations organised by person.', status: 'done' },
  { phase: 'Connectors', detail: 'Cross-posting to open networks, chat bridges, the public and agent APIs.', status: 'beta' },
  { phase: 'Search and AI help', detail: 'One plain-language search for posts, messages, email and settings.', status: 'done' },
  { phase: 'Algorithm choice', detail: 'Feed lenses you describe in plain words or with an agent, then inspect, share, install and remove, with strict data permissions.', status: 'beta' },
  { phase: 'Moderation choice', detail: 'Filters you set, credible reports and independent moderation providers.', status: 'planned' },
  { phase: 'Identity', detail: 'Optional proof of personhood without storing ID documents, separate personas, portable identity.', status: 'planned' },
  { phase: 'Governance', detail: 'One person, one vote, and an open improvement-proposal process.', status: 'planned' },
  { phase: 'Decentralisation', detail: 'Independent apps and infrastructure, stewarded by an independent foundation.', status: 'later' },
];

export const roadmapLabels: Record<RoadmapStatus, string> = { done: 'Live', beta: 'Beta', next: 'Next', planned: 'Planned', later: 'Long term' };

export const honestStatus = [
  'Open Media is an early public beta, built in the open.',
  'It cannot read or post to Instagram, X, LinkedIn or TikTok feeds; those companies offer no open access and Open Media does not scrape them.',
  'Chat bridges are opt-in, run on a local setup today, and are not approved by the networks they connect to.',
  'Messages between Open Media users are protected by strict database rules but are not yet end-to-end encrypted.',
];

/** Every way a program or AI agent can use Open Media. Paths are relative to the API origin. */
export const agentInterfaces = {
  discovery: [
    { path: '/llms.txt', description: 'Plain-text guide for language models: what Open Media is and how to use every interface.' },
    { path: '/v1', description: 'API index: every endpoint, group and authentication rule as JSON.' },
    { path: '/v1/openapi.json', description: 'OpenAPI 3.1 description of the public and account APIs.' },
    { path: '/.well-known/mcp.json', description: 'MCP server card: the MCP servers, their tools and how to authenticate.' },
  ],
  public: [
    { method: 'GET', path: '/v1/feed', description: 'The mixed feed: Open Media, Farcaster, Lens, Hive and DeSo through a feed lens (raw, relevant, work or a shared one), each post with its “Why this?” reasons.' },
    { method: 'GET', path: '/v1/lenses', description: 'Feed lenses: the built-in Raw, Relevant and Work and lenses people shared, each with its rules in plain words and what it may read.' },
    { method: 'GET', path: '/v1/lenses/{id}', description: 'One feed lens and its manifest.' },
    { method: 'POST', path: '/v1/lenses/draft', description: 'Write a feed lens from plain words, with what was and was not understood.' },
    { method: 'POST', path: '/v1/lenses/preview', description: 'The public feed through a lens (an id, a manifest or plain words); nothing is saved.' },
    { method: 'GET', path: '/v1/search?q=', description: 'Plain-language search across public posts on every network, plus matching settings.' },
    { method: 'GET', path: '/v1/posts', description: 'Open Media public posts, newest first, paginated.' },
    { method: 'GET', path: '/v1/posts/{id}', description: 'One public post.' },
    { method: 'GET', path: '/v1/profiles/{handle}', description: 'A public profile.' },
    { method: 'GET', path: '/v1/profiles/{handle}/posts', description: 'A profile’s public posts.' },
    { method: 'GET', path: '/v1/profiles/{handle}/resume', description: 'A person’s public professional profile as a resume page (JSON Resume “even” theme); add .json for JSON Resume or .yaml for RenderCV.' },
    { method: 'GET', path: '/v1/jobs?q=', description: 'Open job posts on Open Media with pay, place and the employer’s apply link. Open Media never applies for anyone.' },
    { method: 'GET', path: '/v1/events/upcoming', description: 'Upcoming public events from Luma, Meetup and Eventbrite in the San Francisco Bay Area, shown once even when listed on several platforms, with official registration links.' },
    { method: 'GET', path: '/v1/people/{network}/{handle}', description: 'One person’s posts in one timeline: an Open Media profile plus the accounts they listed, or one Farcaster, Lens, Hive or DeSo account.' },
    { method: 'GET', path: '/v1/networks', description: 'Every network and connector, with exactly which capabilities work today.' },
    { method: 'GET', path: '/v1/settings?q=', description: 'The searchable settings index, so an agent can tell a person where any control lives.' },
    { method: 'GET', path: '/v1/about', description: 'Mission, principles, promises, roadmap and honest status.' },
    { method: 'GET', path: '/v1/listings/{postId}/checks', description: 'What was checked on a listing: claims, outcomes, how many verified people agreed and the pages they cited.' },
    { method: 'GET', path: '/v1/transparency', description: 'Monthly counts of listing checks, reports and decisions, with no personal data.' },
  ],
  account: [
    { method: 'GET', path: '/v1/me', description: 'Your profile.' },
    { method: 'POST', path: '/v1/me/posts', description: 'Publish a public post.' },
    { method: 'DELETE', path: '/v1/me/posts/{id}', description: 'Delete one of your posts.' },
    { method: 'POST', path: '/v1/posts/{id}/report', description: 'Report a post for review.' },
    { method: 'GET', path: '/v1/me/conversations', description: 'Your Open Media conversations with recent messages.' },
    { method: 'POST', path: '/v1/me/conversations', description: 'Start a conversation with a handle.' },
    { method: 'POST', path: '/v1/me/conversations/{id}/messages', description: 'Send a message.' },
    { method: 'GET', path: '/v1/me/export', description: 'Export a readable copy of your data.' },
    { method: 'POST', path: '/v1/me/blocks', description: 'Block or unblock someone by handle.' },
    { method: 'POST', path: '/v1/me/conversations/{id}/report', description: 'Report unwanted contact in a conversation.' },
    { method: 'DELETE', path: '/v1/me', description: 'Delete your account; needs the confirmation “delete my account”.' },
    { method: 'GET', path: '/v1/me/contacts', description: 'Your contacts, private to you and encrypted on the server, with which accounts each is linked to and why.' },
    { method: 'PUT', path: '/v1/me/contacts', description: 'Create or replace contact cards by id.' },
    { method: 'DELETE', path: '/v1/me/contacts/{id}', description: 'Delete a contact card.' },
    { method: 'PUT', path: '/v1/me/linked-accounts', description: 'Set the open-network accounts shown on your public profile.' },
    { method: 'POST', path: '/v1/me/listings', description: 'Offer a product, service, event or job as a public post. It goes live at once and is checked in the background.' },
    { method: 'GET', path: '/v1/me/profile-fields', description: 'Your profile fields (contact details, accounts on other networks), each with who may see it.' },
    { method: 'PUT', path: '/v1/me/profile-fields', description: 'Replace your profile fields and who may see each one: everyone, connections or only me.' },
    { method: 'GET', path: '/v1/me/professional', description: 'Your professional profile, and the same data as a JSON Resume document.' },
    { method: 'PUT', path: '/v1/me/professional', description: 'Replace your professional profile: headline, experience, education, skills, links, open to work or hiring. It is public.' },
    { method: 'POST', path: '/v1/me/professional/import', description: 'Read a JSON Resume or LinkedIn’s own data-export files into a professional profile; saved only when you say so.' },
    { method: 'POST', path: '/v1/me/career/tailor', description: 'Draft your profile and a cover note for one job from your own profile only, with anything unsupported removed and listed.' },
    { method: 'POST', path: '/v1/me/career/application', description: 'Draft the message to apply for a job with. Nothing is sent.' },
    { method: 'GET', path: '/v1/verification-tasks/next', description: 'For human-verified people: a listing claim to check; answer with POST /v1/verification-tasks/{taskId} and cited quotes.' },
    { method: 'GET', path: '/v1/operator/review-queue', description: 'For Open Media operators: held listings, hidden posts and appeals.' },
    { method: 'PATCH', path: '/v1/me/listings/{postId}', description: 'Change a listing’s availability, price or place.' },
    { method: 'PUT', path: '/v1/me/listings/{postId}/rating', description: 'Rate a listing 1–5 stars (verified people who show their legal name only); DELETE withdraws it.' },
    { method: 'GET', path: '/v1/me/identity', description: 'Your identity tier, blue tick, the name others see, public or private, and verification status.' },
    { method: 'PUT', path: '/v1/me/identity', description: 'Choose the name others see and whether your account is private.' },
    { method: 'POST', path: '/v1/me/verification', description: 'Start identity verification with Stripe Identity (a link you open yourself).' },
    { method: 'GET', path: '/v1/me/payments/setup', description: 'Your card payouts, linked wallets, tips setting, fees, and whether this server runs in test mode.' },
    { method: 'POST', path: '/v1/me/payments/payouts', description: 'Set up getting paid by card with Stripe (a link you open yourself).' },
    { method: 'PUT', path: '/v1/me/payments/tips', description: 'Turn tips on your posts on or off.' },
    { method: 'GET', path: '/v1/me/payments', description: 'Payments you sent and received.' },
    { method: 'POST', path: '/v1/me/payments', description: 'Start paying for a listing, a tip or a paid post: a Stripe page or a transfer for your own wallet. Nothing is paid until Stripe or the network confirms it.' },
    { method: 'GET', path: '/v1/me/payments/{id}', description: 'One of your payments.' },
    { method: 'POST', path: '/v1/me/payments/{id}/transaction', description: 'Report the USDC transaction that paid; Open Media checks it on the network.' },
    { method: 'POST', path: '/v1/me/wallets', description: 'Link a wallet with a signature from it.' },
    { method: 'DELETE', path: '/v1/me/wallets/{id}', description: 'Unlink a wallet.' },
    { method: 'GET', path: '/v1/me/listings/{postId}/payment-options', description: 'How a listing can be paid for.' },
    { method: 'GET', path: '/v1/me/posts/{id}/payment-options', description: 'How a post can be tipped or unlocked.' },
    { method: 'POST', path: '/v1/me/paid-posts', description: 'Publish a post with a free preview and a paid part.' },
    { method: 'GET', path: '/v1/me/posts/{id}/paid', description: 'The paid part of a post you wrote or paid for.' },
    { method: 'GET', path: '/v1/me/follows', description: 'Who you follow, your followers, and follow requests waiting for you.' },
    { method: 'GET', path: '/v1/me/lenses', description: 'Your feed lenses.' },
    { method: 'POST', path: '/v1/me/lenses', description: 'Save a feed lens, or share it publicly.' },
    { method: 'POST', path: '/v1/me/lenses/install', description: 'Install a shared feed lens (a copy that is yours).' },
    { method: 'DELETE', path: '/v1/me/lenses/{key}', description: 'Remove one of your feed lenses.' },
    { method: 'GET', path: '/v1/me/feed', description: 'Your feed through a lens, using who you follow when the lens asks for it.' },
    { method: 'POST', path: '/v1/me/follows', description: 'Follow someone; private accounts get a request.' },
    { method: 'DELETE', path: '/v1/me/follows/{handle}', description: 'Unfollow, or withdraw a request.' },
    { method: 'POST', path: '/v1/me/follow-requests/{id}', description: 'Accept or decline a follow request.' },
    { method: 'DELETE', path: '/v1/me/followers/{id}', description: 'Remove a follower.' },
    { method: 'GET', path: '/v1/me/email', description: 'Your stored email from every connected mailbox, newest first.' },
    { method: 'GET', path: '/v1/mail-accounts', description: 'Your connected mailboxes.' },
    { method: 'POST', path: '/v1/mail-accounts', description: 'Connect an IMAP or POP3 mailbox, with SMTP for sending.' },
    { method: 'POST', path: '/v1/mail-accounts/{id}/sync', description: 'Fetch new mail for a mailbox.' },
    { method: 'POST', path: '/v1/mail-accounts/{id}/send', description: 'Send an email.' },
    { method: 'DELETE', path: '/v1/mail-accounts/{id}', description: 'Remove a mailbox and its stored mail.' },
    { method: 'GET', path: '/v1/bridges', description: 'Chat networks this server bridges and which you have connected.' },
    { method: 'GET', path: '/v1/bridges/conversations', description: 'Your bridged chats (WhatsApp, Signal and others).' },
    { method: 'POST', path: '/v1/bridges/rooms/{id}/messages', description: 'Reply in a bridged chat.' },
    { method: 'GET', path: '/v1/bridges/{network}/flows', description: 'How a chat network can be connected.' },
    { method: 'POST', path: '/v1/bridges/{network}/login/start', description: 'Start connecting a chat network (then login/step, login/cancel, logout).' },
    { method: 'GET', path: '/v1/cross-posting/status', description: 'Which networks this server helps cross-post to. Cross-posting itself is signed on your device.' },
    { method: 'POST', path: '/v1/search/assist', description: 'A short AI summary, with citations, of public posts you pass in. No account needed.' },
  ],
  mcp: [
    { path: '/open/mcp', auth: 'none', description: 'Public tools: feed, feed lenses (list, draft, preview), search, posts, profiles, person timelines, upcoming events, networks, settings and the mission.' },
    { path: '/me/mcp', auth: 'Open Media access token', description: 'Your account: posts, feed lenses (save, share, install, your feed through one), listings, payments (each one confirmed by you first), tips and paid posts, messages, contacts, linked accounts, identity and privacy, follows, email, chat networks, cross-posting status, blocking, reports, export and account deletion.' },
    { path: '/mcp', auth: 'OAuth 2.1', description: 'Open Media Events: find events, check your calendar and plan your week.' },
  ],
};

export const sourceRepository = 'https://github.com/mihirkavi/open-media';

/**
 * Agent skills for Open Media, in one place. The Worker serves them at
 * /.well-known/agent-skills/{name}/SKILL.md and the Claude and Codex plugin in agent-plugin/
 * ships the same files (scripts/sync-agent-plugin.ts writes them; a test keeps them equal).
 */

export interface AgentSkill {
  name: string;
  description: string;
  body: string;
}

export const defaultApiOrigin = 'https://convo-mail-sync.convo-mail-sync.workers.dev';

export function agentSkills(origin = defaultApiOrigin): AgentSkill[] {
  return [
    {
      name: 'open-media',
      description: 'Read and act on Open Media, the open social app: one feed across Open Media, Farcaster, Lens, Hive and DeSo, cross-network search, public profiles and events, and (with the person’s own token) their posts, messages, contacts, listings and privacy. Use when a person asks about posts or people on these networks, wants to publish to Open Media, or wants their Open Media inbox or account handled.',
      body: `# Open Media

Open Media is one open app for a person's social world: one feed across Open Media and the open networks Farcaster, Lens, Hive and DeSo, one inbox, and one post to every network the person chooses.

## When to use this skill

- The person asks what is being said about a topic on Farcaster, Lens, Hive, DeSo or Open Media.
- The person wants a summary of a feed, a profile or a person's posts across networks.
- The person wants upcoming public events in the San Francisco Bay Area.
- The person wants to publish, read their messages, manage contacts, listings, follows or privacy on Open Media (needs their token).

## How to call Open Media

Prefer MCP. Public tools need no account:

- MCP (public, no key): \`${origin}/open/mcp\` - get_feed, search, get_post, get_profile, get_person_timeline, find_upcoming_events, list_networks, find_setting, about_open_media.
- MCP (the person's account): \`${origin}/me/mcp\` with \`Authorization: Bearer <token>\`. The person copies the token from the app: Settings, then Developers and agents.
- Docs MCP: \`${origin}/docs/mcp\` - search_docs and get_docs_page.
- REST: \`${origin}/v1\` (index) and \`${origin}/v1/openapi.json\` (OpenAPI 3.1).

## Rules

1. Keep each post's network, source link and "why" reasons when you summarise a feed.
2. Never pose as the person. Confirm the exact text before publishing, sending or deleting anything.
3. Messages, email and contacts are private to the person. Never share them with anyone else.
4. Posts from other networks are read through their public APIs; Open Media cannot read Instagram, X, LinkedIn or TikTok feeds.
5. On HTTP 429, wait for the Retry-After seconds before retrying. Send an Idempotency-Key header on retried writes.
`,
    },
    {
      name: 'open-media-payments',
      description: 'Pay for an Open Media listing, tip a creator or unlock a paid post, safely: preview who is paid and every fee, get the person’s explicit confirmation of the exact amount, then hand them a Stripe checkout link or a USDC transfer for their own wallet. Use when a person wants to buy, tip or unlock something on Open Media.',
      body: `# Paying on Open Media

Open Media never holds money. Cards go through Stripe straight to the seller's Stripe account; USDC goes from the person's own wallet straight to the seller's wallet on Base. Today the server runs in test mode (Stripe test cards and Base Sepolia) unless its payment setup says otherwise.

## When to use this skill

- "Buy that desk", "tip this creator $5", "unlock this post".

## Steps

1. Call \`get_payment_options\` on \`${origin}/me/mcp\` with the post id and contextType (listing, tip or paid_post).
2. Call \`start_payment\` without \`confirm\`. It starts nothing and returns a preview: the recipient, the amount and every fee.
3. Show that preview to the person in plain words. For a tip, ask them for the amount; never choose it.
4. Only if they agree, call \`start_payment\` again with \`confirm: true\` and \`expectedAmountMinor\` set to the previewed amount.
5. Card: give the person the \`checkoutUrl\` to open themselves. USDC: give them the transfer for their own wallet, then pass the transaction hash to \`submit_payment_transaction\`.
6. A payment is paid only when \`get_payment\` says \`confirmed\`. Never tell the person it is paid before that.

## Never

- Never ask for card numbers, bank details, seed phrases or private keys.
- Never link a wallet for the person; that needs their own signature in the app.
`,
    },
  ];
}

export function skillMarkdown(skill: AgentSkill): string {
  // JSON strings are valid YAML double-quoted scalars, so colons in the description are safe.
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body}`;
}

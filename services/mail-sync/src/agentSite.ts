/**
 * The Open Media site for people and agents, served by the same Worker as the API.
 *
 * Every page exists three ways from one Markdown source: HTML for browsers (with JSON-LD, Open
 * Graph and WebMCP tools), Markdown for agents (Accept: text/markdown, a .md URL, or a known AI
 * user agent), and a structured agent view (?mode=agent on the homepage). Discovery files point
 * at the API, the MCP servers and the skills: robots.txt, sitemap.xml, llms.txt files, ARD and AI
 * catalogs, an agent-skills index, an A2A agent card, an RFC 9727 API catalog and MCP server cards.
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { agentInterfaces, honestStatus, mission, philosophy, promise, promises, sourceRepository, surfaces, tagline } from '../../../src/domain/about';
import { agentSkills, skillMarkdown } from '../../../src/domain/agentSkills';
import { webMcpTools } from '../../../src/domain/webMcpTools';

export const siteVersion = '1.1.0';
/** When the site's pages last changed (sitemap lastmod and Markdown frontmatter). */
export const siteUpdated = '2026-10-25';
const assets = 'https://raw.githubusercontent.com/mihirkavi/open-media/main/assets';
const iconUrl = `${assets}/brand/logo-light.png`;
const coverUrl = `${assets}/brand/cover.png`;
const aiBots = /(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|CCBot|Bytespider|meta-externalagent)/i;

interface Page { path: string; title: string; description: string; body: (origin: string) => string }

/** The same answers as the FAQ in the README. */
const faq = [
  { question: 'Is Open Media free?', answer: 'Yes. The app and its source code are free and open source under the MIT licence. There are no ads by default.' },
  { question: 'Do my friends need to join for it to be useful?', answer: 'No. Open Media is useful on day one by connecting the networks and email accounts you already use. Friends on Open Media are a bonus, not a requirement.' },
  { question: 'Can it show my Instagram, X, TikTok or LinkedIn feed?', answer: 'Not today. Those companies do not offer open access for apps like Open Media, and Open Media does not scrape them. It connects to networks that allow it (Farcaster, Lens, Hive, DeSo and email).' },
  { question: 'Do I need a crypto wallet?', answer: 'No. You sign in with your email. Some open networks use blockchain technology behind the scenes, but you never need to understand it, hold tokens or pay fees to read the feed.' },
  { question: 'Can AI agents use Open Media?', answer: 'Yes. Public data needs no key: agents can use the MCP servers, the REST API, WebMCP tools in the browser, or the plugin for Claude Code and Codex. Acting for a person needs that person’s own token.' },
];

const md = (origin: string, path: string) => `${origin}${path === '/' ? '/index' : path}.md`;
const account = (origin: string) => agentInterfaces.account.map((item) => `- \`${item.method} ${item.path}\`: ${item.description}`).join('\n');
const publicRoutes = (origin: string) => agentInterfaces.public.map((item) => `- \`${item.method} ${item.path}\`: ${item.description}`).join('\n');

const pages: Page[] = [
  {
    path: '/', title: 'Open Media: one open app for your social world',
    description: `${tagline} ${mission}`,
    body: (origin) => `# Open Media

${promise} ${tagline}

${mission}

> ${philosophy.line} ${philosophy.body}

## What Open Media does

${promises.map((item) => `- **${item.title}.** ${item.body}`).join('\n')}

${surfaces.map((item) => `- **${item.name}:** ${item.body}`).join('\n')}

Open Media is a free, open-source app for iPhone, Android and the web (MIT licence). It reads public posts from Farcaster, Lens, Hive and DeSo, keeps every post's source and link, and explains every ranked post with "Why this?".

## For AI agents and developers

Everything a person can do in the app has an interface here. Public data needs no account or key.

- [Agent guide](${origin}/agents): when to use Open Media and how to call it.
- [API documentation](${origin}/docs): REST endpoints, MCP servers, errors, limits and examples.
- [Developer portal](${origin}/developers): quickstart and access tokens. [Sandbox](${origin}/sandbox): test mode and a private local stack.
- [Authentication](${origin}/auth.md): which calls need no credential and how to get the person's token.
- [OpenAPI 3.1](${origin}/v1/openapi.json), [llms.txt](${origin}/llms.txt) and the public MCP server at \`${origin}/open/mcp\`.
- In the browser, this page registers WebMCP tools (search, feed, events, profiles) through \`document.modelContext\`.

## Frequently asked questions

${faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n')}

## Pricing

Open Media is free: no ads by default, no subscription and no API key for public data. Payments between people (products, services, tips and paid posts) carry no Open Media fee today. See [pricing](${origin}/pricing).

## Learn more

[About](${origin}/about) · [Contact](${origin}/contact) · [Privacy](${origin}/privacy) · [Source code](${sourceRepository})
`,
  },
  {
    path: '/agents', title: 'Open Media for AI agents',
    description: 'When an AI agent should use Open Media and exactly how to call it: MCP, REST, WebMCP and skills.',
    body: (origin) => `# Open Media for AI agents

Use this page to decide whether Open Media fits a task and how to call it.

## When to use Open Media

- **Cross-network social search.** "What are people saying about Ethereum on Lens this week?" Use the \`search\` tool or \`GET /v1/search?q=\`.
- **One feed across open networks.** Summaries of Farcaster, Lens, Hive, DeSo and Open Media posts, each with its source link and "why" reasons. Use \`get_feed\`.
- **A person's posts everywhere.** One timeline for an Open Media handle plus the accounts they listed. Use \`get_person_timeline\`.
- **Upcoming events in the San Francisco Bay Area** from Luma, Meetup and Eventbrite, de-duplicated. Use \`find_upcoming_events\`.
- **Acting for a signed-in person:** publishing, messages, email, contacts, listings, follows, privacy, payments, tips and paid posts, through their own token.

Do not use Open Media to read Instagram, X, LinkedIn or TikTok feeds; those networks offer no open access and Open Media does not scrape them.

## How to call it

1. **MCP (preferred).** Public: \`${origin}/open/mcp\` (no key). Account: \`${origin}/me/mcp\` with \`Authorization: Bearer <token>\`. Docs: \`${origin}/docs/mcp\`. Streamable HTTP.
2. **REST.** Index at [${origin}/v1](${origin}/v1); OpenAPI at [${origin}/v1/openapi.json](${origin}/v1/openapi.json).
3. **WebMCP.** On the web, Open Media pages register tools with \`document.modelContext.registerTool()\`.
4. **Skills.** [open-media](${origin}/.well-known/agent-skills/open-media/SKILL.md) and [open-media-payments](${origin}/.well-known/agent-skills/open-media-payments/SKILL.md), also packaged as a plugin for Claude Code and Codex in the [repository](${sourceRepository}/tree/main/agent-plugin).

## Rules for agents

- Agents identify as agents and never pose as people.
- Confirm the exact text with the person before publishing, sending or deleting anything.
- Payments start only after the person confirms the exact amount; money moves only when they finish on Stripe's page or approve the transfer in their own wallet.
- Messages, email and contacts are private to the person and are never public.
- Keep each post's network and link when you quote or summarise it.
`,
  },
  {
    path: '/docs', title: 'Open Media API documentation',
    description: 'REST and MCP reference for Open Media: public feed and search, the account API, errors, rate limits, idempotency and versioning.',
    body: (origin) => `# Open Media API documentation

Base URL: \`${origin}\`. All responses are JSON unless stated. The machine-readable description is [OpenAPI 3.1](${origin}/v1/openapi.json); the [API catalog](${origin}/.well-known/api-catalog) follows RFC 9727.

## Quick examples

\`\`\`bash
curl "${origin}/v1/feed?sources=open-media,farcaster&mode=raw"
curl "${origin}/v1/search?q=videos%20about%20cooking%20today"
curl -H "Authorization: Bearer $OPEN_MEDIA_TOKEN" "${origin}/v1/me"
\`\`\`

## MCP servers

- \`${origin}/open/mcp\`: public tools, no key.
- \`${origin}/me/mcp\`: the person's account, bearer token required. Money-moving tools preview first and need explicit confirmation.
- \`${origin}/docs/mcp\`: search and read this documentation.
- \`${origin}/mcp\`: Open Media Events, OAuth 2.1 (PKCE S256, client ID metadata documents).

## Public endpoints (no key)

${publicRoutes(origin)}

## Account endpoints (bearer token)

${account(origin)}

## Plain-language questions (NLWeb)

\`POST ${origin}/ask\` follows NLWeb v0.55: send \`{"query": {"text": "…"}}\` and get schema.org items (\`TechArticle\` from these docs, \`SocialMediaPosting\` from every open network) under \`results\`, with \`_meta.response_type\` \`answer\` or \`failure\` (\`INVALID_QUERY\`, \`NO_RESULTS\`). Add \`"prefer": {"streaming": true}\` and \`Accept: text/event-stream\` for \`start\`, \`result\` and \`complete\` events. The [schema map](${origin}/schemamap.xml) lists each page's type, and [\`/feeds/posts.jsonl\`](${origin}/feeds/posts.jsonl) carries the newest public Open Media posts as JSON Lines.

## Agent registration

Agents may register at \`POST ${origin}/agent/identity\` (\`{"type": "anonymous"}\`) and exchange the returned assertion at \`POST ${origin}/oauth/token\` with \`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer\`. The hour-long token has the \`public:read\` scope and its own rate-limit bucket; it never opens anyone's account. See [authentication](${origin}/auth.md).

## Errors

Errors are JSON: \`{"error": {"code": "bad_request", "message": "…"}}\`. Codes include \`bad_request\` (400), \`unauthorized\` (401, with a \`WWW-Authenticate\` header naming the protected-resource metadata), \`refused\` (403 or 409), \`not_found\` (404), \`rate_limited\` (429, with \`Retry-After\`), \`not_configured\` (503) and \`upstream_unavailable\` (502).

## Rate limits

Public and agent routes allow about 120 requests per minute per client IP, or per registered agent when it sends its agent token. Responses carry \`RateLimit-Policy\`; a 429 carries \`Retry-After\` in seconds.

## Idempotency

Send an \`Idempotency-Key\` header (a UUID) on \`POST /v1/me/posts\`, \`POST /v1/me/listings\`, \`POST /v1/me/paid-posts\` and \`POST /v1/me/payments\`. Retrying with the same key returns the same post or payment instead of creating a second one.

## Pagination

Lists use opaque cursors: pass \`nextCursor\` (or follow \`next\`) from one page to get the next.

## Versioning and deprecation

The API is versioned in the path (\`/v1\`). Fields may be added without notice; nothing in \`/v1\` is removed or changed incompatibly without at least 90 days' notice in this document, a \`Deprecation\` header on the affected responses and a \`Sunset\` header with the removal date.

## Sandbox

Payments run in test mode (Stripe test cards and USDC on Base Sepolia) until the operator turns on live payments; \`GET /v1/me/payments/setup\` says which mode is active. For a full private sandbox, run the open-source stack locally with \`npm run local\` from the [repository](${sourceRepository}).
`,
  },
  {
    path: '/developers', title: 'Open Media developer portal',
    description: 'Quickstart for building on Open Media: no-key public API, personal access tokens, MCP servers, plugins and the test-mode sandbox.',
    body: (origin) => `# Open Media developer portal

Build on Open Media without an account for public data, or act for a person with their own token.

## Quickstart

1. Read the public feed: \`curl "${origin}/v1/feed"\`. No key, no signup.
2. Connect an MCP client to \`${origin}/open/mcp\` (Streamable HTTP).
3. To act for a person, they copy a short-lived access token from the app (Settings, then Developers and agents) and you send it as \`Authorization: Bearer <token>\`.
4. Install the Open Media plugin for Claude Code or Codex from the [repository](${sourceRepository}/tree/main/agent-plugin).
5. For your agent's own rate limit, register it: \`POST ${origin}/agent/identity\` with \`{"type": "anonymous"}\`, then trade the assertion at \`/oauth/token\` ([how](${origin}/auth.md)).

## SDKs and command line

The repository includes a TypeScript SDK (\`packages/sdk\`, \`open-media-sdk\`), a command line (\`packages/cli\`, \`open-media\`) and a Python client (\`packages/python\`, \`open-media\`). They are not on npm or PyPI yet; build them from the [repository](${sourceRepository}/tree/main/packages). Each retries 429s after \`Retry-After\` and sends an \`Idempotency-Key\` on every write.

\`\`\`ts
import { OpenMedia } from 'open-media-sdk';
const feed = await new OpenMedia().feed({ sources: ['farcaster', 'lens'] });
\`\`\`

\`\`\`bash
open-media search ethereum on lens --json
\`\`\`

## Access tokens

There are no API keys to request and no sales process. Public data is free and keyless; account access uses the person's own token, so an integration can never do more than that person can. Tokens expire after about an hour.

## Sandbox and test mode

- Payments are in test mode (Stripe test cards, USDC on Base Sepolia) until live payments are approved; no real money moves.
- Run the whole stack locally with \`npm run local\` (database, auth, API and web app) for a private sandbox with test accounts.

## Resources

- [API documentation](${origin}/docs) and [OpenAPI 3.1](${origin}/v1/openapi.json)
- [Agent guide](${origin}/agents) and [authentication](${origin}/auth.md)
- [Skills index](${origin}/.well-known/agent-skills/index.json) and [MCP server card](${origin}/.well-known/mcp/server-card.json)
- [Source code (MIT)](${sourceRepository})
`,
  },
  {
    path: '/sandbox', title: 'Open Media sandbox and test mode',
    description: 'How agents and developers can exercise the Open Media API without touching live money or real people’s data.',
    body: (origin) => `# Open Media sandbox and test mode

Use these to build and test an integration without touching live money or other people's data.

## Test mode for payments

Every payment on this server runs in test mode until live payments are approved: cards use Stripe's test mode and USDC uses the Base Sepolia test network, so no real money moves. \`GET ${origin}/v1/me/payments/setup\` returns \`available.live: false\` while test mode is on. Use Stripe's published test cards and test USDC from a Base Sepolia faucet.

## Read-only exploration

All public endpoints are read-only and need no key, so an agent can explore safely: \`GET ${origin}/v1/feed\`, \`GET ${origin}/v1/search?q=\`, \`GET ${origin}/v1/events/upcoming\`, and the tools on \`${origin}/open/mcp\`.

## Confirmation before writes

Account tools that publish, send or pay first return a preview. Payments start only when called again with \`confirm: true\` and the exact amount, and money moves only when the person finishes on Stripe's page or in their own wallet.

## A private sandbox on your machine

The whole stack is open source. Clone ${sourceRepository} and run \`npm run local\`: it starts the database, auth, this API and the web app on your computer with test accounts and a local inbox, so you can create accounts, post, message and pay with test data that never leaves your machine.

See the [developer portal](${origin}/developers) and [API documentation](${origin}/docs).
`,
  },
  {
    path: '/about', title: 'About Open Media',
    description: 'Open Media is an open-source project building the open communication layer for humanity.',
    body: (origin) => `# About Open Media

${mission}

${philosophy.line} ${philosophy.body}

Open Media is an open-source project (MIT licence) developed in the open at [${sourceRepository}](${sourceRepository}). It ships one app for iPhone, Android and the web, a public API, MCP servers for AI agents, and the database rules that protect people's data.

## What it is today

${promises.map((item) => `- **${item.title}:** ${item.line} ${item.body}`).join('\n')}

## Honest status

${honestStatus.map((item) => `- ${item}`).join('\n')}

## How it is built

The app is built with Expo and React Native. Data lives in Supabase (Postgres with row-level security), and this API runs on Cloudflare Workers. Every decision is recorded as an architecture decision record in the repository, and every change is tested before it ships.

See also: [contact](${origin}/contact), [privacy](${origin}/privacy) and [pricing](${origin}/pricing).
`,
  },
  {
    path: '/contact', title: 'Contact Open Media',
    description: 'How to reach the Open Media project: GitHub issues, private security reports and the in-app report tools.',
    body: (origin) => `# Contact Open Media

Open Media is developed in public, so the best way to reach the project is through its repository.

## Questions, ideas and bugs

Open an issue at [${sourceRepository}/issues](${sourceRepository}/issues). Describe what you expected, what happened, and the device or client you used. Issues are public, so never include passwords, tokens, messages or other private data.

## Security reports

Report vulnerabilities privately through GitHub: open the repository's Security tab and choose "Report a vulnerability". Please include steps to reproduce and give the project reasonable time to fix the problem before disclosing it. The scope is described in [SECURITY.md](${sourceRepository}/blob/main/SECURITY.md).

## Reporting content or people

Inside the app, use "Report" on a post or a conversation, or block the person. Reports are reviewed, and posts reported by several people are hidden automatically.

## For agents and integrations

Agents should start with [the agent guide](${origin}/agents) and [the API documentation](${origin}/docs). Problems with the API or MCP servers can be reported as GitHub issues with the request and response (never a token).
`,
  },
  {
    path: '/privacy', title: 'Open Media privacy',
    description: 'What Open Media stores, what is public, what stays private, and the controls people have over their data.',
    body: (origin) => `# Open Media privacy

This page describes how Open Media handles data, based on how the app and this API are built. The source code is public, so every statement here can be checked in the [repository](${sourceRepository}).

## Public by design

- Posts and profiles on Open Media are public unless a person makes their account private, in which case only followers they approve see their posts, including through this API and through agents.
- Public posts can be read by anyone, with or without an account, through the app and this API.

## Private by design

- Messages between Open Media users, connected email, bridged chats and contacts are never public. Contacts are encrypted on the server and readable only by their owner.
- Identity verification uses Stripe Identity; Stripe keeps the document and selfie, and Open Media keeps only the result.
- Payments go through Stripe or the person's own wallet. Open Media never stores card numbers, bank details, seed phrases or private keys.
- The feed is never ranked on private messages, ID documents, precise location or inferred sensitive traits, and every ranked post explains itself with "Why this?".

## Your controls

- Export all your data or delete your account from your profile at any time.
- Make your account private, choose which name others see, block and report people.

## This API

Public API requests are rate limited per IP address. Account requests act only as the person whose token is sent, and the database refuses everything else. No advertising or tracking cookies are set by this API.

Questions: see [contact](${origin}/contact).
`,
  },
  {
    path: '/pricing', title: 'Open Media pricing',
    description: 'Open Media is free: the app, the public API and the MCP servers. Payments between people carry no Open Media fee today.',
    body: (origin) => `# Open Media pricing

## Free

- **The app** on iPhone, Android and the web: free, no subscription, no ads by default.
- **The public API and MCP servers:** free, no API key, no signup. About 120 requests per minute per client.
- **The account API and account MCP server:** free, using the person's own access token.

## Payments between people

People can sell products and services, tip creators and sell paid posts. Open Media's fee is 0% today, shown before every payment. Card payments carry Stripe's processing fee (about 2.9% + 30¢ in the US), paid by the seller; USDC payments carry only the network fee shown by the payer's wallet. Payments run in test mode until live payments are approved.

## Limits

- Posts up to 2,000 characters; paid parts up to 10,000 characters; videos up to 3 minutes.
- Tips from 1 to 500 US dollars.

See the [developer portal](${origin}/developers) to get started.
`,
  },
  {
    path: '/auth', title: 'Agent authentication on Open Media',
    description: 'How agents obtain credentials for Open Media: no credential for public data, the person’s bearer token for the account API, and OAuth 2.1 for Open Media Events.',
    body: (origin) => `# Agent authentication on Open Media

How an agent gets access to Open Media, and exactly which credentials exist. This file lives at \`/auth.md\`, the discovery path from the WorkOS auth.md spec. Open Media implements its anonymous registration; this file says plainly what it does not implement.

## Discover

- Public data needs no credential at all: \`${origin}/open/mcp\`, \`GET /v1/feed\`, \`GET /v1/search\`, \`GET /v1/posts\`, \`GET /v1/profiles/{handle}\`, \`GET /v1/events/upcoming\` and every discovery file.
- Protected-resource metadata (RFC 9728): [${origin}/.well-known/oauth-protected-resource](${origin}/.well-known/oauth-protected-resource).
- Authorization-server metadata (RFC 8414), including the \`agent_auth\` block with \`identity_endpoint\` and \`identity_types_supported\`: [${origin}/.well-known/oauth-authorization-server](${origin}/.well-known/oauth-authorization-server).
- A protected route called without a valid credential returns 401 with \`WWW-Authenticate: Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"\`.

## Pick a method

- **No credential:** everything public. Start here.
- **Anonymous agent registration** (\`agent_auth\`, type \`anonymous\`): an agent gets its own identity and an access token with the \`public:read\` scope, so its requests are counted in its own rate-limit bucket instead of sharing one with its IP address. It never grants access to anyone's account.
- **The person's access token (bearer):** the account API (\`/v1/me/...\`) and the account MCP server (\`/me/mcp\`). The person copies it from the app (Settings, then Developers and agents); it acts only as them.
- **OAuth 2.1 with PKCE (S256):** Open Media Events at \`${origin}/mcp\`, scopes \`events:read\` and \`events:write\`, with client ID metadata documents or Dynamic Client Registration at \`${origin}/oauth/register\`.

## Register

\`\`\`
POST ${origin}/agent/identity
Content-Type: application/json

{"type": "anonymous", "name": "my-agent"}
\`\`\`

The response holds \`registration_id\`, \`identity_assertion\` (valid for 30 days), \`assertion_expires\`, \`pre_claim_scopes\` (\`public:read\`) and \`post_claim_scopes\` (empty). Only the \`anonymous\` type is supported: \`service_auth\` and \`identity_assertion\` (ID-JAG) registration return \`unsupported_identity_type\`.

## Claim

There is no claim ceremony and no \`claim_endpoint\`: an anonymous agent identity is never linked to a person. To act for a person, use their own access token instead.

## Exchange

\`\`\`
POST ${origin}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<identity_assertion>
\`\`\`

The response is \`{"access_token": "…", "token_type": "Bearer", "expires_in": 3600, "scope": "public:read"}\`. Exchange the same assertion again when the access token expires. OAuth clients for Open Media Events exchange authorization codes and refresh tokens at the same endpoint.

## Use the access_token

\`\`\`
Authorization: Bearer <access_token>
\`\`\`

Agent tokens work on every public route and the public MCP server. Account routes need the person's own token and answer 401 to an agent token.

## Errors

- \`400 invalid_grant\`: the identity assertion is invalid or expired. Register again.
- \`400 unsupported_identity_type\`: only \`{"type": "anonymous"}\` is accepted.
- \`401 unauthorized\` with \`WWW-Authenticate\`: missing, expired or invalid token on a protected route.
- \`429 rate_limited\` with \`Retry-After\`: back off for the stated seconds.

## Revocation

Agent identity assertions expire after 30 days and access tokens after an hour; there is no \`events_endpoint\` for revocation events. Account tokens end when they expire or the person signs out. OAuth tokens for Open Media Events are revoked at \`${origin}/oauth/token\`, the advertised revocation endpoint.
`,
  },
];

/** A small Markdown renderer for this module's own trusted pages (headings, lists, code, links). */
export function markdownToHtml(markdown: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (value: string) => escape(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => `<a href="${href}">${text}</a>`);
  const out: string[] = [];
  let list = false; let code = false; let quote = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } if (quote) { out.push('</blockquote>'); quote = false; } };
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) { close(); out.push(code ? '</code></pre>' : '<pre><code>'); code = !code; continue; }
    if (code) { out.push(escape(line)); continue; }
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) { close(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    const item = line.match(/^(?:- |\d+\. )(.*)$/);
    if (item) { if (!list) { close(); out.push('<ul>'); list = true; } out.push(`<li>${inline(item[1])}</li>`); continue; }
    if (line.startsWith('> ')) { if (!quote) { close(); out.push('<blockquote>'); quote = true; } out.push(`<p>${inline(line.slice(2))}</p>`); continue; }
    if (!line.trim()) { close(); continue; }
    close(); out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join('\n');
}

function frontmatter(page: Page, origin: string): string {
  return `---\ntitle: ${JSON.stringify(page.title)}\ndescription: ${JSON.stringify(page.description)}\ncanonical: ${origin}${page.path}\nlast-updated: ${siteUpdated}\n---\n\n`;
}

export function pageMarkdown(page: Page, origin: string): string {
  // auth.md must lead with its heading (WorkOS auth.md); the other pages carry frontmatter.
  return page.path === '/auth' ? page.body(origin) : frontmatter(page, origin) + page.body(origin);
}

function jsonLd(origin: string, page: Page) {
  const organization = { '@type': 'Organization', '@id': `${origin}/#organization`, name: 'Open Media', url: `${origin}/`, logo: iconUrl, sameAs: [sourceRepository], description: mission };
  const graph: object[] = [
    organization,
    { '@type': 'WebSite', '@id': `${origin}/#website`, name: 'Open Media', url: `${origin}/`, publisher: { '@id': `${origin}/#organization` }, potentialAction: { '@type': 'SearchAction', target: `${origin}/v1/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    { '@type': 'WebPage', '@id': `${origin}${page.path}#webpage`, url: `${origin}${page.path}`, name: page.title, description: page.description, isPartOf: { '@id': `${origin}/#website` }, dateModified: siteUpdated },
  ];
  if (page.path === '/' || page.path === '/pricing') {
    graph.push({
      '@type': 'SoftwareApplication', '@id': `${origin}/#app`, name: 'Open Media', description: `${tagline} ${promise}`, url: `${origin}/`, applicationCategory: 'SocialNetworkingApplication',
      operatingSystem: 'iOS, Android, Web', image: coverUrl, license: 'https://opensource.org/licenses/MIT', sameAs: [sourceRepository], publisher: { '@id': `${origin}/#organization` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free app, public API and MCP servers. No Open Media fee on payments between people today.' },
    });
  }
  if (page.path === '/') {
    graph.push({ '@type': 'FAQPage', '@id': `${origin}/#faq`, mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
    graph.push({ '@type': 'ItemList', '@id': `${origin}/#features`, name: 'What Open Media does', itemListElement: promises.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.title, description: item.body })) });
  }
  if (page.path === '/' || page.path === '/docs' || page.path === '/developers') {
    graph.push({ '@type': 'WebAPI', '@id': `${origin}/#api`, name: 'Open Media API', description: 'Public feed, search, profiles and events without a key; the account API with the person’s own token; MCP servers for agents.', documentation: `${origin}/docs`, url: `${origin}/v1`, provider: { '@id': `${origin}/#organization` }, termsOfService: `${origin}/privacy` });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * In-page WebMCP tools from the shared definitions: document.modelContext.registerTool(), with
 * navigator.modelContext as a trailing fallback for earlier browser builds. Read-only.
 */
export function webMcpScript(origin: string): string {
  return `(function () {
  var mc = document.modelContext || navigator.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return;
  var origin = ${JSON.stringify(origin)};
  var tools = ${JSON.stringify(webMcpTools).replace(/</g, '\\u003c')};
  function url(tool, input) {
    var path = tool.path.replace(/\\{(\\w+)\\}/g, function (_, name) { return encodeURIComponent(String(input[name] == null ? '' : input[name])); });
    var params = new URLSearchParams();
    Object.keys(tool.query || {}).forEach(function (param) { var value = input[tool.query[param]]; if (value !== undefined && value !== null && value !== '') params.set(param, String(value)); });
    var query = params.toString();
    return origin + path + (query ? '?' + query : '');
  }
  tools.forEach(function (tool) {
    try {
      var done = mc.registerTool({
        name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: function (input, options) {
          return fetch(url(tool, input || {}), { headers: { accept: 'application/json' }, signal: options && options.signal })
            .then(function (response) { return response.text(); });
        }
      });
      if (done && done.catch) done.catch(function () {});
    } catch (_) {}
  });
})();`;
}

function pageHtml(page: Page, origin: string): string {
  const canonical = `${origin}${page.path}`;
  const nav = [['/', 'Home'], ['/agents', 'Agents'], ['/docs', 'API'], ['/developers', 'Developers'], ['/sandbox', 'Sandbox'], ['/pricing', 'Pricing'], ['/about', 'About'], ['/contact', 'Contact'], ['/privacy', 'Privacy']]
    .map(([path, label]) => `<a href="${origin}${path}"${path === page.path ? ' aria-current="page"' : ''}>${label}</a>`).join(' ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description.replace(/"/g, '&quot;')}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="text/markdown" href="${md(origin, page.path)}">
<link rel="describedby" href="${origin}/llms.txt">
<link rel="service-desc" type="application/vnd.oai.openapi+json;version=3.1" href="${origin}/v1/openapi.json">
<link rel="ard" href="${origin}/.well-known/ard.json">
<link rel="icon" href="${iconUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Open Media">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${coverUrl}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonLd(origin, page)).replace(/</g, '\\u003c')}</script>
<style>
:root{color-scheme:light dark;--fg:#111;--muted:#555;--bg:#fff;--line:#e5e5e5}
@media (prefers-color-scheme:dark){:root{--fg:#f2f2f2;--muted:#aaa;--bg:#0d0d0d;--line:#2a2a2a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
header,main,footer{max-width:760px;margin:0 auto;padding:0 20px}
header nav{display:flex;flex-wrap:wrap;gap:14px;padding:18px 0;border-bottom:1px solid var(--line)}
a{color:inherit}nav a{text-decoration:none;color:var(--muted)}nav a[aria-current]{color:var(--fg);font-weight:600}
h1{font-size:2.1rem;line-height:1.15;margin:32px 0 12px}h2{margin-top:32px}
code{font:0.9em ui-monospace,Menlo,monospace;background:rgba(127,127,127,.12);padding:1px 5px;border-radius:5px}
pre{overflow-x:auto;background:rgba(127,127,127,.1);padding:14px;border-radius:12px}pre code{background:none;padding:0}
blockquote{margin:16px 0;padding-left:16px;border-left:3px solid var(--line);color:var(--muted)}
footer{padding:32px 20px;color:var(--muted);font-size:14px;border-top:1px solid var(--line);margin-top:40px}
</style>
</head>
<body>
<header><nav aria-label="Site">${nav}</nav></header>
<main>
${markdownToHtml(page.body(origin))}
</main>
<footer><p>For AI agents: start at <a href="${origin}/llms.txt">llms.txt</a>, the <a href="${origin}/agents">agent guide</a> or the MCP server at <code>${origin}/open/mcp</code>. Open source under the MIT licence: <a href="${sourceRepository}">${sourceRepository}</a>.</p></footer>
<script>${webMcpScript(origin)}</script>
</body>
</html>`;
}

// ─── Discovery documents ─────────────────────────────────────────────────────

function reverseHost(origin: string): string {
  return new URL(origin).hostname.split('.').reverse().join('.');
}

const mcpServers = (origin: string) => [
  { id: 'open', path: '/open/mcp', title: 'Open Media (public)', description: 'Public feed, cross-network search, profiles, timelines and Bay Area events. No key.', auth: 'none', kind: 'product' },
  { id: 'me', path: '/me/mcp', title: 'Open Media (your account)', description: 'Act for a person with their token: posts, messages, contacts, listings and payments.', auth: 'bearer', kind: 'product' },
  { id: 'docs', path: '/docs/mcp', title: 'Open Media docs', description: 'Search and read Open Media’s API, MCP and agent documentation.', auth: 'none', kind: 'docs' },
].map((server) => ({ ...server, url: `${origin}${server.path}` }));

export function serverCardFor(origin: string, id: string) {
  const server = mcpServers(origin).find((item) => item.id === id);
  if (!server) return undefined;
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: `${reverseHost(origin)}/${server.id}`,
    title: server.title,
    version: siteVersion,
    description: server.description.slice(0, 100),
    websiteUrl: `${origin}/agents`,
    icons: [{ src: iconUrl }],
    remotes: [{ type: 'streamable-http', url: server.url, supportedProtocolVersions: ['2025-11-25', '2025-06-18'] }],
    url: server.url,
    transport: 'streamable-http',
    kind: server.kind,
  };
}

export function ardCatalog(origin: string) {
  const host = new URL(origin).hostname;
  const trust = { identity: `did:web:${host}`, identityType: 'did' };
  return {
    specVersion: '1.0',
    host: { displayName: 'Open Media', identifier: `did:web:${host}`, documentationUrl: `${origin}/docs` },
    entries: [
      ...mcpServers(origin).map((server) => ({
        identifier: `urn:air:${host}:mcp:${server.id}`, displayName: server.title, type: 'application/mcp-server-card+json', url: `${server.url}/server-card`,
        description: server.description, tags: ['social', 'mcp', server.kind], auth: { status: server.auth === 'none' ? 'none' : 'required' }, trustManifest: trust,
      })),
      { identifier: `urn:air:${host}:api:rest`, displayName: 'Open Media REST API', type: 'application/vnd.oai.openapi+json;version=3.1', url: `${origin}/v1/openapi.json`, description: 'Public feed, search, profiles and events without a key; the account API with the person’s token.', tags: ['social', 'openapi'], trustManifest: trust },
      ...agentSkills(origin).map((skill) => ({
        identifier: `urn:air:${host}:skill:${skill.name}`, displayName: skill.name, type: 'text/markdown', url: `${origin}/.well-known/agent-skills/${skill.name}/SKILL.md`, description: skill.description.slice(0, 300), tags: ['skill'], trustManifest: trust,
      })),
      { identifier: `urn:air:${host}:agent:a2a`, displayName: 'Open Media agent card', type: 'application/json', url: `${origin}/.well-known/agent-card.json`, description: 'A2A agent card describing Open Media’s public capabilities.', tags: ['a2a'], trustManifest: trust },
    ],
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function skillsIndex(origin: string) {
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: await Promise.all(agentSkills(origin).map(async (skill) => ({
      name: skill.name, type: 'skill-md', description: skill.description,
      url: `/.well-known/agent-skills/${skill.name}/SKILL.md`, digest: `sha256:${await sha256Hex(skillMarkdown(skill))}`,
    }))),
  };
}

export function agentCard(origin: string) {
  return {
    name: 'Open Media',
    description: `${tagline} One feed across Open Media, Farcaster, Lens, Hive and DeSo, cross-network search and events, and a person's own account through their token.`,
    url: `${origin}/`,
    version: siteVersion,
    documentationUrl: `${origin}/agents`,
    iconUrl,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],
    supportedInterfaces: [{ url: `${origin}/open/mcp`, protocolBinding: 'MCP' }],
    skills: [
      { id: 'search', name: 'search', description: 'Plain-language search across public posts on every connected network.', tags: ['search', 'social'] },
      { id: 'get_feed', name: 'get_feed', description: 'The mixed public feed, newest first or transparently ranked, with source links and "why" reasons.', tags: ['feed'] },
      { id: 'get_person_timeline', name: 'get_person_timeline', description: 'One person’s public posts across the networks they list.', tags: ['people'] },
      { id: 'find_upcoming_events', name: 'find_upcoming_events', description: 'Upcoming public events in the San Francisco Bay Area with official registration links.', tags: ['events'] },
    ],
    provider: { organization: 'Open Media', url: sourceRepository },
  };
}

export function apiCatalog(origin: string) {
  return {
    linkset: [{
      anchor: `${origin}/`,
      item: [{ href: `${origin}/v1/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1', title: 'Open Media API' }],
      'service-desc': [{ href: `${origin}/v1/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1', title: 'Open Media OpenAPI specification' }],
      'service-doc': [{ href: `${origin}/docs`, type: 'text/html', title: 'Open Media API documentation' }],
      'service-meta': [{ href: `${origin}/.well-known/oauth-protected-resource`, type: 'application/json', title: 'Protected-resource metadata' }],
      status: [{ href: `${origin}/health`, type: 'application/json', title: 'Health' }],
    }],
  };
}

export function robotsTxt(origin: string): string {
  return [
    '# Open Media welcomes search engines, AI search and agents acting for people.',
    'User-agent: *',
    'Content-Signal: search=yes, ai-input=yes, ai-train=no',
    'Allow: /',
    'Disallow: /v1/me',
    'Disallow: /me/mcp',
    'Disallow: /authorize',
    'Disallow: /oauth/',
    '',
    ...['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended'].flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', 'Disallow: /v1/me', 'Disallow: /me/mcp', '']),
    `Sitemap: ${origin}/sitemap.xml`,
    `schemamap: ${origin}/schemamap.xml`,
    `Agentmap: ${origin}/.well-known/ard.json`,
    '',
  ].join('\n');
}

export function sitemapXml(origin: string): string {
  const urls = [...pages.map((page) => page.path), '/llms.txt', '/llms-full.txt', '/docs/llms.txt', '/v1/openapi.json', '/v1/feed', '/v1/events/upcoming', '/v1/about'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `<url><loc>${origin}${path}</loc><lastmod>${siteUpdated}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

export function llmsTxt(origin: string): string {
  return `# Open Media

> ${tagline} ${promise} ${mission}

Open Media is a free, open-source social app (iPhone, Android, web) with one feed across Open Media, Farcaster, Lens, Hive and DeSo, one inbox, and one post to every network the person chooses. Public data needs no account or key.

## When to use Open Media

- Cross-network social search and feed summaries for Farcaster, Lens, Hive, DeSo and Open Media, with source links.
- One person's posts across the networks they list.
- Upcoming public events in the San Francisco Bay Area (Luma, Meetup, Eventbrite).
- Acting for a signed-in person with their own token: posts, messages, email, contacts, listings, privacy, payments, tips and paid posts.
- Not for Instagram, X, LinkedIn or TikTok feeds; Open Media does not scrape closed networks.

## Start here

- [Agent guide](${origin}/agents.md): when and how to call Open Media.
- [API documentation](${origin}/docs.md): endpoints, errors, rate limits, idempotency, versioning, sandbox.
- [Authentication](${origin}/auth.md): no credential for public data; the person's bearer token for their account.
- [Developer portal](${origin}/developers.md), [sandbox and test mode](${origin}/sandbox.md) and [pricing](${origin}/pricing.md) (free).
- [OpenAPI 3.1](${origin}/v1/openapi.json) and the [API index](${origin}/v1).

## MCP servers (Streamable HTTP)

- Public, no key: ${origin}/open/mcp ([server card](${origin}/open/mcp/server-card))
- The person's account, bearer token: ${origin}/me/mcp ([server card](${origin}/me/mcp/server-card))
- Documentation: ${origin}/docs/mcp ([server card](${origin}/docs/mcp/server-card))

## Ask in plain language

- NLWeb: POST ${origin}/ask with {"query": {"text": "…"}}; [schema map](${origin}/schemamap.xml); public posts as JSON Lines: ${origin}/feeds/posts.jsonl

## Section indexes

- [API and MCP reference](${origin}/docs/llms.txt)
- [Full documentation in one file](${origin}/llms-full.txt)

## Discovery

- [ARD catalog](${origin}/.well-known/ard.json), [agent skills](${origin}/.well-known/agent-skills/index.json), [A2A agent card](${origin}/.well-known/agent-card.json), [API catalog](${origin}/.well-known/api-catalog)

## Plugin and source

- [Claude Code and Codex plugin](${sourceRepository}/tree/main/agent-plugin)
- [TypeScript SDK, CLI and Python client](${sourceRepository}/tree/main/packages) (build from source; not yet on npm or PyPI)
- [Source code (MIT)](${sourceRepository}) and [AGENTS.md for coding agents](${sourceRepository}/blob/main/AGENTS.md)

## Rules

- Agents identify as agents and never pose as people; confirm with the person before publishing, sending, deleting or paying.
- Keep each post's network and link. Messages, email and contacts are never public.
`;
}

export function docsLlmsTxt(origin: string): string {
  return `# Open Media API and MCP reference

> Focused index for agents integrating with Open Media's REST API and MCP servers.

- [API documentation](${origin}/docs.md)
- [Authentication](${origin}/auth.md)
- [Agent guide](${origin}/agents.md)
- [OpenAPI 3.1](${origin}/v1/openapi.json)
- [Public MCP server card](${origin}/open/mcp/server-card)
- [Account MCP server card](${origin}/me/mcp/server-card)
- [Docs MCP server card](${origin}/docs/mcp/server-card)
`;
}

export function llmsFullTxt(origin: string): string {
  return pages.map((page) => page.body(origin)).join('\n\n---\n\n');
}

function notFoundMarkdown(origin: string, path: string): string {
  return `# Not found\n\nThere is nothing at \`${path}\` on Open Media. Start at [llms.txt](${origin}/llms.txt), the [API documentation](${origin}/docs.md) or the [sitemap](${origin}/sitemap.xml).\n`;
}

/** Documentation pages that mention any of the query's words, with the matching lines. */
export function searchDocs(origin: string, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  return pages.map((page) => ({ page, lines: pageMarkdown(page, origin).split('\n').filter((line) => words.some((word) => line.toLowerCase().includes(word))) }))
    .filter((item) => item.lines.length)
    .sort((left, right) => right.lines.length - left.lines.length)
    .map(({ page, lines }) => ({ path: page.path, title: page.title, description: page.description, url: `${origin}${page.path}`, matches: lines.slice(0, 8) }));
}

/** NLWeb schema map: which schema.org types each page and feed carries. */
export function schemaMapXml(origin: string): string {
  const types: Record<string, string> = { '/': 'SoftwareApplication', '/agents': 'TechArticle', '/docs': 'TechArticle', '/developers': 'TechArticle', '/sandbox': 'TechArticle', '/auth': 'TechArticle', '/pricing': 'WebPage', '/about': 'AboutPage', '/contact': 'ContactPage', '/privacy': 'WebPage' };
  const entries = [...pages.map((page) => [`${origin}${page.path}`, types[page.path] ?? 'WebPage']), [`${origin}/feeds/posts.jsonl`, 'SocialMediaPosting']];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<schemamap xmlns="http://www.nlweb.ai/schemas/schemamap/0.1">\n${entries.map(([loc, type]) => `  <url>\n    <loc>${loc}</loc>\n    <schema>https://schema.org/${type}</schema>\n    <lastmod>${siteUpdated}</lastmod>\n  </url>`).join('\n')}\n</schemamap>\n`;
}

// ─── Docs MCP server ─────────────────────────────────────────────────────────

function docsMcp(origin: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'open-media-docs', title: 'Open Media docs', version: siteVersion }, { instructions: 'Search and read Open Media’s documentation for agents and developers: the API, MCP servers, authentication, pricing and privacy. Read-only.' });
    const all = () => pages.map((page) => ({ path: page.path, title: page.title, markdown: pageMarkdown(page, origin) }));
    server.registerTool('search_docs', {
      title: 'Search Open Media docs',
      description: 'Find the Open Media documentation pages that mention a topic, such as "rate limits", "paid posts" or "authentication". Returns matching pages with the matching lines.',
      inputSchema: z.object({ query: z.string().min(2).max(200).describe('Words to look for') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, (async ({ query }: { query: string }) => {
      const results = searchDocs(origin, query).map(({ path, title, url, matches }) => ({ path, title, url, matches }));
      return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results }) }] };
    }) as never);
    server.registerTool('get_docs_page', {
      title: 'Read an Open Media docs page',
      description: 'Read one Open Media documentation page as Markdown by its path: /, /agents, /docs, /developers, /sandbox, /auth, /pricing, /about, /contact or /privacy.',
      inputSchema: z.object({ path: z.enum(pages.map((page) => page.path) as [string, ...string[]]).describe('The page path') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, (async ({ path }: { path: string }) => {
      const page = pages.find((item) => item.path === path)!;
      return { content: [{ type: 'text' as const, text: pageMarkdown(page, origin) }] };
    }) as never);
    return server;
  }, { legacy: 'stateless', responseMode: 'json' });
}

// ─── Routing ─────────────────────────────────────────────────────────────────

const sitePaths = new Set(['/robots.txt', '/sitemap.xml', '/schemamap.xml', '/llms.txt', '/llms-full.txt', '/docs/llms.txt', '/api/llms.txt', '/agents.md', '/auth.md', '/pricing.md', '/index.md',
  '/.well-known/ard.json', '/.well-known/ai-catalog.json', '/.well-known/agent-skills/index.json', '/.well-known/agent-card.json', '/.well-known/api-catalog',
  '/.well-known/mcp/server-card.json', '/.well-known/did.json', '/docs/mcp', '/open/mcp/server-card', '/me/mcp/server-card', '/docs/mcp/server-card']);

export function isSitePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (sitePaths.has(path)) return true;
  if (/^\/\.well-known\/agent-skills\/[a-z0-9-]+\/SKILL\.md$/.test(path)) return true;
  return pages.some((page) => page.path !== '/' && (path === page.path || path === `${page.path}.md`));
}

export function prefersMarkdown(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  if (/text\/markdown/i.test(accept)) return true;
  return aiBots.test(request.headers.get('user-agent') ?? '') && !/application\/json/i.test(accept);
}

function linkHeader(origin: string, path: string): string {
  return [
    `<${origin}/sitemap.xml>; rel="sitemap"; type="application/xml"`,
    `<${md(origin, path)}>; rel="alternate"; type="text/markdown"`,
    `<${origin}/llms.txt>; rel="describedby"; type="text/plain"`,
    `<${origin}/v1/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1"`,
    `<${origin}/docs>; rel="service-doc"; type="text/html"`,
    `<${origin}/.well-known/api-catalog>; rel="api-catalog"`,
    `<${origin}/.well-known/ard.json>; rel="ard"`,
  ].join(', ');
}

const base = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', 'ratelimit-policy': '"per-client";q=120;w=60' };

function respond(body: string, type: string, maxAge: number, extra: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { ...base, 'content-type': type, 'cache-control': `public, max-age=${maxAge}`, ...extra } });
}

const markdownType = 'text/markdown; charset=utf-8';
const jsonType = 'application/json; charset=utf-8';

/** The agent view of the homepage: endpoints, authentication and capabilities as JSON. */
function agentView(origin: string) {
  return {
    name: 'Open Media', description: `${tagline} ${promise}`, mission,
    authentication: { public: 'none', account: 'Authorization: Bearer <the person’s access token>', events: 'OAuth 2.1 with PKCE (S256)', docs: `${origin}/auth.md` },
    mcp: mcpServers(origin).map(({ id, title, url, auth, kind }) => ({ id, title, url, auth, kind })),
    api: { index: `${origin}/v1`, openapi: `${origin}/v1/openapi.json`, docs: `${origin}/docs` },
    capabilities: ['cross-network feed', 'cross-network search', 'person timelines', 'Bay Area events', 'publishing', 'messages and email', 'contacts', 'listings and ratings', 'payments, tips and paid posts'],
    skills: `${origin}/.well-known/agent-skills/index.json`,
    pricing: `${origin}/pricing.md`,
  };
}

/** Serves the site and discovery documents, or returns undefined for other routes. */
export async function handleSiteRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/docs/mcp') return docsMcp(origin).fetch(request);
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;

  if (path === '/') {
    const vary = { vary: 'Accept, User-Agent', link: linkHeader(origin, '/') };
    if (url.searchParams.get('mode') === 'agent') return respond(JSON.stringify(agentView(origin), null, 2), jsonType, 300, vary);
    const home = pages[0];
    if (prefersMarkdown(request)) return respond(pageMarkdown(home, origin), markdownType, 300, vary);
    if (/text\/html/i.test(request.headers.get('accept') ?? '')) return respond(pageHtml(home, origin), 'text/html; charset=utf-8', 300, vary);
    return undefined; // JSON API index, as before.
  }

  const asMarkdown = path.endsWith('.md') ? path.slice(0, -3) : undefined;
  const page = pages.find((item) => item.path !== '/' && (item.path === path || item.path === asMarkdown)) ?? (path === '/index.md' ? pages[0] : undefined);
  if (page) {
    const headers = { vary: 'Accept, User-Agent', link: linkHeader(origin, page.path) };
    if (asMarkdown || path === '/index.md' || prefersMarkdown(request)) return respond(pageMarkdown(page, origin), markdownType, 300, headers);
    return respond(pageHtml(page, origin), 'text/html; charset=utf-8', 300, headers);
  }

  const skill = path.match(/^\/\.well-known\/agent-skills\/([a-z0-9-]+)\/SKILL\.md$/);
  if (skill) {
    const found = agentSkills(origin).find((item) => item.name === skill[1]);
    return found ? respond(skillMarkdown(found), markdownType, 3600) : undefined;
  }
  const cardMatch = path.match(/^\/(open|me|docs)\/mcp\/server-card$/);
  if (cardMatch) return respond(JSON.stringify(serverCardFor(origin, cardMatch[1]), null, 2), 'application/mcp-server-card+json', 3600);

  switch (path) {
    case '/robots.txt': return respond(robotsTxt(origin), 'text/plain; charset=utf-8', 3600);
    case '/sitemap.xml': return respond(sitemapXml(origin), 'application/xml; charset=utf-8', 3600);
    case '/schemamap.xml': return respond(schemaMapXml(origin), 'application/xml; charset=utf-8', 3600);
    case '/llms.txt': return respond(llmsTxt(origin), 'text/plain; charset=utf-8', 3600, { link: linkHeader(origin, '/') });
    case '/llms-full.txt': return respond(llmsFullTxt(origin), 'text/plain; charset=utf-8', 3600);
    case '/docs/llms.txt': case '/api/llms.txt': return respond(docsLlmsTxt(origin), 'text/plain; charset=utf-8', 3600);
    case '/.well-known/ard.json': case '/.well-known/ai-catalog.json': return respond(JSON.stringify(ardCatalog(origin), null, 2), jsonType, 3600);
    case '/.well-known/agent-skills/index.json': return respond(JSON.stringify(await skillsIndex(origin), null, 2), jsonType, 3600);
    case '/.well-known/agent-card.json': return respond(JSON.stringify(agentCard(origin), null, 2), jsonType, 3600);
    case '/.well-known/api-catalog': return respond(JSON.stringify(apiCatalog(origin), null, 2), 'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"', 3600);
    case '/.well-known/mcp/server-card.json': return respond(JSON.stringify(serverCardFor(origin, 'open'), null, 2), 'application/mcp-server-card+json', 3600);
    case '/.well-known/did.json': return respond(JSON.stringify({ '@context': 'https://www.w3.org/ns/did/v1', id: `did:web:${url.hostname}`, service: [{ id: `did:web:${url.hostname}#site`, type: 'LinkedDomains', serviceEndpoint: `${origin}/` }] }, null, 2), jsonType, 3600);
    default: return undefined;
  }
}

/** Gives agents a Markdown 404 when they ask for Markdown; other 404s are left as they are. */
export async function agentFriendlyNotFound(request: Request, response: Response): Promise<Response> {
  if (response.status !== 404 || !prefersMarkdown(request) || (response.headers.get('content-type') ?? '').includes('markdown')) return response;
  const url = new URL(request.url);
  return respond(notFoundMarkdown(url.origin, url.pathname), markdownType, 0, {}, 404);
}

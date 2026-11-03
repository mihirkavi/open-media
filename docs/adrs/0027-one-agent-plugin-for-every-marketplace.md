# ADR 0027: One agent plugin for every marketplace, with Sign in with Open Media

- Status: **accepted; built and verified locally** (2026-11-03).
  - The plugin installs in isolated Claude Code and Codex configurations.
  - `claude plugin validate --strict` passes for the plugin and the marketplace.
  - Production needs a deploy for `/account/mcp`, OAuth account sign-in, the new tools, the view and `/terms`.
  - Directory submissions and MCP Registry publishing are owner steps (see Consequences).
- Builds on: [ADR 0012](0012-agent-interfaces-and-design-system.md) (agent interfaces), [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (plugin and WebMCP), [ADR 0005](0005-open-media-events-layer-1.md) (the OAuth provider), [ADR 0026](0026-read-receipts.md).

## Context

The owner asked for "a plugin for this platform which works smoothly for all agent marketplaces, claude, codex", following the latest standards, "the most comprehensive plugin architecture that can control all of openmedia", and "really aesthetic and user experience friendly".

Before this, the plugin had three servers and six skills, with token-based account access. Research into the current standards (2026-11-03: Claude Code plugin reference and directory checklist, OpenAI Codex plugin build and submission pages, agent-plugins.org 1.0.0, agentskills.io, the MCP Registry, Gemini CLI and Antigravity, Cursor, VS Code, MCP authorization spec 2026-07-28) found:

1. **Tokens in manifests block every directory.**
   - Anthropic holds env-sourced headers for review.
   - OpenAI accepts only no auth or OAuth.
   - The Agent Plugins standard has no credential fields at all.
2. **The portable `plugin.json` + `mcp.json` (agent-plugins.org) is now preferred.** Codex prefers it, and VS Code and Cursor read it. It is what Ora's `agent-plugins-repo` check asks for. It was banned in this repo only because Codex then ignored the token setup.
3. **Codex's directory has limits the old manifest broke.** `shortDescription` must be at most 30 characters, and the listing needs a square `composerIcon`, a `supportURL` and a `termsOfServiceURL`.
4. **Antigravity has replaced Gemini CLI for most users** and has its own closed-schema manifest. Gemini CLI remains for enterprise.
5. **Clients sign in by OAuth discovery after a 401.** MCP authorization now prefers client ID metadata documents. The existing authorization server already advertises them, `none`, S256 and `iss`, but it signed in only the Events owner.

## Decision

### 1. Sign in with Open Media (OAuth 2.1) for every account

- A new protected resource, `/account/mcp`, sits behind the existing `@cloudflare/workers-oauth-provider` (`src/accountOAuth.ts`, wired in `worker.ts`).
- `/authorize` sends a request to the account flow when its `resource` is `…/account/mcp` or it asks for scope `account`. Anything else keeps the Events owner flow unchanged.
- The person enters their email and gets the same sign-in code the app uses, then approves a consent screen. The screen names the app, what it may do (read; post and send after asking each time), and where they will return.
- The grant keeps the person's Open Media session in props, which the provider stores encrypted.
- `tokenExchangeCallback` refreshes that session whenever the host refreshes its token, so Supabase's rotating refresh token stays current. The host's token never outlives the session.
- Requests to `/account/mcp` are forwarded to the existing `/me/mcp` handler with the person's own access token. The same database rules, rate limits and tools apply, and nothing widens.
- Account grants and Events grants cannot be used for each other.
- Pages are `no-store`, cannot be framed, have no scripts, and use a strict CSP. Attempts are limited to 10 per IP per 15 minutes. Forms must come from the same origin and match the browser's challenge cookie.

### 2. One plugin folder, a manifest per ecosystem

`agent-plugin/` serves every catalog. Name, version (2.0.0) and the three servers are equal everywhere, and no file holds a token, header or placeholder (enforced by `src/domain/agentSkills.test.ts`):

- `.claude-plugin/plugin.json` + `.mcp.json`:
  - for Claude Code, the Claude directory and VS Code;
  - adds `displayName`, a square `icon`, documentation, support, privacy and terms links, and the commands.
- `.codex-plugin/plugin.json`: Codex's compatibility layout, within directory limits.
- `plugin.json` + `mcp.json`:
  - the Agent Plugins standard, carrying Codex's `interface` under `extensions["com.openai"]`;
  - servers carry only `type` and `url`, since unknown fields could invalidate them.
- `.antigravity-plugin/plugin.json` + `mcp_config.json`: Antigravity.
- `gemini-extension.json` + `GEMINI.md` at the repository root: Gemini CLI, which installs from the repository root.
- `registry/*.server.json`: the official MCP Registry under `site.openmedia/*`.
- Root catalogs:
  - `.claude-plugin/marketplace.json` no longer repeats a stale version;
  - `.agents/plugins/marketplace.json` uses the documented `ON_INSTALL`.
- Icons: a 512 px black rounded tile with the white Open Media mark (`assets/icon.png`), and a 256 px copy (`assets/logo.png`).

### 3. Controlling all of Open Media

- **Tools:** 114 in all (23 public plus 91 account).
  - New: `like_post`, `reshare_post`, `comment_on_post` and `get_post_comments`, with REST under `/v1/me/posts/{id}/…`.
  - Likes, reshares and replies on Farcaster, Lens, Hive and DeSo posts are signed by the person's own device keys. The tools say so instead of pretending.
- **The server card** (`/.well-known/mcp.json`) now lists the tools each server really registers, read from the registration code, so it cannot drift again.
- **Skills:**
  - New: `open-media-inbox` (messages, email, chats, contacts, receipts), `open-media-posting` and `open-media-web-feeds`.
  - The main skill now maps jobs to skills and explains OAuth sign-in.
  - Nine skills in all, synced from `src/domain/agentSkills.ts`.
- **Slash commands (Claude Code):** `catch-up`, `inbox`, `feed`, `post`, `algorithm` and `follow`.

### 4. A view that looks like Open Media

One MCP Apps view (`ui://open-media/view`; the old `ui://open-media/posts` address answers the same) renders:
- posts and web-feed items, with the app's outlined "Open on … ↗" pill;
- the inbox, with unread dots and Sent, Delivered and Read ticks;
- the feed algorithm, with its rules and manifest;
- events, with the date first and a "Register on … ↗" pill;
- profiles.

It is used by 13 tools. It follows the host's theme when the host reports one, otherwise the device's, and paints its own background so it is readable on any host. It loads nothing, calls nothing, and builds every node with `textContent`.

### 5. Terms

- Directories require a terms URL, so `/terms` is a short plain-language page. **The owner must review it before any directory submission.**
- `/contact` serves as the support URL.

## Consequences

- Verified locally:
  - strict Claude validation of the plugin and the marketplace;
  - isolated installs in Claude Code (public and docs servers connect) and Codex (all three servers registered);
  - 236 of 237 Worker tests pass (the LinkedIn PDF fixture is missing from the checkout, as before);
  - the app tests;
  - the view rendered in light and dark with live public data and made-up inbox data.
- Not verified until deployed: the full browser OAuth sign-in from Claude, ChatGPT, Codex, VS Code and Cursor. It needs the owner's email code, and the per-host redirect handling is the provider's.
- Owner steps:
  - review `/terms`;
  - submit the plugin at claude.ai/directory/manage (plugin bundle) and the connectors;
  - submit to OpenAI's plugin portal. OpenAI allows one server per plugin, so submit `/account/mcp` alone. Domain proof goes at `/.well-known/openai-apps-challenge`;
  - publish `registry/*.server.json` with `mcp-publisher` after the DNS TXT or HTTP proof for `openmedia.site`;
  - submit to the Cursor marketplace, the Docker MCP catalog and Smithery;
  - optionally list on skills.sh by installing through `npx skills add`.
- Later:
  - expose public tools on `/account/mcp` before sign-in ("mixed" auth), so a single-server listing works without signing in first;
  - narrower scopes than `account`, for example read-only.

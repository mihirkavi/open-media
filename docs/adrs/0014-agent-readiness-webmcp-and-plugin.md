# ADR 0014: Agent readiness: WebMCP, discovery files and a Claude/Codex plugin

- Status: **accepted** (2026-10-25)
- Builds on: [ADR 0012](0012-agent-interfaces-and-design-system.md) (agent interfaces) and [ADR 0013](0013-identity-contacts-commerce-payments.md) phase 7

## Context

Open Media already had a public API, an OpenAPI document, `llms.txt` and MCP servers. Measured with the Ora agent-readiness score (ora.ai), the public Worker origin scored 49/100 (C) on 2026-10-25. It served JSON at `/`, so it had no readable homepage, JSON-LD, metadata, trust pages or Markdown, and it lacked the discovery files agents look for (sitemap, ARD catalog, agent-skills index, A2A card, API catalog, MCP server cards), WebMCP, `auth.md`, rate-limit and Link headers, idempotency keys and operationIds. There was no packaged plugin for coding agents.

## Decision

1. **The API origin is also a small site** (`services/mail-sync/src/agentSite.ts`). Each page has one Markdown source rendered as HTML (JSON-LD, Open Graph, canonical, `lang`), as Markdown with frontmatter (`Accept: text/markdown`, a `.md` URL, or a known AI crawler user agent) and, for the homepage, as a JSON agent view (`?mode=agent`). Plain requests to `/` still get the JSON API index, so existing clients do not change.
2. **Discovery files** are generated from the same sources: `robots.txt` (search, AI search and user-initiated agents allowed; account routes excluded; `Content-Signal: ai-train=no`), `sitemap.xml` with lastmod, `llms.txt` (every link resolves; account routes are documented in `/docs`, not linked), `/docs/llms.txt`, `/llms-full.txt`, `/.well-known/ard.json` and `ai-catalog.json`, `/.well-known/agent-skills/index.json` (v0.2.0, sha256 digests), `/.well-known/agent-card.json`, `/.well-known/api-catalog` (RFC 9727) and MCP server cards for each server.
3. **WebMCP** tools are data (`src/domain/webMcpTools.ts`): search, feed, events and profiles, all read-only and marked `untrustedContentHint`. The Worker's pages and the web app both register them with `document.modelContext.registerTool()`, falling back to `navigator.modelContext`. Nothing that acts as the person is exposed through WebMCP.
4. **A docs MCP server** (`/docs/mcp`, two tools) complements the product servers.
5. **API conventions for agents:** `WWW-Authenticate` with `resource_metadata` on 401s, `RateLimit-Policy` on every response, Markdown 404s, 404 (not 401) for unknown paths, `Idempotency-Key` on post, listing, paid-post and payment creation, unique operationIds and descriptions on every OpenAPI operation, documented versioning, deprecation and sandbox policies, and `scopes_supported` in the RFC 9728 metadata.
6. **One plugin for Claude Code and Codex** (`agent-plugin/`): a portable `plugin.json` and `mcp.json` (agent-plugins.org), Claude's `.claude-plugin/plugin.json` with `.mcp.json`, and Codex's `.codex-plugin/plugin.json` with its servers inline (Codex's server config has no `type` or `headers`). Skills come from `src/domain/agentSkills.ts`, the same text the Worker serves; a test keeps them equal. Marketplaces are `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` at the repository root.

## Consequences

- Both CLIs validate and install the plugin (`claude plugin validate`, Codex's plugin validator, isolated installs on 2026-10-25), and Claude Code connects to the public server.
- A live Ora score needs this Worker deployed; a local tunnel audit was not permitted in the development session.
- Some Ora checks are outside the code and stay open: a Wikipedia entry, npm SDK and CLI packages, skills.sh and MCP registry listings, a ChatGPT app listing, an Organization address and contact email, and Web Bot Auth keys.

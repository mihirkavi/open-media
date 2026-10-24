# ADR 0012: Agent interfaces for everything, and a refined type system

- Status: accepted
- Date: 2026-10-24

## Context

The Master Builder Prompt treats software agents as participants (sections 40–42), wants AI to work as "an optional natural-language interface to complexity" (section 22) and asks for an integration SDK (section 13). Until now agents could read Open Media's own public posts and profiles through a REST API and use Open Media Events over MCP, but they could not read the mixed feed, search other networks, look up settings or act for a person (post, message, export).

The owner also asked for a more beautiful, detailed design without changing the black-and-white system, and for a website landing page that explains the mission.

## Decision

### Every capability has a programmatic interface

One module, `services/mail-sync/src/agentApi.ts`, exposes the same capabilities two ways that share code:

| Interface | Auth | What it covers |
| --- | --- | --- |
| `GET /v1/feed`, `/v1/search`, `/v1/networks`, `/v1/settings`, `/v1/about` plus the existing `/v1/posts` and `/v1/profiles` | none | The mixed feed (Open Media, Farcaster, Lens, Hive, DeSo) with each post's “Why this?” reasons, plain-language search across networks and settings, every network's real capabilities, the settings index, and the mission |
| `/v1/me`, `/v1/me/posts`, `/v1/posts/{id}/report`, `/v1/me/conversations`, `/v1/me/export` | the person's access token | Publish, delete and report posts, read and send messages, export data |
| `/open/mcp` | none | MCP tools for all public capabilities |
| `/me/mcp` | the person's access token | The same tools plus every account action |
| `/mcp` | OAuth 2.1 | Open Media Events (unchanged) |
| `/llms.txt`, `/v1`, `/v1/openapi.json`, `/.well-known/mcp.json` | none | Discovery for language models, programs and MCP clients |

The feed, search, settings and mission code is the app's own (`src/connectors`, `src/domain`), imported by the Worker, so agents get the same posts, filters, explanations and words as people. Account calls go to Supabase with the person's own token, so row-level security decides what is allowed; a token cannot delete another person's post. People get a token from Settings → Developers and agents; it expires after about an hour. All agent routes share the public per-client rate limit.

Chosen over: a separate agent service (duplicated logic), and OAuth for account MCP (the Worker's OAuth provider serves the single-owner events grant; per-person OAuth through Supabase is a later step).

### Typography and details

- Inter for everything people read and type, Instrument Serif for the few editorial headlines on the landing and mission pages. Both are open-licensed and bundled with the app (`@expo-google-fonts`).
- `src/ui/Text.tsx` maps each weight to its own font file (no faux bold) and applies Inter's dynamic tracking, so large titles sit slightly tighter and small text stays open. ExtraBold is drawn as Bold for a calmer hierarchy.
- The splash screen waits for the fonts, so text never flashes in a fallback face.
- The logo is a transparent mark drawn dark on light and light on dark everywhere, including the launch screen.

### Website

Signed-out visitors on the web see a landing page (`src/ui/LandingPage.tsx`), with the feed at `#feed`, the mission at `#mission` and the developer page at `#developers`. The phone apps still open straight to the feed, with the mission one tap away. Mission text lives once in `src/domain/about.ts` and feeds the landing page, the mission page, `/v1/about` and `/llms.txt`.

## Consequences

- Agents can do everything a person can do with Open Media's own features, but posting to other networks still needs the person's own keys in the app, and chat bridges are reached through the existing `/v1/bridges` routes.
- Access tokens are short-lived by design; a longer-lived, revocable personal token or per-person OAuth for `/me/mcp` would make unattended agents easier and is the next step.
- The Worker now imports app modules, so its TypeScript uses bundler resolution; those modules must stay free of React Native imports.

# Open Media plugin for Claude Code and Codex

This folder is the Open Media agent plugin: two skills and three MCP servers that let an AI coding or chat agent read and act on [Open Media](https://github.com/mihirkavi/open-media), the open social app.

## What it adds

- **MCP servers** (Streamable HTTP)
  - `open-media`: public feed, cross-network search (Open Media, Farcaster, Lens, Hive, DeSo), profiles, timelines and Bay Area events. No key.
  - `open-media-docs`: search and read Open Media's API and agent documentation. No key.
  - `open-media-account`: act for the person with their own token: posts, messages, contacts, listings, privacy, payments (always previewed and confirmed first).
- **Skills**
  - `open-media`: when and how to use Open Media, and the rules for acting for a person.
  - `open-media-payments`: paying, tipping and unlocking safely.

## Install

Claude Code:

```
/plugin install open-media --marketplace mihirkavi/open-media
```

Codex:

```
codex plugin marketplace add mihirkavi/open-media
codex plugin add open-media@open-media
```

## The account server

The public and docs servers need nothing. For `open-media-account`, the person copies an access token from the Open Media app (Settings, then Developers and agents) and sets it as `OPEN_MEDIA_TOKEN` in the environment the agent runs in. Tokens expire after about an hour. Without one, the account tools answer 401 and everything else keeps working.

## Files

- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`: the Claude Code and Codex manifests. (Those two folders hold only their manifest, as both tools require.)
- `.mcp.json`: the MCP servers, read by both. The account server carries the token two ways: `headers` with `${OPEN_MEDIA_TOKEN}` for Claude Code, and `bearer_token_env_var` for Codex.
- There is deliberately no portable root `plugin.json`: when one is present, Codex ignores the servers in `.codex-plugin/plugin.json`.
- `skills/`: generated from `src/domain/agentSkills.ts` with `npm run agent-plugin:sync`; the Worker serves the same files at `/.well-known/agent-skills/`.
- `assets/`: the logo.

## Notes for agents editing this folder

Edit skills in `src/domain/agentSkills.ts`, never the generated `SKILL.md` files, then run `npm run agent-plugin:sync`. Keep the version the same in both manifests. Privacy: https://api.openmedia.site/privacy.

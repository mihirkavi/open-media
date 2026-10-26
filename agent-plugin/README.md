<p align="center">
  <img alt="Open Media" src="assets/logo.png" width="72">
</p>

<h1 align="center">Open Media for Claude Code and Codex</h1>

<p align="center">
  <strong>Give your AI agent the open social web.</strong><br>
  One install adds three MCP servers and two skills, so an agent can read the feed, search every network, find events and, with your permission, act for you on <a href="https://github.com/mihirkavi/open-media">Open Media</a>.
</p>

<p align="center">
  <a href="https://api.openmedia.site/agents">For agents</a> ·
  <a href="https://api.openmedia.site/docs">API docs</a> ·
  <a href="https://api.openmedia.site/privacy">Privacy</a>
</p>

## Install

**Claude Code**

```text
/plugin install open-media --marketplace mihirkavi/open-media
```

**Codex**

```bash
codex plugin marketplace add mihirkavi/open-media
codex plugin add open-media@open-media
```

Then just ask: *"What's new on Farcaster and Lens today?"*, *"Find AI founder events this week"*, or *"Post this to Open Media."*

## What it adds

| | Name | What it does | Key |
| --- | --- | --- | :---: |
| 🔌 MCP | `open-media` | Public feed, cross-network search (Open Media, Farcaster, Lens, Hive, DeSo), profiles, timelines and Bay Area events | None |
| 🔌 MCP | `open-media-docs` | Search and read Open Media's API and agent documentation | None |
| 🔌 MCP | `open-media-account` | Act as the person: posts, messages, contacts, listings, privacy and payments | Your token |
| 📘 Skill | `open-media` | When and how to use Open Media, and the rules for acting for a person | — |
| 📘 Skill | `open-media-payments` | Paying, tipping and unlocking safely | — |

## Acting as you

The public and docs servers need nothing. For `open-media-account`, the agent needs your access token in `OPEN_MEDIA_TOKEN`. Any of these works:

1. **Email code.** The agent asks for your email, Open Media sends you a code, and you tell the agent the code (`request_sign_in_code`, then `sign_in_with_code`).
2. **Command line.** `open-media login you@example.com`, then `export OPEN_MEDIA_TOKEN=$(open-media token)` (see [packages/cli](../packages/cli)).
3. **The app.** Copy a token from **Settings → Developers and agents**.

Tokens expire after about an hour. Without one, the account tools answer 401 and everything else keeps working. Money-moving tools always preview the recipient, amount and fees and need your explicit confirmation.

<details>
<summary><strong>Files, and notes for agents editing this folder</strong></summary>
<br>

- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`: the Claude Code and Codex manifests. Each folder holds only its manifest, as both tools require. Keep the version the same in both.
- `.mcp.json`: the MCP servers, read by both. The account server carries the token two ways: `headers` with `${OPEN_MEDIA_TOKEN}` for Claude Code, and `bearer_token_env_var` for Codex.
- There is deliberately no portable root `plugin.json`: when one is present, Codex ignores the servers in `.codex-plugin/plugin.json`.
- `skills/`: generated from `src/domain/agentSkills.ts` with `npm run agent-plugin:sync`. Edit the source, never the generated `SKILL.md` files. The Worker serves the same files at `/.well-known/agent-skills/`.
- `assets/`: the logo.

</details>

<sub>Part of <a href="https://github.com/mihirkavi/open-media">Open Media</a> · MIT licence</sub>

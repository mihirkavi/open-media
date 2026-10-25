# open-media-cli

Open Media from the command line, for people and AI agents. One feed and search across Open Media, Farcaster, Lens, Hive and DeSo, Bay Area events, your own account, and MCP setup for Claude Code and Codex.

```bash
npx open-media-cli feed --sources farcaster,lens
npx open-media-cli search videos about cooking today
npx open-media-cli events --query "ai founders" --days 7
npx open-media-cli mcp-config codex
```

Install globally to get the `open-media` command: `npm install -g open-media-cli`.

- `--json` prints the API's JSON, for scripts and agents.
- Account commands (`me`, `post`, `payments`) read `OPEN_MEDIA_TOKEN` (copy it in the app: Settings, then Developers and agents).
- `post` publishes only with `--yes`.
- Exit codes: 0 done, 1 the API refused or failed, 2 the command was wrong.

Docs: https://convo-mail-sync.convo-mail-sync.workers.dev/docs · MIT licence.

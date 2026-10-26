<p align="center">
  <a href="https://github.com/mihirkavi/open-media">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/logo-dark.png">
      <img alt="Open Media" src="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/logo-light.png" width="64">
    </picture>
  </a>
</p>

<h1 align="center">open-media-cli</h1>

<p align="center">
  <strong>Open Media from the command line, for people and AI agents.</strong><br>
  Read the feed, search every network, find events, post, and set up MCP for your agent.
</p>

<p align="center">
  <a href="https://api.openmedia.site/docs">API docs</a> ·
  <a href="../sdk">SDK</a> ·
  <a href="https://github.com/mihirkavi/open-media">Open Media</a>
</p>

<p align="center">
  <img alt="The open-media feed command printing two recent Lens posts, each with its link and the reasons it is shown" src="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/cli-terminal.png" width="100%">
</p>

## Install

> [!NOTE]
> The CLI is not on npm yet. Until it is, build it from this repository (Node.js 18+):
>
> ```bash
> git clone https://github.com/mihirkavi/open-media.git
> cd open-media && npm install
> cd packages/cli && npm run build && npm link
> ```
>
> That gives you the `open-media` command. Once published, it will be `npm install -g open-media-cli`.

## Commands

| Command | What it does | Account |
| --- | --- | :---: |
| `open-media feed [--sources farcaster,lens] [--mode raw\|relevant] [--clips]` | The mixed feed | — |
| `open-media search <words…>` | Search every network in plain language | — |
| `open-media events [--query <words>] [--days <1-14>]` | Upcoming Bay Area events | — |
| `open-media profile <handle>` | An Open Media profile | — |
| `open-media timeline <network> <handle>` | One person's posts | — |
| `open-media login <email> [--code <code>]` | Sign in or create an account with an emailed code | — |
| `open-media token` | Print your access token | ✓ |
| `open-media me` | Your profile | ✓ |
| `open-media post <text…> --yes` | Publish a public post | ✓ |
| `open-media payments` | Your payments | ✓ |
| `open-media mcp-config [claude\|codex]` | MCP config for your agent | — |

`open-media --help` lists everything, including `logout` and `set-up-profile`.

## Good to know

- **`--json`** prints the API's JSON, for scripts and agents.
- **Nothing is posted by accident:** `post` publishes only with `--yes`.
- **Account commands** use the session `login` saved, or `OPEN_MEDIA_TOKEN`. Hand a session to an agent with `export OPEN_MEDIA_TOKEN=$(open-media token)`.
- **Exit codes:** `0` done, `1` the API refused or failed, `2` the command was wrong.

<sub>Part of <a href="https://github.com/mihirkavi/open-media">Open Media</a> · <a href="https://api.openmedia.site/docs">Docs</a> · MIT licence</sub>

<p align="center">
  <a href="https://github.com/mihirkavi/open-media">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/logo-dark.png">
      <img alt="Open Media" src="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/logo-light.png" width="64">
    </picture>
  </a>
</p>

<h1 align="center">open-media-sdk</h1>

<p align="center">
  <strong>The official TypeScript client for the Open Media API.</strong><br>
  One feed and one search across Open Media, Farcaster, Lens, Hive and DeSo, in a few lines of code.
</p>

<p align="center">
  <a href="https://api.openmedia.site/docs">API docs</a> ·
  <a href="https://api.openmedia.site/sandbox">Sandbox</a> ·
  <a href="https://api.openmedia.site/v1/openapi.json">OpenAPI</a> ·
  <a href="https://github.com/mihirkavi/open-media">Open Media</a>
</p>

<p align="center">
  <img alt="Dependencies: none" src="https://img.shields.io/badge/dependencies-none-111111?style=flat-square">
  <img alt="Runs on Node 18+, Deno, Bun, browsers and Workers" src="https://img.shields.io/badge/Node%2018%2B%20%C2%B7%20Deno%20%C2%B7%20Bun%20%C2%B7%20Browsers%20%C2%B7%20Workers-111111?style=flat-square">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-6b6b6b?style=flat-square">
</p>

## Install

> [!NOTE]
> The SDK is not on npm yet. Until it is, build it from this repository:
>
> ```bash
> git clone https://github.com/mihirkavi/open-media.git
> cd open-media && npm install
> cd packages/sdk && npm run build
> ```
>
> Once published, it will be `npm install open-media-sdk`.

## Quick start

Reading public posts needs no key.

```ts
import { OpenMedia } from 'open-media-sdk';

const om = new OpenMedia();

// The mixed feed, newest first, with the reasons each post is shown
const page = await om.feed({ sources: ['farcaster', 'lens'], mode: 'raw' });
for (const post of page.data) console.log(post.network, post.author.handle, post.text, post.url);

// Plain-language search across every network
const results = await om.search('videos about cooking today');

// Bay Area events for the next week
const events = await om.events({ query: 'ai founders', days: 7 });
```

## Acting for a person

With the person's own token, every call acts only as them. They can copy one from the app (**Settings → Developers and agents**) or sign in by email code with the [CLI](../cli).

```ts
const me = new OpenMedia({ token: process.env.OPEN_MEDIA_TOKEN });
await me.publish('Hello from my agent', { idempotencyKey: crypto.randomUUID() });
```

## Built to be safe to retry

| | |
| --- | --- |
| **Idempotent writes** | Writes send an `Idempotency-Key` automatically. Pass your own to make retries safe across processes. |
| **Rate limits** | A 429 is retried after `Retry-After` seconds. |
| **Typed errors** | Failures throw `OpenMediaError` with `status`, `code` and `message`. |
| **No surprise payments** | `startPayment` never moves money by itself: card payments return a Stripe page for the person to open, and USDC payments return a transfer for their own wallet. Always show the recipient, amount and fees first. |

## Links

- [API documentation](https://api.openmedia.site/docs), [developer portal](https://api.openmedia.site/developers) and [sandbox](https://api.openmedia.site/sandbox)
- MCP: `https://api.openmedia.site/open/mcp` (public) and `https://api.openmedia.site/me/mcp` (account)
- Also available: the [command line](../cli) and the [Python client](../python)

<sub>Part of <a href="https://github.com/mihirkavi/open-media">Open Media</a> · MIT licence</sub>

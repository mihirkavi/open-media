# open-media-sdk

The official TypeScript client for the [Open Media](https://github.com/mihirkavi/open-media) API. Read one feed and search across Open Media, Farcaster, Lens, Hive and DeSo, find Bay Area events, and act for a person with their own token. No dependencies; works in Node 18+, Deno, Bun, browsers and Workers.

```bash
npm install open-media-sdk
```

```ts
import { OpenMedia } from 'open-media-sdk';

const om = new OpenMedia();
const page = await om.feed({ sources: ['farcaster', 'lens'], mode: 'raw' });
for (const post of page.data) console.log(post.network, post.author.handle, post.text, post.url);

const results = await om.search('videos about cooking today');
const events = await om.events({ query: 'ai founders', days: 7 });
```

## Acting for a person

The person copies a short-lived token from the Open Media app (Settings, then Developers and agents). Every call acts only as them.

```ts
const me = new OpenMedia({ token: process.env.OPEN_MEDIA_TOKEN });
await me.publish('Hello from my agent', { idempotencyKey: crypto.randomUUID() });
```

Writes send an `Idempotency-Key` automatically; pass your own to make retries safe across processes. A 429 is retried after `Retry-After` seconds. Errors are `OpenMediaError` with `status`, `code` and `message`.

Payments (`startPayment`) never move money by themselves: card payments return a Stripe page for the person to open, and USDC payments return a transfer for their own wallet. Always show the person the recipient, amount and fees first.

## Links

- [API documentation](https://api.openmedia.site/docs) and [OpenAPI](https://api.openmedia.site/v1/openapi.json)
- [Developer portal](https://api.openmedia.site/developers) and [sandbox](https://api.openmedia.site/sandbox)
- MCP: `https://api.openmedia.site/open/mcp` (public) and `https://api.openmedia.site/me/mcp` (account)

MIT licence.

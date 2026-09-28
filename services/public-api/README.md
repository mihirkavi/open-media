# Open Media public API

A read-only JSON API over public Open Media posts and profiles. No account or API key is needed. People, scrapers, and AI agents are welcome to use it.

It runs as a Cloudflare Worker (`src/worker.ts`) and only relays the `open_media_public_*` database functions using the Supabase publishable key. Private data (messages, email, contacts, blocks, reports) is not reachable through it.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/` or `/v1` | Machine-readable description of the API |
| GET | `/v1/openapi.json` | OpenAPI 3.1 document |
| GET | `/v1/posts?limit=&cursor=` | Public posts, newest first |
| GET | `/v1/posts/{id}` | One public post |
| GET | `/v1/profiles/{handle}` | One public profile |
| GET | `/v1/profiles/{handle}/posts?limit=&cursor=` | A profile's public posts, newest first |
| GET | `/robots.txt` | Allows all crawlers |

`limit` is 1–50 (default 20). Follow `pagination.next`, or the `Link: rel="next"` header, until it is `null`. Removed posts, and posts hidden after community reports, disappear from every endpoint.

```bash
curl https://<your-api-host>/v1/posts?limit=2
```

```json
{
  "data": [
    {
      "id": "21a32464-edf1-4987-a1ed-a9447b1254cb",
      "type": "post",
      "text": "Hello from Open Media!",
      "createdAt": "2026-09-28T05:24:34.195608+00:00",
      "url": "https://<your-api-host>/v1/posts/21a32464-edf1-4987-a1ed-a9447b1254cb",
      "author": {
        "handle": "tester",
        "displayName": "tester",
        "avatarUrl": null,
        "url": "https://<your-api-host>/v1/profiles/tester"
      }
    }
  ],
  "pagination": { "limit": 2, "nextCursor": null, "next": null }
}
```

Errors use `{ "error": { "code", "message" } }` with `400`, `404`, `405`, `429` (see `Retry-After`), or `502`.

## Run locally

With the local Supabase stack running (`npx supabase start` from the repository root):

```bash
cp services/public-api/.env.example services/public-api/.env   # add the local publishable key
npm run public-api:server                                       # http://127.0.0.1:8790
```

Set `EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL` in the app environment to show the open-data link to signed-out visitors.

## Test

```bash
npm test --prefix services/public-api
npx tsc --noEmit -p services/public-api
```

## Deploy

Not deployed yet. After the `20260927120000_public_posts.sql` migration is applied to the production database:

```bash
cd services/public-api
npm install
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npm run worker:check
npm run worker:deploy
```

The Worker applies a per-IP limit of 120 requests per minute (`PUBLIC_API_RATE_LIMITER`).

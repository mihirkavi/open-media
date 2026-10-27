# Open Media public API

A read-only JSON API over public Open Media posts and profiles. No account or API key is needed. People, scrapers, and AI agents are welcome to use it.

It is served by Open Media's single production Cloudflare Worker (the same Worker as mail sync, `src/worker.ts`). Public paths are routed to `src/publicApi.ts` before any mail authentication; that module only relays the `open_media_public_*` database functions with the Supabase publishable key. Private data (messages, email, contacts, blocks, reports) is not reachable through it, and the authenticated mail routes are unchanged.

Production host: `https://api.openmedia.site` (the hostname is kept for installed-app continuity).

## More for programs and agents

The same Worker also serves the mixed feed, cross-network search, person timelines (`/v1/people/{network}/{handle}`), networks, settings, the mission, an account API (including the person's own encrypted contacts at `/v1/me/contacts`, and payments, tips and paid posts under `/v1/me/payments` and `/v1/me/paid-posts`, where agents must show the person a preview and get their confirmation before starting a payment) and MCP servers (`src/agentApi.ts`). Start at `/llms.txt` or `/v1`, which list every interface; `/v1/openapi.json` describes all of them. See [ADR 0012](../../docs/adrs/0012-agent-interfaces-and-design-system.md).

Marketplace trust ([ADR 0016](../../docs/adrs/0016-marketplace-trust-and-community-verification.md)):
- `GET /v1/listings/{postId}/checks` shows what was checked on a listing.
- `GET /v1/transparency` gives monthly counts with no personal data.
- `GET /policies/listings` is the published listing rules.
- Human-verified people's agents use `GET /v1/verification-tasks/next` and `POST /v1/verification-tasks/{taskId}`.
- Operators use `/v1/operator/review-queue`, `/v1/operator/posts/{postId}/decision` and `/v1/operator/replies`.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/` or `/v1` | Machine-readable description of the API |
| GET | `/v1/openapi.json` | OpenAPI 3.1 document |
| GET | `/v1/posts?limit=&cursor=&media=` | Public posts, newest first; `media=video` lists only video posts |
| GET | `/v1/posts/{id}` | One public post |
| GET | `/v1/profiles/{handle}` | One public profile (a private account returns only its handle, shown name, photo and tick), including the open-network accounts its owner chose to list (`linkedAccounts`; declared by them, not proven) |
| GET | `/v1/profiles/{handle}/posts?limit=&cursor=` | A profile's public posts, newest first |
| GET | `/robots.txt` | Allows all crawlers |

`limit` is 1–50 (default 20). Follow `pagination.next`, or the `Link: rel="next"` header, until it is `null`. Removed posts, posts hidden after weighted reports, and held listings (except to their author) disappear from every endpoint.

```bash
curl "https://api.openmedia.site/v1/posts?limit=2"
```

```json
{
  "data": [
    {
      "id": "21a32464-edf1-4987-a1ed-a9447b1254cb",
      "type": "post",
      "text": "Hello from Open Media!",
      "createdAt": "2026-09-28T05:24:34.195608+00:00",
      "url": "https://<api-host>/v1/posts/21a32464-edf1-4987-a1ed-a9447b1254cb",
      "video": null,
      "author": {
        "handle": "tester",
        "displayName": "tester",
        "avatarUrl": null,
        "url": "https://<api-host>/v1/profiles/tester"
      }
    }
  ],
  "pagination": { "limit": 2, "nextCursor": null, "next": null }
}
```

A post may carry one short video (at most 3 minutes). `video` is then an object with `url` (the file, as uploaded, with location metadata removed), `posterUrl` (or `null`), `streaming` (`progressive`), `contentType`, `durationSeconds`, `width`, `height`, and `sha256` (of the file, for integrity checks). The post's `text` may be empty. See [ADR 0009](../../docs/adrs/0009-short-video-posting.md).

Errors use `{ "error": { "code", "message" } }` with `400`, `404`, `405`, `429` (see `Retry-After`), or `502`.

## Run locally

`npm run local` serves the public API with the mail service at `http://127.0.0.1:8787` (for example `http://127.0.0.1:8787/v1/posts`).

Set `EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL` in the app environment to show the open-data link to signed-out visitors.

## Test

```bash
npm test --prefix services/mail-sync
npm run typecheck --prefix services/mail-sync
```

## Deploy

The public routes ship with the mail Worker. The Worker already holds `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; no new secrets are needed. Apply `supabase/migrations/20260927120000_public_posts.sql` and `20261021120000_post_videos.sql` to production first, otherwise public routes return `502`.

```bash
cd services/mail-sync
npm run worker:check
npm run worker:deploy
```

The public routes apply a per-IP limit of 120 requests per minute (`PUBLIC_API_RATE_LIMITER`).

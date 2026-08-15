# Open Media mail-sync service

This separate service is the only component allowed to handle reusable mailbox credentials. The mobile/web client sends a configuration over HTTPS, the service validates it against the real IMAP or POP server, encrypts the password with AES-256-GCM, and imports recent messages into Open Media's normalized client flow.

## Local run

```bash
export NODE_ENV=development
export CONVO_ALLOW_INSECURE_LOCAL_AUTH=true
npm run mail:server
curl http://127.0.0.1:8787/health
```

Without `DATABASE_URL`, development uses an in-memory repository and an ephemeral encryption key. Restarting the service intentionally forgets those accounts. This mode binds only to `127.0.0.1` and cannot be enabled when `NODE_ENV=production`.

For local durable use, set the variables in `.env.example` and apply the repository's Supabase migrations. The Node entry point defaults to `0.0.0.0` in production; set `HOST` explicitly when another bind address is required.

## Cloudflare Worker production

The production entry point is `src/worker.ts`, configured by `wrangler.jsonc`. It uses Cloudflare's outbound TCP/TLS support for IMAP and POP, validates the Supabase JWT itself, and calls three authenticated PostgREST RPCs. Those RPCs run as the caller and enforce ownership again through RLS; the Worker never receives a database password or service-role key.

Configure these Worker secrets before deployment:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
MAIL_CREDENTIALS_KEY
```

`MAIL_CREDENTIALS_KEY` must be a base64-encoded 32-byte key and must never be placed in Expo configuration. Generate Worker types and validate the bundle with `npm run worker:types` and `npm run worker:check`. Deploy with `npm run worker:deploy`.

The current production health endpoint is `https://convo-mail-sync.convo-mail-sync.workers.dev/health`.

## Endpoints

- `GET /health`
- `POST /v1/mail-accounts` — authenticate, validate a TLS mailbox, encrypt its password, return a safe account record
- `POST /v1/mail-accounts/:id/sync` — import the latest 100 IMAP Inbox messages or latest 50 POP messages for the authenticated owner

Production requests require a Supabase bearer JWT. `x-convo-local-user` is accepted only when the explicit local-development flag is enabled. Mailbox hostnames are resolved and rejected if any answer points to loopback, link-local, private, multicast, or reserved space.

## Known limits

- IMAP currently imports only `INBOX`; folders, cursors, flag updates, and IDLE are next-stage work.
- POP is import-only and does not delete server messages.
- Plain-text bodies are capped at 50,000 characters; HTML and attachments are not stored.
- SMTP sending is deliberately absent until draft review, identity selection, auditing, and abuse controls are implemented.

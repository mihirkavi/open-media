# Convo mail-sync service

This separate Node service is the only component allowed to handle reusable mailbox credentials. The mobile/web client sends a configuration over HTTPS, the service validates it against the real IMAP or POP server, encrypts the password with AES-256-GCM, and imports recent messages into Convo's normalized client flow.

## Local run

```bash
export NODE_ENV=development
export CONVO_ALLOW_INSECURE_LOCAL_AUTH=true
npm run mail:server
curl http://127.0.0.1:8787/health
```

Without `DATABASE_URL`, development uses an in-memory repository and an ephemeral encryption key. Restarting the service intentionally forgets those accounts. This mode binds only to `127.0.0.1` and cannot be enabled when `NODE_ENV=production`.

For local durable or production use, set the variables in `.env.example`, apply the repository's Supabase migration, and run the service from an HTTPS platform that supports normal outbound TCP/TLS connections. Production defaults to `0.0.0.0`; set `HOST` explicitly when your platform requires another bind address. Do not deploy this as a browser bundle or place `DATABASE_URL`/`MAIL_CREDENTIALS_KEY` in the Expo environment.

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

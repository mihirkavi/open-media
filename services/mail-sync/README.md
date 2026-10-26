# Open Media mail-sync service

> **The one Cloudflare Worker behind Open Media:** email (IMAP, POP and SMTP), the public and account API, MCP servers, cross-posting, chat-bridge control and Open Media Events. Live at `https://api.openmedia.site` ([health](https://api.openmedia.site/health)).

| Start here | |
| --- | --- |
| Run it locally | `npm run local` from the repository root |
| Deploy | `npm run worker:deploy`, after applying Supabase migrations |
| Public API | [PUBLIC_API.md](PUBLIC_API.md) |
| Events | [docs/events](../../docs/events/README.md) |

This Cloudflare Worker is the only component allowed to handle reusable mailbox credentials. The mobile/web client sends a mailbox configuration over HTTPS; the Worker validates it against the real IMAP or POP server (and the SMTP server, when sending is enabled), encrypts the password with AES-256-GCM, imports recent mail, and sends replies. The same Worker also serves the public read API ([PUBLIC_API.md](PUBLIC_API.md)) and Open Media Events.

## Local run

Use the repository's one-command setup, which starts local Supabase, writes `.dev.vars`, and runs the mail service on Node.js at `http://127.0.0.1:8787`:

```bash
npm run local
```

Locally, `src/localServer.ts` runs the same request handler as the Worker (`src/mailHandler.ts`) on Node.js, with in-memory rate limits. To run only the mail service after `npm run local` has written `.dev.vars` once: `npm run mail:server` from the repository root. To try the Cloudflare runtime itself, use `npm run worker:dev` (Node.js 22).

Why Node.js locally: inside the Workers runtime, the IMAP library stalls on some servers. Gmail stops responding after `CAPABILITY`, while iCloud works; the same code works on Node.js. See Known limits.

`.dev.vars` (gitignored) sets `MAIL_ALLOW_LOCAL_SERVERS=true`, which allows mail servers on this machine, such as the local test inbox's SMTP server at `localhost:54325`, without TLS. Production never sets it.

## Cloudflare Worker production

The production entry point is `src/worker.ts`, configured by `wrangler.jsonc`. It uses Cloudflare's outbound TCP/TLS support for IMAP, POP, and SMTP, validates the Supabase JWT itself, and calls authenticated PostgREST RPCs. Those RPCs run as the caller and enforce ownership again. The Worker never receives a database password, and it holds a Supabase secret key only when identity verification is turned on (below), where the key can call just the two verification functions granted to `service_role`.

Worker secrets:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
MAIL_CREDENTIALS_KEY
```

Optional, for Farcaster cross-posting (both or neither):

```text
FARCASTER_APP_FID        Open Media's own Farcaster account ID
FARCASTER_APP_MNEMONIC   that account's custody mnemonic (dedicated to Open Media, never a personal account)
```

Until both are set, `/v1/cross-posting/status` reports Farcaster as off and the app shows it as "Coming soon".

Optional, for identity verification with Stripe Identity (ADR 0013; all four or none):

```text
STRIPE_SECRET_KEY               Stripe key with Identity enabled (use a test-mode key until live use is approved)
STRIPE_IDENTITY_WEBHOOK_SECRET  signing secret of the webhook pointed at /v1/verification/stripe/webhook
SUPABASE_SECRET_KEY             used only to record verification results
VERIFICATION_RETURN_URL         where Stripe sends people afterwards, e.g. the app's #profile page
```

Subscribe the webhook to `identity.verification_session.verified`, `.requires_input`, `.canceled` and `.redacted`. Until all are set, the app says verification is "Not available yet" and nobody has a blue tick. Legal names are encrypted with `IDENTITY_KEY`, or a key derived from `MAIL_CREDENTIALS_KEY`.

`MAIL_CREDENTIALS_KEY` must be a base64-encoded 32-byte key and must never be placed in Expo configuration. Generate Worker types and validate the bundle with `npm run worker:types` and `npm run worker:check`. Deploy with `npm run worker:deploy`, after applying the repository's Supabase migrations to production.

The production health endpoint is `https://api.openmedia.site/health`.

## Endpoints

- `GET /health`
- `GET /v1/mail-accounts` — safe mailbox metadata (including whether it can send) for the authenticated owner
- `POST /v1/mail-accounts` — test the incoming server and, if given, the outgoing (SMTP) server; encrypt the password; return a safe account record
- `POST /v1/mail-accounts/:id/sync` — import the latest 100 messages from IMAP `INBOX` and the Sent folder, or the latest 50 POP messages
- `POST /v1/mail-accounts/:id/send` — send a plain-text email (up to 10 recipients) through the mailbox's SMTP server, threaded with `In-Reply-To`, and store it as sent mail
- `DELETE /v1/mail-accounts/:id` — delete the owner's encrypted credential and imported messages
- `GET /v1/cross-posting/status` — unauthenticated; which cross-posting networks this server supports (`{ farcaster: boolean }`)
- `POST /v1/cross-posting/farcaster/signed-key-request` — signs a Farcaster signed key request for a public key generated on the person's device (body `{ key: "0x…32 bytes" }`) and returns the `farcaster://` approval link. The device keeps the private key
- `POST /v1/cross-posting/farcaster/messages` — forwards a cast the device already signed (raw protobuf bytes, at most 4 KB) to a public Snapchain node, because browsers can't post to the node directly

Requests require a Supabase bearer JWT. Mailbox hostnames are resolved and rejected if any answer points to loopback, link-local, private, multicast, or reserved space. SMTP uses implicit TLS (port 465) or required STARTTLS (port 587), with certificate validation against the configured hostname.

Per user and Cloudflare location, the Worker allows five connection tests, twelve syncs, and ten sends per minute. Database ownership checks remain the authorization boundary; rate limits are an additional abuse-control layer.

## Verified senders (BIMI)

During sync, `src/senderVerification.ts` marks a message as from a verified sender when the receiving server's topmost `Authentication-Results` header records `dmarc=pass` for the From domain, the domain's DMARC policy is enforced (`quarantine`/`reject`), and its BIMI record has an HTTPS SVG logo plus a mark certificate whose leaf is a BIMI certificate (EKU `1.3.6.1.5.5.7.3.31`) for the domain, currently valid, and signed by the next certificate in the file. DNS lookups use DNS-over-HTTPS and are cached per domain for six hours. The app shows the logo, a blue check, and the domain.

## Attachments and images

Sync keeps up to 10 attachments per message (15 MB each) and uploads them to the private `mail-attachments` Storage bucket under `<user id>/<mailbox id>/…`, using the person's own session (Storage policies allow only their folder; the save function rejects paths outside it). Messages whose attachments are already stored are not re-uploaded. Larger files keep metadata only. HTTPS `<img>` URLs from the HTML body are stored as URLs (at most 8, tracking pixels removed) and loaded by the app only on request. Removing a mailbox deletes its folder; deleting the Open Media account deletes the person's whole folder first.

## Known limits

- IMAP reads `INBOX` and the Sent folder only; other folders, cursors, flag updates, and IDLE are next-stage work.
- POP is import-only and does not delete server messages.
- Plain-text bodies are capped at 50,000 characters; HTML is not stored, and replies are sent as plain text without attachments.
- SMTP uses the same username and password as the incoming server.
- Microsoft (Outlook.com, Microsoft 365) usually requires OAuth for IMAP/SMTP, which is not implemented.
- Verified-sender checks do not yet validate the mark certificate chain up to a pinned Mark Verifying Authority root; the domain is always shown next to the name so lookalike domains remain visible.
- Brand logos are SVG and display on web; native apps show initials until an SVG renderer is added.
- In the Cloudflare Workers runtime, IMAP to Gmail stalls (verified locally with `wrangler dev`, 2026-10-16); iCloud works. Until this is fixed (a Workers-compatible IMAP client, or hosting mail sync on Node.js), production Gmail IMAP should be treated as not working.

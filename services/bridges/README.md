# Open Media chat bridges

WhatsApp and other chat apps join Open Media's Messages through [mautrix](https://docs.mau.fi/bridges/) bridges on a private Matrix homeserver (ADR 0011). This folder holds the Docker Compose stack; `scripts/bridges.ts` generates its configuration.

## How it fits together

```text
Open Media app ──(Supabase session)──▶ Open Media service (services/mail-sync, /v1/bridges/*)
                                             │  acts only as that person's Matrix user @om_<id>
                                             ▼
                                   Synapse (private, no federation) ◀──▶ mautrix-whatsapp ──▶ WhatsApp
```

- Each Open Media account maps to one Matrix user, `@om_<account id>`, owned by Open Media's application service. There are no Matrix passwords or per-user tokens; the service acts as the signed-in person only, so the homeserver itself keeps everyone's chats apart.
- Linking an account uses the bridge's provisioning API (QR code or WhatsApp's "link with phone number" pairing code). The bridge joins new chats as the person automatically.
- Bridged chats are not end-to-end encrypted inside Open Media, and the bridge server can read them. The app says so before anyone connects.

## Local development

```bash
npm run bridges        # generate .local/bridges and start Synapse + the WhatsApp bridge
npm run local          # restart so the mail service and app pick up the bridges
npm run bridges:stop
```

Settings → Email & connections → Chat networks then offers WhatsApp. Generated configuration, databases and secrets live in `.local/bridges` (gitignored).

## Production (owner steps, not done yet)

1. A small Linux VM (about 4 GB RAM) with Docker and a subdomain such as `matrix.<open-media-domain>`.
2. Run the same stack with PostgreSQL 16 for Synapse and each bridge (one database each), and a TLS reverse proxy (for example Caddy) in front of Synapse's client API and each bridge's `/_matrix/provision` path.
3. Set the Worker secrets: `BRIDGES_HOMESERVER_URL`, `BRIDGES_SERVER_NAME`, `BRIDGES_AS_TOKEN`, `BRIDGES_PROVISIONING_SECRET` and `BRIDGES_WHATSAPP_URL` (plus `BRIDGES_<NETWORK>_URL` for each further bridge), and build the app with `EXPO_PUBLIC_CHAT_BRIDGES=1`.
4. Back up the databases; they hold people's linked-device sessions.

## Networks

| Network | Image | Sign-in |
|---|---|---|
| WhatsApp | mautrix/whatsapp:v0.2610.0 | QR code or pairing code |
| Signal | mautrix/signal:v0.2610.0 | QR code (linked device) |
| Google Messages | mautrix/gmessages:v0.2610.0 | Google account |
| Instagram | mautrix/meta:ig-v0.2610.0 (Instagram build) | Cookies, or username and password |
| Messenger | mautrix/meta:v0.2610.0 | Cookies, or username and password |
| LinkedIn | mautrix/linkedin:v0.2609.0 | Cookies and request headers |
| X | mautrix/twitter:v0.2609.0 | Cookies, or username and password |
| Bluesky | mautrix/bluesky:v0.2510.0 | App password |
| Slack | mautrix/slack:v0.2610.0 | Email, token and cookie, or Slack app |

Not running: Telegram (needs an API ID and hash from my.telegram.org, an owner step), Discord (its bridge hasn't moved to the bridgev2 login API yet). To add a network, add it to the table in `scripts/bridges.ts` and to the Compose file, and set its `BRIDGES_<NETWORK>_URL`. Settings shows it as connectable as soon as the server reports it.

The bridges are AGPL-3.0. Running them unmodified is fine; a modified bridge must offer its source to its users.

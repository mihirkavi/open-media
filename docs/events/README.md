# Open Media Events (Layer 1)

Open Media Events lets any AI agent discover, compare, discuss and plan real-world events for a person. Ask ChatGPT, Claude or another MCP client something like *"Find something this weekend where I can meet founders and make friends, but no superficial mixers."* The agent searches several event platforms at once, removes duplicate listings, ranks the results against your stated and learned preferences with reasons, checks your schedule, places calendar holds you approve, and hands you the official registration link. It never pretends you are registered.

It is built agent-agnostic. Your events, plans, preferences and feedback live in Open Media's own store behind one MCP interface and a matching REST API, not inside any one assistant's memory.

## How to use it

### Connect an assistant

The production endpoint is the single Open Media Worker:

```
https://convo-mail-sync.convo-mail-sync.workers.dev/mcp
```

It uses OAuth 2.1. When an assistant connects, a sign-in page asks for the **owner access code**, which is stored in the owner's macOS Keychain:

```bash
security find-generic-password -s open-media-events-owner-code -a owner -w
```

- **ChatGPT:** Settings → Apps & Connectors → Advanced settings → turn on Developer mode. Then Create, set the MCP server URL above, and choose OAuth authentication. Approve with the access code.
- **Claude (claude.ai or desktop):** Settings → Connectors → Add custom connector, then paste the URL.
- **Claude Code:** `claude mcp add --transport http open-media-events https://convo-mail-sync.convo-mail-sync.workers.dev/mcp`

Whether a connector can be used during ChatGPT **voice** conversations depends on ChatGPT's current voice features; this project has not verified it. The tools return a short `voice_summary` for spoken answers either way.

### Subscribe to the plan calendar once

Ask the assistant to "give me my plan calendar link" (`get_calendar_feed`; `rotate_calendar_feed` issues a new one). In Apple Calendar on Mac, choose File → New Calendar Subscription, paste the URL, set the location to **iCloud** so it syncs to your iPhone, and set auto-refresh to every 5 or 15 minutes. Holds appear as `Hold: …` (tentative) and confirmed plans as normal events. Anyone with the URL can read your plan titles and times. Ask to rotate it if it leaks.

### Optional: let it see your existing calendar

Availability checks read your busy times through **Cal.com**, which already connects to iCloud. Create an API key in Cal.com → Settings → Developer → API Keys, then store it as a Worker secret yourself. Never paste it into chat.

```bash
cd services/mail-sync && npx wrangler secret put CALCOM_API_KEY
```

Until then, `check_schedule` says plainly that it checked only Open Media plans, not your calendar.

## What it can do now

| Capability | Status |
|---|---|
| Search Luma, Meetup and Eventbrite in parallel, plus any ICS feed or schema.org page you add | Working (verified in production on 2026-10-13: 373 listings, 340 unique, about 8 s cold) |
| Cross-platform de-duplication (one organizer posting to 6 Meetup groups and Eventbrite becomes one event) | Working |
| Transparent ranking with reasons and cautions; hard constraints vs soft preferences; exploration share | Working |
| Optional semantic matching with Workers AI embeddings | Wired; falls back to lexical matching when unavailable |
| Preferences with temporary vs permanent scope; feedback as weak evidence; learned signals with confidence | Working |
| Schedule check with Open Media plan conflicts and labeled travel estimates | Working |
| Calendar conflicts against iCloud via Cal.com | Built and unit-tested; **needs your Cal.com API key** and has not been verified against a live account |
| Tentative holds and confirmed plans on a subscribed iCloud calendar | Working (signed ICS feed) |
| Registration | **Link handoff only.** No provider permits programmatic attendee RSVP for this integration. You register on the official page and the assistant records the outcome as `user_reported` |
| Event-change monitoring | Re-reads upcoming planned events every 4 hours and records time, venue, status and availability changes |
| Export (JSON or Markdown) and deletion of personal history | Working |
| REST/OpenAPI mirror of every tool | Working: `POST /v1/events/tools/<tool>`, spec at `/v1/events/openapi.json` |

## Provider capability matrix (verified 2026-10-13)

| Provider | Discovery | Details | Your account events | Register | How |
|---|---|---|---|---|---|
| Luma | Yes (geo) | Yes | No | Handoff | [luma-discovery](https://github.com/mihirkavi/luma-discovery): Luma's public web data. The documented API is organizer-only (Luma Plus). |
| Meetup | Yes (topic pages) | Yes | No | Handoff | [structured-event-feeds](https://github.com/mihirkavi/structured-event-feeds): schema.org data on sitemap-listed `/find/` pages. robots.txt forbids search query parameters. The GraphQL API needs Meetup Pro. |
| Eventbrite | Yes (browse pages) | Yes (event page gives time) | No | Handoff | structured-event-feeds. The public search API was discontinued. |
| Organization feeds | Yes | Yes | No | Handoff | structured-event-feeds: ICS/webcal or schema.org (Stanford, IEEE chapters, Meetup group ICS, Luma calendar ICS). |
| Cal.com | – | – | – | – | [calcom-availability](https://github.com/mihirkavi/calcom-availability): read-only busy times. It cannot create arbitrary iCloud events, so holds use the plan feed. |
| Ticketmaster | Not configured | – | – | – | Planned P1 (Discovery API key) |

Assistant-side plugins (for example ChatGPT's Meetup, Luma, Eventbrite and Cal.com connectors) are not callable from an independently hosted backend. That's why the three extensions above exist as separate open-source repositories. They only read public data, respect robots.txt, and never sign in, register or purchase.

## Architecture

```text
ChatGPT · Claude · other agents          apps / scripts
            │  MCP (Streamable HTTP, OAuth 2.1) │  REST + OpenAPI
            └──────────────┬───────────────────┘
          services/mail-sync Worker (single production Worker)
            src/events/http.ts     MCP + REST + signed ICS feed + OAuth owner sign-in (auth.ts)
            src/events/tools.ts    22 tool contracts (zod), scopes events:read / events:write
            src/events/engine.ts   orchestration: search, plan, register handoff, preferences
              ├─ providers.ts      capability registry + parallel provider router (per-provider timeouts)
              ├─ dedupe.ts         staged duplicate detection and canonical merge
              ├─ ranking.ts        weighted, explainable scoring + exploration
              ├─ lifecycle.ts      plan state machine (hold ≠ registration ≠ attendance)
              ├─ calendar.ts       Cal.com availability + plan calendar feed
              └─ store.ts          Cloudflare D1 (open-media-events)
            Providers: luma-discovery · structured-event-feeds · calcom-availability (public repos)
```

**Storage:** Cloudflare D1 instead of the plan's PostgreSQL + PostGIS. D1 needs no extra credentials, doesn't pause, and binds directly to the existing Worker, while the Supabase project used by the app was paused. Every user-owned table has `user_id`. Distance uses haversine in code. `EventStore` is the only persistence boundary, so a later move to Postgres/PostGIS stays contained. See [ADR 0005](../adrs/0005-open-media-events-layer-1.md).

**Identity:** canonical `evt_…` ids are independent of providers. `event_sources` maps each provider listing to its canonical event. Recurring occurrences are separate events.

**Safety:** writes that affect the calendar need `user_approved`. Permanent preference changes need `user_confirmed`. Deleting history needs `confirm`. Registration states come only from `record_registration`, marked `user_reported`. The server enforces all of these whatever an agent's instructions say. Organizer text is labeled untrusted.

**Skills:** [`skills/`](../../skills/README.md) has the event-discovery, event-planning, event-registration and event-personalization skills, plus portable YAML workflows.

## Operating it

```bash
cd services/mail-sync
npm test                                   # unit tests (events + existing mail/public API)
npx wrangler d1 migrations apply open-media-events --local
npx wrangler dev                           # needs .dev.vars with EVENTS_OWNER_CODE_SHA256 and EVENTS_FEED_SIGNING_KEY
EVENTS_BASE_URL=http://127.0.0.1:8787 EVENTS_OWNER_CODE=… npx tsx scripts/events-e2e.ts --write
EVENTS_BASE_URL=… EVENTS_OWNER_CODE=… npx tsx scripts/events-call.ts search_events '{"period":"this_weekend"}'
```

Production secrets: `EVENTS_OWNER_CODE_SHA256` (the hash only), `EVENTS_FEED_SIGNING_KEY`, and optionally `CALCOM_API_KEY`. To rotate the owner code, generate a new one, save it in Keychain, and `wrangler secret put EVENTS_OWNER_CODE_SHA256` with its SHA-256.

## Limitations and next steps

- Luma's discovery endpoint is undocumented and may change. Its geo results span the wider Bay Area, so many far events are filtered out.
- Meetup coverage is limited to what topic pages render (about 15–45 events per page). Add your favorite groups' ICS feeds with `add_event_source` for complete coverage of those groups.
- Eventbrite browse pages list dates only. Times are fetched for the top candidates.
- Travel times are straight-line estimates, not live routing.
- One owner account for now. Multi-user sign-in (for example Supabase Auth as the OAuth identity) is the next step for serving others. The schema and the per-user scoping are already in place.
- Not built yet from the Layer 1 backlog: Ticketmaster adapter (EVT-022), webhooks (P1), PostGIS, automated provider registration (no permitted API exists today).

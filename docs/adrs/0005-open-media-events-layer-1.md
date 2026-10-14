# 0005: Open Media Events as an agent-agnostic layer in the production Worker

Date: 2026-10-13. Status: accepted.

## Context

Layer 1 needs event discovery and planning that works from ChatGPT voice today and from other agents later. The plan proposed reusing assistant-side plugins (Meetup, Luma, Eventbrite, Cal.com), owning the data model, PostgreSQL + PostGIS, and a remote MCP server on Cloudflare Workers. The person's Cloudflare convention is one production Worker per project. The Supabase project behind the app was paused.

Three findings changed the plan:

1. **Assistant plugins cannot be called from our backend.** They run inside the assistant, so the backend needs its own provider access.
2. **No provider offers permitted attendee registration** that we can use: Meetup needs Pro plus OAuth approval, Luma's API is organizer-only, and Eventbrite has no public search or order API for this use.
3. **Cal.com reads availability across connected calendars but cannot create arbitrary iCloud events.** Using bookings to fake external events would be wrong.

## Decision

- Serve MCP (`/mcp`), a REST mirror (`/v1/events/tools/*`) and OAuth 2.1 (`@cloudflare/workers-oauth-provider`) from the existing production Worker. The existing mail and public API routes pass through unchanged.
- Build the missing provider access as **separate public MIT repositories** that read only public data: `luma-discovery`, `structured-event-feeds` (ICS + schema.org, robots.txt-aware) and `calcom-availability`.
- Store state in **Cloudflare D1** behind `EventStore`, keyed by `user_id`. Revisit Postgres/PostGIS when multi-user scale or geo queries need it.
- Write calendar holds to a **signed, subscribable ICS feed**. Read availability through Cal.com. Agents see one calendar capability.
- Make registration a **handoff**. Outcomes are recorded as `user_reported`, never as provider-confirmed.
- Use a single-owner OAuth sign-in (an access code stored as a hash) for now, with a fixed internal user id that agents cannot override.

## Consequences

- Usable immediately by one person from any MCP client. Adding users means replacing the owner sign-in with real accounts. The data model doesn't change.
- Provider markup can change. Failures are isolated per provider and reported in every search.
- Subscribed calendars refresh on the calendar app's schedule, so holds are not instant.

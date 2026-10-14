# Open Media Events engine

Layer 1 event discovery and planning, served by the production Worker. See [docs/events](../../../../docs/events/README.md) for the product overview, setup and capability matrix.

| File | Role |
|---|---|
| `http.ts` | MCP endpoint, REST mirror, signed plan-calendar feed, landing page, scheduled refresh |
| `auth.ts` | OAuth 2.1 owner sign-in page (access-code hash; fixed internal user id) |
| `tools.ts` | Tool contracts (zod), scopes, server instructions |
| `engine.ts` | Orchestration used by every interface |
| `providers.ts` | Verified capability registry and parallel provider router |
| `dedupe.ts`, `ranking.ts`, `lifecycle.ts`, `calendar.ts`, `time.ts`, `areas.ts`, `taxonomy.ts` | Domain logic |
| `store.ts` | Cloudflare D1 persistence (the only storage boundary) |

**Agent notes:** keep agent interfaces thin and put behavior in `engine.ts`. Every user-owned query must be scoped by the authenticated `userId`. Never simulate a capability that `PROVIDER_CAPABILITIES` marks unsupported. Tests live in `events.test.ts`.

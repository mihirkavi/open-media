# Worker scripts

| Script | Purpose |
|---|---|
| `events-client.ts` | Shared OAuth + MCP client for scripts |
| `events-e2e.ts` | End-to-end check of Open Media Events (`--write` also holds and releases a plan) |
| `events-call.ts` | Call one events tool from the terminal |

Set `EVENTS_BASE_URL` and `EVENTS_OWNER_CODE`. For production, read the code from Keychain (`security find-generic-password -s open-media-events-owner-code -a owner -w`). Scripts print titles and counts only, never tokens or codes.

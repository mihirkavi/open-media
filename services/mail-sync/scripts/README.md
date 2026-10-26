# Worker scripts

| Script | Purpose |
|---|---|
| `events-client.ts` | Shared OAuth + MCP client for scripts |
| `events-e2e.ts` | End-to-end check of Open Media Events (`--write` also holds and releases a plan) |
| `events-call.ts` | Call one events tool from the terminal |

Set `EVENTS_BASE_URL` and `EVENTS_OWNER_CODE`. For production, read the code from Keychain (`security find-generic-password -s open-media-events-owner-code -a owner -w`). Scripts print titles and counts only, never tokens or codes.
| `set-calcom-key.sh` | Store the Cal.com API key as a Worker secret only after Cal.com accepts it (hidden prompt) |
| `ondc-keys.ts` (`npm run ondc:keys`) | New ONDC signing and encryption key pairs, with the `wrangler secret put` commands. Prints only; keep the private keys out of chat and files |
| `ondc-subscribe.ts` (`npm run ondc:subscribe`) | The ONDC registry `/subscribe` request for Open Media as a marketplace seller app (ADR 0015), from the `ONDC_*` variables; missing business details are marked `<fill in: …>` |
| `ondc-e2e.ts` (`npm run ondc:e2e -- std:080 ONDC:RET16`) | Signed search, select and confirm against the real ONDC handler and a real database (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`); prints counts and codes only |

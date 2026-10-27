# Security

How Open Media protects accounts and data, what was reviewed, and what is still open. Open Media is a public beta: no third-party audit or penetration test has been done yet.

## Reporting a problem

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/mihirkavi/open-media/security/advisories/new), not in public issues.

## How data is protected

- **Accounts.** Sign-in is passwordless: a one-time code or link emailed to you. Codes expire after 15 minutes. Sessions are short-lived access tokens (one hour) with rotating refresh tokens. Agents sign people in with the same emailed code; nothing can sign anyone in without it.
- **The database is the security boundary.** Every table has row-level security, so a client can read or change only what its signed-in person may. Functions that act for a person take their identity from the verified session (`auth.uid()`), never from the request. Functions that take another person's id can be called only by the server. 215 database tests check these rules (`npm run test:db`).
- **Secrets.** Mailbox app passwords are encrypted with AES-256-GCM before they are stored. Contacts are encrypted. Payment details stay with Stripe, and on-chain payments are checked against the chain. Signing keys for ONDC and webhooks exist only as Worker secrets.
- **Webhooks.** Stripe and Supabase webhooks are signature-checked with constant-time comparison and a five-minute replay window.
- **Transport and browsers.** Every response carries HSTS, `nosniff`, a referrer policy, a permissions policy and `X-Frame-Options: DENY`. Pages carry a Content-Security-Policy:
  - The web app runs only its own scripts and connects only over HTTPS or WSS.
  - Server pages allow only their own inline scripts, by SHA-256 hash.
- **Abuse limits.** Each IP is limited to about 120 API requests a minute; an agent identity adds its own bucket but never lifts the IP limit. Sign-in is limited to 10 requests a minute per IP and 3 code emails or checks a minute per address. Agent registration is limited to 5 a minute per IP. Request bodies over 256 KB are refused. Messages are capped at 60 a minute and 1,000 a day per person.
- **Outbound connections.** Mailbox setup accepts only public addresses on standard mail ports, so it cannot be used to probe internal networks.

## Review of 2026-10-26

Two independent reviews covered the Worker and the database. Fixed:

- **High:** opening a direct message with a private profile revealed that person's hidden name, private bio and linked accounts. Now a conversation reveals a profile only after that person writes in it, never for handle-only names, and never across a block.
- **Medium:** a message's sender could later change any column: move it into a conversation they were blocked from, backdate it past rate limits, or relabel it. Clients can no longer edit sent messages.
- **Medium:** minting anonymous agent identities multiplied the per-IP rate limit, which made email-bombing through sign-in possible. Fixed by the limits above.
- **Lower:**
  - Profile columns such as `created_at` were client-writable.
  - Default `TRUNCATE` grants were still in place.
  - Empty conversations could be created directly.
  - Paid-post prices and ratings ignored profile privacy.
  - The mail SSRF filter missed some address ranges, and mail ports were unrestricted.
  - Request bodies had no size cap, and sign-in keys were refetched on every request.
  - The Events consent page did not show where approval redirects; it now names the destination host.
- **Dependencies:** the Worker's production dependencies have no known advisories. This includes the MCP server SDK, Zod, Nodemailer, ws and undici.

## Known limitations

- **Messages are not end-to-end encrypted.** They are protected by database rules, so the operator could technically read them.
- **Uploaded videos sit in a public storage bucket.** Anyone with a video's exact URL can fetch it, even after the post is removed or the profile is made private. The fix is signed URLs or a private bucket served through the Worker.
- **Community moderation can be gamed.** Three reports hide a post, and sockpuppet accounts could hide someone's post.
- **Sign-in emails** come from Supabase's shared sender, limited to about 2 an hour, until Open Media's own sender (`security@openmedia.site`) is turned on.
- **Remaining dependency advisories** are in build tooling or in code paths the app does not call:
  - Expo's CLI (`node-forge`, Zod 3);
  - the Farcaster SDK's test helper (`@faker-js/faker`);
  - `elliptic`, through the DeSo SDK.
- **Chat bridges** (WhatsApp, Instagram and others) run only on a local setup, and their accounts can be restricted by those companies.
- **No independent audit yet.** Treat the beta accordingly: don't connect accounts whose compromise would seriously hurt you.

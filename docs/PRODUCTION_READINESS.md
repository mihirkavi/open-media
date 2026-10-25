# Private-beta production readiness

Last verified: 2026-08-18

This checklist defines “production ready” for the current onboarding private beta. It does not claim that disabled roadmap features are complete.

## Release gates

- [x] Passwordless PKCE onboarding, strict app callback allowlist, stale-session recovery, retry states, and profile validation.
- [x] Device session persistence in OS SecureStore on native platforms, including safe chunking and migration from the former storage path.
- [x] Live profiles, direct-conversation idempotency, persistent messages, realtime refresh, and responsive phone/desktop layouts.
- [x] RLS on exposed user tables plus database-enforced membership, sender, transport, timestamp, ownership, reversible blocks/reports, deletion, export, and message-rate protections.
- [x] Credential-safe mailbox listing, resync, export, and confirmed disconnection; TLS and private-network protections remain server-side.
- [x] Cloudflare per-user connection/sync limits, structured error telemetry without message or credential content, generated Worker binding types, and production health/auth probes.
- [x] Production Supabase migrations match local history and pass remote lint; the production auth allowlist contains `openmedia://auth` and legacy `convo://auth`.
- [x] App and mail typechecks/tests, production web export, clean database rebuild, and 36 database security assertions.
- [x] Local browser flow: magic-link onboarding, callback cleanup, profile creation, profile search, direct conversation, send, realtime receive, account export, and responsive layout.
- [x] Latest signed iOS Store build finished successfully: build 9, EAS `f5916bd3-c316-487a-bbed-f6085bc38fcc`.

## Phase 5: payments (built 2026-10-25, not deployed)

- [x] `20261027120000_payments.sql`: 22 pgTAP checks and a clean lint locally; Worker and domain tests; on-chain checks verified against a real Base Sepolia USDC transfer; web flow checked locally (wallet linking, confirmation sheet, a test transaction left unconfirmed).
- [ ] Owner: approve the migration and Worker deploy.
- [ ] Owner: Stripe test mode. Enable Connect (Express), then set `STRIPE_SECRET_KEY` (an `sk_test_` key), `STRIPE_PAYMENTS_WEBHOOK_SECRET` (endpoint `/v1/payments/stripe/webhook` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`), optionally `STRIPE_CONNECT_WEBHOOK_SECRET` (a Connect endpoint with `account.updated`), and `PAYMENTS_RETURN_URL`.
- [ ] Acceptance: one test-mode card payment and one Base Sepolia USDC payment confirmed end to end (needs a funded test wallet).
- [ ] Live money: only after the owner approves live Stripe keys and Base mainnet, set `PAYMENTS_LIVE=1`.

## Production deploy of 2026-10-25 (Phases 3 and 4)

- [x] Applied `20261026120000_post_listings.sql` and `20261026130000_listing_ratings.sql` with `npx supabase db push --linked` after a dry run; all 9 database suites passed locally first.
- [x] Deployed the Worker as version `f116956c-cc11-487e-89b0-7c3cb6b39dd8`. Rollback target: `4ff6b1f5-d1ba-481f-a402-a75e064edd30`.
- [x] Live probes: `/health`, `/v1/about`, `/llms.txt`, `/v1/feed`, `/v1/posts` and `/v1/openapi.json` (48 paths) return 200; `/v1/events/upcoming` returns real events with Luma, Meetup and Eventbrite all reporting ok; `/v1/search?q=hiking events this weekend` is understood as upcoming events; `/v1/me/listings` and the rating route return 401 without a token; `/open/mcp` lists `find_upcoming_events`.
- [ ] Not verified in production: publishing and rating a listing with a real account (needs a production token; rating also needs Stripe Identity keys).

## Production deploy of 2026-10-25 (Phases 1 and 2)

- [x] Production Supabase migration history matched local history through `20261021120000_post_videos.sql` before this deploy, so the public posts, email and short-video migrations below are already in production.
- [x] Applied `20261024120000_people_and_contacts.sql`, `20261025120000_identity_visibility_follows.sql` and `20261025130000_profile_read_compatibility.sql` with `npx supabase db push --linked` after a dry run. All 7 database suites passed locally first. The compatibility migration keeps installed app versions able to read public, named profile rows and the profiles of people they already talk to.
- [x] Deployed the Worker (`convo-mail-sync`) as version `4ff6b1f5-d1ba-481f-a402-a75e064edd30`, with every change through Phase 2 of ADR 0013 and the agent interfaces of ADR 0012. Rollback target: `b058d7bb-89ed-4620-947c-ff37c123ad72` (`npx wrangler rollback b058d7bb-89ed-4620-947c-ff37c123ad72`).
- [x] Live probes: `/health`, `/v1/about`, `/llms.txt`, `/.well-known/mcp.json`, `/v1/feed`, `/v1/people/hive/acidyo`, `/v1/posts` and `/v1/openapi.json` (44 paths) return 200; `/v1/me/contacts` and `/v1/me/identity` return 401 without a token; the verification webhook reports "not available"; `/open/mcp` lists the public tools including `get_person_timeline`.
- [x] Cloudflare inventory: Open Media runs on the single production Worker `convo-mail-sync`; no sandbox exists.
- [ ] Not verified in production: signed-in account routes (needs a production account token), contact sync with a real account, and identity verification (needs Stripe Identity keys; see `services/mail-sync/README.md`).

## Public posts and open read API (2026-10-09, not yet in production)

- [x] `20260927120000_public_posts.sql` applies cleanly to a local stack and passes `supabase db lint`.
- [x] 27 new database assertions: idempotent/validated/rate-limited publishing, no anonymous table access, public projection without emails or client IDs, keyset pagination, report idempotency, three-reporter auto-hide, blocked-author filtering, and author deletion (63 total with the existing suite).
- [x] Public API routes consolidated into the single production Worker (`convo-mail-sync`) instead of a second Worker; unit tests (including route isolation from mail paths), typecheck, regenerated binding types, and `wrangler deploy --dry-run` pass. No new secrets are required.
- [x] Local browser flow: signed-out public feed, sign-in, publish, report, confirmed delete (reflected in the API), phone and desktop layouts.
- [ ] Restore the paused production Supabase project (found `INACTIVE` on 2026-10-09; the live app backend is unavailable until it is restored).
- [ ] Apply the migration to production (`npx supabase db push --linked`). This makes existing beta profiles publicly readable; notify beta testers first.
- [ ] Deploy the Worker (`npm run worker:deploy --prefix services/mail-sync`); previous production version `05ff616e-a628-4670-9ceb-980a7626b5d6` is the rollback target.
- [ ] Set `EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL=https://convo-mail-sync.convo-mail-sync.workers.dev` in the EAS production environment, then probe `/v1/posts`, `/v1/openapi.json`, and `/health`.
- [ ] Push the sign-in email templates (`supabase/templates/magic_link.html`, `confirmation.html`) to production with `npx supabase config push`, or paste them into Auth → Email Templates. They add the one-time code that lets people sign in when the link opens in a different browser or app than the one that requested it.
- [ ] Decide who handles community-hidden posts until an operator console exists.

## Short-video posting (2026-10-21, not yet in production)

- [x] `20261021120000_post_videos.sql`: public `post-videos` bucket (100 MB, MP4/MOV/WebM/JPEG, author-folder write policies), video columns and constraints on `public.posts`, video in the public projection, `p_media` filter, and `open_media_create_post(..., p_video)` that only accepts the author's own uploaded file. 14 new database assertions (96 total).
- [x] Public API returns `video` (file URL, poster, duration, size, SHA-256) and `?media=video`; API version 1.1.0. Worker tests pass.
- [x] Local browser flow: attach a test MP4 carrying GPS metadata, upload with progress, publish, play in Feed and Clips, read it from the public API (stored file has no location, SHA-256 matches), per-network results, delete removes the files.
- [ ] Hosted Supabase: raise the project's global upload limit to at least 100 MB (the Free plan caps files at 50 MB), then apply the migration.
- [ ] Decide on Cloudflare Stream for playback before public launch (ADR 0009): account ID and Stream API token on the Worker, direct-upload endpoint, ready-state handling.
- [ ] Add a cleanup job for uploads that never became posts.
- [ ] Hidden or moderator-removed video posts: their files stay reachable by direct URL (public bucket). Before launch, serve video through signed URLs (Cloudflare Stream or a private bucket via the Worker), or make moderation removal also delete the Storage object.
- [ ] New iOS/Android development and store builds for `expo-image-picker` and `expo-file-system` (camera, microphone, photo-library permission strings), then verify picking and recording on a device.
- [ ] Post a video to each live network with real connected accounts (Lens/Grove, DeSo/Livepeer, Farcaster embed, Hive link) and confirm how each app displays it.

## Email in Messages and SMTP sending (2026-10-15, not yet in production)

- [x] `20261015120000_mail_smtp_and_inbox.sql`: optional per-mailbox SMTP settings (all-or-nothing constraint), `open_media_*` save/get/list functions alongside the deployed `convo_*` ones, and `open_media_list_mail_messages` for the Messages inbox. Nine new database assertions (72 total) and a clean lint.
- [x] Worker: SMTP login test on connect, `POST /v1/mail-accounts/:id/send` with `MAIL_SEND_RATE_LIMITER` (10/min), IMAP Sent-folder sync, hostname/IP safety for SMTP, Nodemailer 10.1.1 (audit clean). Verified locally under `wrangler dev`: stored email loads into Messages, a reply sends over SMTP with `Re:` subject and `In-Reply-To`/`References`, and is stored as sent mail.
- [x] Retired the Node-only local mail server and its insecure `x-convo-local-user` development bypass; local development runs the real Worker.
- [ ] Apply the migration to production (with the public-posts migration), then deploy the Worker.
- [ ] Production sign-in emails: configure custom SMTP in Supabase Auth (dashboard → Authentication → SMTP) and push the templates; the built-in email service is rate-limited and not meant for real users. Then set `EXPO_PUBLIC_SIGN_IN_EMAIL_CODES=1` for production builds so the sign-in screen offers the one-time code (until then it asks people to open the link).
- [ ] Probe a real mailbox end to end in production (connect with SMTP, sync, reply).
- [x] Verified senders (BIMI) and message-style email formatting; `20261016120000_mail_verified_senders.sql` adds `sender_verified`/`sender_logo_url` with HTTPS-only logo URLs (database-tested).
- [x] Attachments and on-request remote images (`20261017120000_mail_attachments.sql`: private `mail-attachments` bucket with per-user Storage policies) and iMessage-style replies (`20261017130000_message_replies.sql`: same-conversation reply trigger, email `in_reply_to`). Database-tested; verified in the browser with synthetic mail.
- [ ] Production: confirm the `mail-attachments` bucket and policies exist after migrating, and that account deletion clears Storage.
- [ ] Validate BIMI mark-certificate chains against pinned Mark Verifying Authority roots before calling the badge equivalent to Gmail's.
- [ ] Fix or work around IMAP to Gmail stalling in the Workers runtime (local `wrangler dev`, 2026-10-16; iCloud unaffected). Options: a Workers-compatible IMAP client, or hosting mail sync on Node.js. Local development already runs mail sync on Node.js.

## Explicitly out of scope for this release

Clips remain labeled fictional data. Media upload, provider OAuth, outbound email, production Matrix, push notifications, message E2E encryption, and operator moderation tooling are disabled or absent and must not be advertised as working. Native-chat block/report intake is live; post reports and community auto-hide are implemented; a broad public launch still requires an operator moderation console, media safety, and automated native UI coverage.

## Known external/tooling constraints

- The root Expo/Metro build-tool dependency tree contains `image-size` advisories without a published patched version. The affected tooling is not used by the shipped app at runtime; track and upgrade when the supported Expo dependency set moves.
- Local Expo Doctor is blocked only on this Mac's CocoaPods version. EAS is the signed native compile gate.
- Supabase CAPTCHA is not enabled. Authentication and Worker rate limits are active; enable a supported CAPTCHA only together with a tested native token flow.
- Supabase's leaked-password warning is not applicable while Open Media remains passwordless-only; no password credential flow is enabled.

## Release procedure

1. Run `npm run check`, `npm run test:db`, mail-service audit, Expo Doctor, remote migration comparison/lint, Worker dry-run, and production health/unauthorized probes.
2. Build the production iOS profile and wait for `FINISHED`; record the build identifier here.
3. Review the exact worktree scope before committing. Do not stage unrelated changes.
4. Submission to TestFlight/App Review is a separate explicit release action.

## Open Media Events (Layer 1)

- [x] D1 database `open-media-events` created and migration `0001` applied remotely; OAuth KV, Workers AI binding and the 4-hour refresh cron configured on the single production Worker.
- [x] Secrets `EVENTS_OWNER_CODE_SHA256` and `EVENTS_FEED_SIGNING_KEY` set; owner code stored only in the owner's macOS Keychain.
- [x] Production end-to-end check passed on 2026-10-13 (`scripts/events-e2e.ts --write`): unauthenticated MCP rejected, OAuth + PKCE, 22 tools listed, live search across Luma, Meetup and Eventbrite, hold refused without approval, hold placed and released, registration handoff, signed feed and tamper rejection, REST mirror and audience separation.
- [ ] Add `CALCOM_API_KEY` (owner action) and verify `calcom_list_calendars` and busy times against the live iCloud connection.
- [ ] Subscribe to the plan calendar in Apple Calendar (owner action).
- [ ] Connect ChatGPT (Developer mode connector) and confirm whether connector tools are available in voice conversations.

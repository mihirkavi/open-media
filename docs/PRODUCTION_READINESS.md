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

## Profile fields and /@handle addresses (ADR 0019; deployed 2026-10-29)

- [x] Applied `supabase/migrations/20261102120000_profile_fields.sql` on 2026-10-29 after a dry run.
- [x] Deployed with `npm run deploy` on 2026-10-29 (owner said "Deploy it"): Worker `e3e1dc99-12d4-4de5-b1ef-77acb8983c58`, rollback `4c66eaec-0523-4817-8a10-5fbe1313f559`. Live checks: openmedia.site/@mihirkavishwar opens the profile; /mihirkavishwar returns 301 to it; /@mihirkavishwar/resume shows the no-resume page (the owner's work profile is empty).
- [x] Web verified locally on 2026-10-28: Edit profile saves every section; email (only me) and phone (connections) are hidden from signed-out viewers and from the resume; /@handle opens the profile signed in and out; the no-resume page.
- [ ] iOS Simulator and Android emulator (deferred by the owner).

## Work (ADR 0018; deployed 2026-10-28)

- [x] Applied `supabase/migrations/20261101120000_work_profiles_and_jobs.sql` to production on 2026-10-28 (dry run first).
- [x] Deployed web app and Worker with `npm run deploy` on 2026-10-28 (owner said "push and deploy"): Worker `4c66eaec-0523-4817-8a10-5fbe1313f559`, rollback `a91f2f3c-c49a-4935-bf4d-00c2f8ed5b57`. Live checks: `/v1/lenses` lists relevant, raw and work; `/v1/jobs` answers; `/v1/me/professional` refuses without a token; the Work feed opens from Search on openmedia.site.
- [x] Earlier the same day: Worker `a91f2f3c` fixed iCloud IMAP sign-in hanging on Workers (commit `34e9ab0`); rollback `3d5e448c`. Linking an iCloud account on openmedia.site is not yet confirmed by the owner.
- [x] Web verified locally on 2026-10-28 at desktop width and 375 px, signed in and signed out: Work lens from Search, profile changes from Search, LinkedIn-export import through the API (birth date and address dropped), job posting, the job-scam check (held), application draft (nothing sent), export with `jsonResume`, public resume page.
- [ ] iOS Simulator and Android emulator (deferred by the owner on 2026-10-28).
- [ ] Workers AI tailoring checked on real profiles in production.
- [ ] Owner: a LinkedIn developer app (Sign In with LinkedIn using OpenID Connect, Share on LinkedIn) before the LinkedIn connector can move from planned.
- [ ] Owner decision: whether to host Resume Matcher (its own server behind an authenticating proxy, plus a model key).

## Feed lenses (ADR 0017; deployed 2026-10-28)

- [x] App, Worker and database tests pass; `open_media_feed_lenses_test.sql` (12 checks) passes against the local database.
- [x] Web on the local stack, desktop and 375 px: Raw and Relevant differ, a lens written in Search applies and persists, saves to the account after sign-in, shares publicly and is listed by `GET /v1/lenses`.
- [x] iOS Simulator (iPhone 17 Pro, existing dev build, new JS from Metro): the picker sits under the title, Search shows the drafted lens and a shared lens above the keyboard, and choosing the draft switches the Feed to it with video posts only.
- [x] Android emulator (2026-10-28): Search draft → Feed through the lens, picker wrap, "Why this?", saved to the account, kept after a restart, Raw, and sharing through Android's share sheet.
- [ ] iOS share sheet not exercised yet.
- [x] Owner approved the deploy ("Deploy, then build"). Applied `20261031120000_feed_lenses.sql` with `npx supabase db push --linked` after a dry run, and deployed Worker `convo-mail-sync` version `32deeaa0-77c5-4440-be31-d69beba795c8` (rollback `9e6cfd40`). That deploy reused the old web build, so `npm run deploy` then rebuilt the web app and deployed version `3d5e448c-c46f-42a3-9662-27377e9dcc7e`; openmedia.site now serves the lens-aware bundle.
- [x] After deploy: `GET /v1/lenses`, `POST /v1/lenses/draft`, `GET /v1/feed?lens=relevant`, `/docs/feed-lenses` and `/llms.txt` return 200; `open_media_public_feed_lenses` answers anonymously.
- [x] iOS build 15 (EAS `879c1d25`) started with `--auto-submit` to TestFlight.
- [ ] Rescan Ora.

## Marketplace trust and community verification (ADR 0016; deployed 2026-10-27)

- [x] Deployed with the owner's approval ("Yes, I approve"):
  - applied `20261030120000_marketplace_trust.sql` (the dry run listed only this migration);
  - deployed Worker `9e6cfd40-e4e3-445f-821b-d63d18fc8ec9` with the new `* * * * *` marketplace cron (rollback target: `dc2af7c6-4173-42ac-b2a0-1aefe1d05798`).
- [x] Live checks: `/policies/listings` and `/v1/transparency` return 200, `/v1/posts` still answers, the web app serves HTML with its CSP, the Open Media notices account exists, and `wrangler tail` showed the minute cron running with outcome `ok` and no `marketplace_jobs_failed` logs (it began about 12 minutes after the deploy).
- [ ] Owner: set the `WEB_RISK_API_KEY` Worker secret (link reputation is skipped without it).
- [ ] Owner: add operator user ids to `public.operators`.
- [ ] Owner: configure Stripe Identity, which community verification needs.
- [ ] Owner: legal review, a DMCA agent and an India grievance officer before paid selling opens widely.

## ONDC seller app (ADR 0015; built and deployed 2026-10-26, not yet registered with ONDC)

- [x] Deployed with the owner's approval ("Push and deploy"):
  - applied `20261028120000_ondc_stores.sql` after a dry run;
  - deployed Worker `9a46a28e-7b7a-433e-a150-ce9f3caca820` (rollback target: `e05fb970-7104-4aba-a277-9abe17cf0d52`).
- [x] Live probes:
  - `/ondc` reports `configured: false`;
  - `POST /ondc/search` gets NACK 31001 (503);
  - the site-verification page is 404 until `ONDC_REQUEST_ID` is set;
  - `/v1/me/ondc` needs a token (401) and is in the OpenAPI document;
  - the anonymous key is refused for `open_media_ondc_catalog` and `ondc_stores` (42501);
  - `/health`, `/v1/feed`, `/llms.txt` and `/ask` are unchanged.
- [ ] Not yet checked in production: saving a store with a real signed-in account.
- [x] Signing matches ONDC's published example. on_subscribe decryption matches ONDC's Node reference. 13 pgTAP checks pass. Worker tests pass. `npm run ondc:e2e` against the local database: signed search, then on_search with 1 store and 1 item; select, then a ₹5,000.00 quote; confirm, then NACK.
- [x] On `wrangler dev`, the derived public keys and the signed site-verification page match, and an unregistered buyer is refused with 10001 after a real pre-production registry lookup.
- [x] Store screen checked on web (desktop and 375 px, light and dark) and on the iOS Simulator (keyboard, number pad, accessibility labels). Android not run: the Mac has JDK 11, and Android needs 17.
- [ ] Owner, to join the network:
  1. give the API a custom domain (the ONDC `subscriber_id`);
  2. register on portal.ondc.org and request pre-production access;
  3. run `npm run ondc:keys` and set the secrets;
  4. submit `npm run ondc:subscribe` to pre-production;
  5. pass ONDC's log validation and certification flows;
  6. sign the Network Participant Agreement.

## Production deploy of 2026-10-25 (Phases 5 to 7 and agent readiness)

- [x] Applied `20261027120000_payments.sql` and `20261027130000_creator_payments.sql` with `npx supabase db push --linked` after a dry run; all 11 database suites (193 checks) passed locally first.
- [x] Deployed the Worker as `9f670295-8d9f-4684-a31c-c37544ee5c85`, then `85f46fd7-4c50-4a6a-8023-ebae37b2cee2` (MCP Apps view, async payment checks). Rollback target: `f116956c-cc11-487e-89b0-7c3cb6b39dd8`. Payments stay in test mode (`PAYMENTS_LIVE` unset).
- [x] Live probes: the homepage in HTML, Markdown and JSON, every discovery file, `/docs/mcp`, the RFC 9728 metadata with scopes, Markdown 404s and 401 challenges; `/v1/feed` and `/health` unchanged.
- [x] Ora agent-readiness score for the Worker origin: 49/100 (C) before, 86 (A) after the first deploy, 89/100 (A) after the second.
- [x] The plugin installs from GitHub in Claude Code (public and docs servers connect) and Codex.
- [x] Later the same day (owner said "Yes, deploy"): Worker `8f79712a-1de5-4a02-b7e9-129aeba12e32` added agent self-registration, NLWeb `/ask`, `/schemamap.xml` and `/feeds/posts.jsonl`; `d71b78c4-a204-4f91-bc8d-e4b5f2cbb533` put `/ask` on a time budget (it had taken up to 24 seconds); `e05fb970-7104-4aba-a277-9abe17cf0d52` linked the repository and AGENTS.md from `llms.txt` (Ora still could not find the repository, see below). Rollback target: `85f46fd7-4c50-4a6a-8023-ebae37b2cee2`. Live probes: registration, the JWT-bearer exchange, `agent_auth` metadata, `/ask` as JSON and SSE (1 to 2 seconds), the schema map and feed. Ora: 90/100 (A), with both NLWeb checks passing.
- [ ] Owner steps for the remaining Ora points: publish `packages/sdk`, `packages/cli` (npm) and `packages/python` (PyPI); a custom domain (Ora reads the brand as "workers" from the workers.dev host, which sinks brand search, Wikipedia and repository discovery); a ChatGPT app listing; an Organization address and contact email.

## Phase 5: payments (built 2026-10-25; deployed in test mode the same day)

- [x] `20261027120000_payments.sql`: 22 pgTAP checks and a clean lint locally; Worker and domain tests; on-chain checks verified against a real Base Sepolia USDC transfer; web flow checked locally (wallet linking, confirmation sheet, a test transaction left unconfirmed).
- [x] Phase 6 (`20261027130000_creator_payments.sql`): tips and paid posts, 17 more pgTAP checks; web flow checked locally (tips switch, paid post composer, locked and unlocked views, tip and unlock sheets; the public API never returns the paid part).
- [x] Owner approved the migrations and Worker deploy (test mode).
- [ ] Owner: Stripe test mode. Enable Connect (Express), then set `STRIPE_SECRET_KEY` (an `sk_test_` key), `STRIPE_PAYMENTS_WEBHOOK_SECRET` (endpoint `/v1/payments/stripe/webhook` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`), optionally `STRIPE_CONNECT_WEBHOOK_SECRET` (a Connect endpoint with `account.updated`), and `PAYMENTS_RETURN_URL`.
- [ ] Acceptance: one test-mode card payment, one test-mode tip and one Base Sepolia USDC payment confirmed end to end (needs a funded test wallet).
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

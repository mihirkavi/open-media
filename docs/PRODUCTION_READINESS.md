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

## Public posts and open read API (2026-09-27, not yet in production)

- [x] `20260927120000_public_posts.sql` applies cleanly to a local stack and passes `supabase db lint`.
- [x] 27 new database assertions: idempotent/validated/rate-limited publishing, no anonymous table access, public projection without emails or client IDs, keyset pagination, report idempotency, three-reporter auto-hide, blocked-author filtering, and author deletion (63 total with the existing suite).
- [x] Public API unit tests, typecheck, and `wrangler deploy --dry-run`; local end-to-end read of posts/profiles against the local database.
- [x] Local browser flow: signed-out public feed, sign-in, publish, report, confirmed delete (reflected in the API), phone and desktop layouts.
- [ ] Apply the migration to production. This makes existing beta profiles publicly readable; notify beta testers first.
- [ ] Deploy `services/public-api`, set its secrets, set `EXPO_PUBLIC_OPEN_MEDIA_PUBLIC_API_URL`, and probe `/v1/posts` and `/health`.
- [ ] Decide who handles community-hidden posts until an operator console exists.

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

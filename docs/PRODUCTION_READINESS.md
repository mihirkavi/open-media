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

## Explicitly out of scope for this release

Feed and Clips remain labeled fictional data. Publishing, media upload, provider OAuth, outbound email, production Matrix, push notifications, message E2E encryption, and public-content moderation are disabled or absent and must not be advertised as working. Native-chat block/report intake is live; a public social release still requires content persistence, an operator moderation console, media safety, and automated native UI coverage.

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

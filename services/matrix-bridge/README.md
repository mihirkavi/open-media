# Open Media Matrix bridge gateway

This small server keeps Matrix credentials outside the Expo bundle and exposes only the room snapshot and text-send operations currently supported by Open Media. It is deliberately a **local development sandbox**, because every caller currently shares one configured Matrix identity.

Set `MATRIX_HOMESERVER`, `MATRIX_USERNAME`, and `MATRIX_PASSWORD` in the process environment, then run `npm run matrix:server` from the repository root. Configure a development build with `EXPO_PUBLIC_MATRIX_BRIDGE_URL`. The service binds to `127.0.0.1` by default, requires an explicit browser origin, and refuses to start when `NODE_ENV=production`.

A production Matrix connector must use per-user authorization, isolate tokens and sync state per account, authenticate every gateway request, and complete a dedicated abuse/privacy review. Do not publish this sandbox on the internet.

It is a Matrix client gateway, not a WhatsApp, Meta, Signal, or LinkedIn bridge. Provider bridges remain separate services and must be reviewed for security, licensing, and provider authorization before deployment.

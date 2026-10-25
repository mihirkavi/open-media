# packages

Official client packages for the Open Media API, published separately from the app.

- `sdk/`: `open-media-sdk` on npm, the TypeScript client (no dependencies).
- `cli/`: `open-media-cli` on npm, the `open-media` command, bundled with the SDK.
- `python/`: `open-media` on PyPI, the Python client (no dependencies).

Each has its own README, tests and version. `npm run packages:test` runs all three test suites; `npm run check` includes them. Notes for agents: keep the three clients' method names and behaviour (idempotency keys on writes, Retry-After on 429, typed errors) in step with each other and with `services/mail-sync/src/agentApi.ts`.

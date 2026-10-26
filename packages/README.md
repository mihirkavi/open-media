# Client packages

Official clients for the [Open Media API](https://api.openmedia.site/docs), versioned separately from the app. None is published to npm or PyPI yet; each README explains how to build it from source.

| Package | What it is | Language |
| --- | --- | --- |
| [**open-media-sdk**](sdk) | The typed API client, with no dependencies | TypeScript |
| [**open-media-cli**](cli) | The `open-media` command, bundled with the SDK | Node.js |
| [**open-media**](python) | The Python client, with no dependencies | Python 3.9+ |

Each has its own README, tests and version. `npm run packages:test` runs all three test suites, and `npm run check` includes them.

**Notes for agents:** keep the three clients' method names and behaviour (idempotency keys on writes, `Retry-After` on 429, typed errors) in step with each other and with `services/mail-sync/src/agentApi.ts`. Package READMEs use absolute image URLs so they also render on npm and PyPI.

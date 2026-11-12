# Convo repository guidance

- Read the exact Expo SDK 56 documentation at <https://docs.expo.dev/versions/v56.0.0/> before changing Expo or React Native code.
- Preserve the boundary between `src/domain`, `src/connectors`, `src/data`, and `src/ui`.
- Never add real credentials, tokens, mailbox exports, or personal message data to the repository.
- Keep connector support claims aligned with working code. Mock or proposed connectors must be labeled clearly.
- Keep generated output inside this repository or an operating-system temporary directory.

## Finding code (knowledge graph)

- Before grepping or reading whole files, query the graph: `python3 scripts/knowledge-graph/kg.py overview | search <words> | sym <name> | file <path> | impact <name|path> | path <a> <b> | table <name> | route <prefix> | adr <n>`. Then read only the lines you need (`kg.py body <name>`).
- It rebuilds itself when `.ts`/`.tsx`/`.sql`/`.md` files change. Details and limits: `scripts/knowledge-graph/README.md`.

## Cross-platform verification (required for every change)

Open Media ships as one app on web, iOS, and Android. A change is not done until it is tested on every platform it can affect, not just the one it was written on.

- **Web**: run the app (`npm run local`, or the `web` preview) and exercise the change in a browser at desktop width and at phone width (375 px), signed out and signed in. Check the console for errors.
- **iOS**: run it on the iOS Simulator (`npx expo prebuild --platform ios` when native modules change, `pod install`, then `npx expo run:ios --no-bundler` against the running Metro server). Check layout at phone size, the keyboard, safe areas, and native modules such as video. Local sign-in works on the simulator. A physical iPhone needs a TestFlight build from `npx eas-cli build -p ios --profile production --auto-submit`, which the owner runs.
- **Android**: run it on the Android emulator (`npx expo run:android`). This needs JDK 17 or newer; the Mac currently has JDK 11, so install a newer JDK before the first Android run.
- **Shared logic**: add or update unit tests (`npm run check` covers the typecheck, app and Worker tests, and the web export), and run `npm run test:db` for database changes.
- **Report honestly**: say which platforms were verified and how, and name anything not verified (for example, a feature that needs a real network account, a physical device, or production-only services) instead of implying it works.

## Web performance

- Icons come from `src/ui/Icon.tsx` (Ionicons cut down to the icons used). Never import `@expo/vector-icons` or its barrel directly: the barrel alone adds about 450 KB. After using a new icon, run `npm run icons:subset`; the typecheck fails until you do.
- Screens and heavy features that aren't on the first page load with `lazyComponent` (`src/ui/lazyComponent.tsx`) or `import()`, so the web build splits them into their own files. Keep large data (catalogs, SDKs, signing code) out of modules the first page imports.
- Content-hashed build files are served with a one-year immutable cache (`services/mail-sync/src/webApp.ts`), and `npm run build:web` adds font preloads and preconnects to the page.

## Memory and scrolling (ADR 0038)

- Long lists are `FlatList`, never `ScrollView` + `.map`; rows are `React.memo` with stable callbacks.
- Inline video goes through `usePlayback` (`src/ui/usePlayback.ts`): one plays, at most two players exist, and lists report `onViewableItemsChanged` via `reportVisibleMedia`.
- Styles: `useThemedStyles(createStyles)`, never `useMemo(() => createStyles(colors))` per instance.
- Polls set state only when data changed and stop in the background. Module-level caches must be bounded. Context provider values must be memoized.
- Leak check: `globalThis.__openMedia.resources()` in development (web console or Playwright); register new expensive resources with `trackResource`. `src/domain/performanceRules.test.ts` enforces these rules. Open issues and the plan: `docs/PERFORMANCE_SECURITY_REVIEW.md`.

## Agent plugin and agent site

- Skills live in `src/domain/agentSkills.ts`; run `npm run agent-plugin:sync` after changing them (a test fails if `agent-plugin/skills` drifts). Never edit the generated `SKILL.md` files.
- One plugin, many marketplaces (ADR 0027): `agent-plugin/` holds the Claude (`.claude-plugin/`), Codex (`.codex-plugin/`), Agent Plugins standard (`plugin.json` + `mcp.json`), Antigravity (`.antigravity-plugin/` + `mcp_config.json`) and MCP Registry (`registry/`) manifests; Gemini CLI's is `gemini-extension.json` at the repo root. Keep name, version and the three servers equal everywhere (a test checks). The account server is `/account/mcp` with OAuth, so no manifest ever holds a token, header or env placeholder.
- WebMCP tools are data in `src/domain/webMcpTools.ts`, used by both the Worker's pages and the web app. Keep them read-only.

## ONDC seller app

- ADR 0015. Protocol code is in `services/mail-sync/src/ondc/`, store rules are in `src/domain/ondc.ts`, and the database is `supabase/migrations/20261028120000_ondc_stores.sql`.
- ONDC keys exist only as Worker secrets (`npm run ondc:keys` prints them; never commit or paste them). Keep `crypto.test.ts` passing against ONDC's published signing example.
- Never accept an ONDC order action until phase 2 is built. Unsupported actions must NACK with 40001. Callbacks go only to the buyer app's registered host.

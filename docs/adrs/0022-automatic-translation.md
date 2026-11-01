# ADR 0022: Automatic translation into the reader's language

- Status: **accepted; built and verified on the web locally** (2026-10-31). Not deployed. The D1 migration `services/mail-sync/migrations/0002_translations.sql` has not been applied to production. iOS and Android are not tested yet.
- Builds on: [ADR 0006](0006-blockchain-social-networks-in-feed.md) (open networks in the Feed), [ADR 0011](0011-bridged-messaging-networks.md) (bridged chats), [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents)
- Owner rule: no new buttons (2026-10-26). The only control is a quiet note under translated text.

## Context

The Feed mixes Open Media, Farcaster, Lens, Hive and DeSo, and Hive in particular carries a lot of Spanish and Portuguese. Luma event descriptions, clip captions, comments, bridged chats and email can be in any language. A person should be able to read all of it without leaving the app or copying text into a translator.

## Decision

### What the reader sees

- The device detects the language of each item: a post (title and body together), a clip caption, a comment, a chat message, an email body. Detection is local (`src/domain/translation.ts`): the writing system for non-Latin scripts and common words for Latin-script languages. Text under 12 letters once links, handles, hashtags, emoji and numbers are removed is never translated ("gm", a name).
- If the item is not in the reader's language, the app shows the translation automatically, with a quiet line under it: **Translated from Spanish · Show original**. Tapping it shows the original and the line becomes **Original in Spanish · Show English**. That line is the only control, and the choice is remembered per item while the app is open.
- The reader's own outgoing messages are never translated.
- **Settings → Translation → Translate automatically** turns it off. The target language is part of the saved preference (default `en`); a picker can be added there later without other changes.
- Translated email is plain text (links in the original stay in the original). Links, @handles and #hashtags in posts and comments stay highlighted, because the model is told to keep them.

### Engine

- Cloudflare Workers AI, through the Worker's existing `AI` binding. The main model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, prompted to return numbered tags so a whole batch is one call. In a side-by-side test on 2026-10-31 it was clearly better than `@cf/meta/m2m100-1.2b` (m2m100 rendered "Isso é muito legal" as "This is very legal" and cut a Hindi sentence to "Hi friends"), and it keeps names, tags and links.
- `@cf/meta/m2m100-1.2b` (the only general translation model in the catalog) is the fallback, one item at a time, for anything the main model leaves out or answers implausibly.
- The texts are data, never instructions: the system prompt says so, each answer is matched back by number, and an answer more than four times longer than its input is rejected.
- Limits: 20 items and 20,000 characters per request, 5,000 characters per item, about 6,000 characters per model call. The route uses the existing `PUBLIC_API_RATE_LIMITER` (120 a minute) per IP for public text and per person for private text. Workers AI allows 300 text-generation requests a minute per account; translation-task models allow 720.

### Caching and privacy

| Text | Who may ask | Stored on the server |
| --- | --- | --- |
| Public: posts, comments, captions, event descriptions | anyone (`GET` or `POST /v1/translate`, `translate_text`) | the translation, in D1 table `translations`, keyed by SHA-256 of engine version, source, target and text; reused for 90 days |
| Private: Open Media chats, bridged chats, email | only the signed-in person (`POST /v1/translate` with `private: true` and their token, `translate_private_text` on `/me/mcp`) | **nothing**: no cache read or write, no logging of text, `cache-control: no-store` |

- Private text is never stored, so no consent step is needed. It is sent to Workers AI over Cloudflare's network to be translated in memory, the same way the mail service already handles mail. Cloudflare states that Workers AI does not use customer inputs to train models.
- The public cache key is a hash of text anyone can read, so it reveals nothing. A request can only cache what the model produced for the text it sent.
- On the device, translations are kept in memory only, keyed by a 64-bit FNV-1a hash of the same input.

### Agents

- `translate_text` on `/open/mcp` (read-only; public text) and `translate_private_text` on `/me/mcp` (read-only; stores nothing).
- `GET /v1/translate?text=…&to=en&from=…` and `POST /v1/translate` in the OpenAPI document and the API index.
- WebMCP tool `translate_open_media_text` (public text, read-only).
- Agent skill `open-media-translate` (in `src/domain/agentSkills.ts`, synced to the plugin), and a line in `llms.txt`.

## Alternatives considered

- **On-device translation.** No engine works on web, iOS and Android in Expo today without large downloads.
- **Translate everything on the server as it is fetched.** The Feed is mostly read straight from each network on the device, so the server never sees most posts, and it would translate posts nobody reads.
- **A third-party translation API** (DeepL, Google). It means another processor and key for private text. Workers AI is already bound to the Worker.
- **Caching private text with consent.** It saves little (a message is read by one or two people) and adds a consent step. Not caching is simpler and safer.

## Consequences

- Owner steps before production: apply `0002_translations.sql` to `open-media-events` (`npx wrangler d1 migrations apply open-media-events --remote`), then deploy the Worker. Until the migration runs, public translations still work but are not cached.
- Cost: about 20 neurons for a batch of four short posts with Llama 3.3, roughly 500 batches a day inside the free 10,000 neurons. Caching public posts keeps repeat reads free.
- Local development: the Node.js server has no AI binding. Setting `OPEN_MEDIA_LOCAL_AI=true` for `npm run local` borrows the owner's Workers AI binding through Wrangler's `getPlatformProxy` (it bills that Cloudflare account). Without it, translation is quietly off and the original text is shown.
- Detection is heuristic. Short or mixed-language posts may stay untranslated, and close languages (Spanish and Portuguese) can be confused; the model still translates correctly from either.

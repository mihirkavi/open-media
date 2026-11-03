# ADR 0028: Open Media AI, one chat for every model

- Status: **accepted; built and tested on the web locally** (2026-11-03). Not deployed. Production needs the owner to run the migration `20261115120000_ai_chat.sql` and a deploy. Phones are not tested.
- Builds on: [ADR 0022](0022-automatic-translation.md) (Workers AI), [ADR 0023](0023-editable-contacts-and-one-conversation-per-person.md) (one conversation per person), [ADR 0026](0026-read-receipts.md).

## Context

The owner asked for "a unified AI chat": every AI a person talks to (OpenAI, Llama, Claude, any other), in one conversation in the existing Messages interface, under Open Media's AI mark. Underneath should be a popular, secure, open-source router "like OpenRouter", where people can bring their own key and requests are routed automatically. AI searches should be recorded in the same chat.

Constraints:
- The owner's rule: no new buttons, screens or settings. Features work inside existing flows.
- The master plan (§22): AI is an optional natural-language interface. Use local or open models where practical (§37), and label AI-generated content (§41).

Options for routing, researched on 2026-11-03:
- **LiteLLM** (MIT, Python proxy). The most adopted self-hosted gateway, but it needs its own server, and its PyPI package was compromised on 2026-03-24 (versions 1.82.7 and 1.82.8 shipped a credential stealer).
- **Portkey gateway** (MIT, TypeScript). Runs on Workers, but it adds a second service to operate.
- **OpenRouter** and **Cloudflare/Vercel AI Gateway**. Hosted and closed. OpenRouter also charges on credits and sees every request.
- **AI SDK** (Vercel, Apache-2.0, TypeScript). A library, not a service. It runs inside the existing Worker and has first-party providers for OpenAI, Anthropic and Google, plus an OpenAI-compatible provider for the rest.

## Decision

1. **One conversation, pinned first in Messages.**
   - "Open Media AI" uses the AI mark from AI search as its picture: white on a black circle, inverted in dark mode.
   - It is always first in the list.
   - Answers render as Markdown. A line under each answer names the model ("Llama · free", "Claude · claude-sonnet-5-5"), as the master plan's AI-provenance rule asks.
   - While an answer is coming, the AI search loading drawing waits in its place.
   - AI messages can't be replied to individually, and they aren't translated.
2. **Routing in the Worker with the AI SDK** (`services/mail-sync/src/aiChat.ts`).
   - Exact versions are pinned, at least two weeks old (`ai` 7.0.145, `@ai-sdk/openai` 4.0.97, `@ai-sdk/anthropic` 4.0.83, `@ai-sdk/google` 4.0.100, `@ai-sdk/openai-compatible` 3.0.73).
   - Requests go straight from the Worker to each provider; no third party sits in the middle.
   - Supported: OpenAI, Anthropic, Google, OpenRouter (whose `openrouter/auto` routes across hundreds of models), Groq, Mistral, DeepSeek and xAI.
   - The free default is Llama 3.3 70B on Cloudflare Workers AI, the model AI search already uses.
3. **Who answers:**
   1. a model named in the message ("@claude …", "ask gemini …", "claude: …");
   2. otherwise the person's choice ("use GPT from now on", "use model anthropic/claude-opus-5-5");
   3. otherwise their newest key;
   4. otherwise the free model.

   If a provider fails (rejected key, no credit, timeout), the free model answers, and the line under the answer says why. Nothing is retried silently with another paid provider.
4. **Keys without a settings screen.**
   - Pasting a key into the chat saves it. The provider is recognised by the key's shape, or by the message naming it (Mistral and DeepSeek keys have no prefix).
   - The key is encrypted in the Worker with a key derived from `MAIL_CREDENTIALS_KEY` (or `AI_KEYS_KEY`), which the database never sees. Only the ciphertext and the last four characters are stored.
   - The message holding the key is stored, and shown, as "…Ab12". It is never sent to a model. The app also masks it while it is being sent.
   - "forget my Claude key" or "forget all my keys" removes keys. "which models" lists them.
5. **History** lives in the person's own `ai_messages` rows.
   - Row-level security is forced. People can add and delete their rows but never edit them. The newest 5,000 are kept.
   - Signed-in AI searches are recorded server-side with the person's own token, as the search and its summary. The summary's citation numbers are hidden in the chat, because the posts aren't there.
   - Earlier turns, searches included, are the context for the next question (the last 24).
6. **Agents:**
   - `ask_ai` and `get_ai_chat` on the account MCP server.
   - `GET/POST/DELETE /v1/me/ai/messages` in REST, documented in OpenAPI.
   - The tool description tells agents never to paste keys for the person.

## Consequences

- **Verified locally:**
  - `aiChat.test.ts` (6 tests): key detection, intents, routing, encryption, fallback, recording searches.
  - `supabase/tests/open_media_ai_chat_test.sql` (13 checks): ownership, no edits, hint shape, no reading across people, anonymous access refused.
  - The web app at desktop width and at 375 px, light and dark. Tested there: asking the free model, an AI search appearing in the chat, a made-up Anthropic key being saved, masked, rejected and falling back, then forgotten.
- **Not verified:**
  - a real paid provider key (no account was used);
  - the iOS and Android apps;
  - production.
- **The model IDs are defaults** a person can override in words. They will age, and need a periodic look.
- **Owner steps:** run the migration with `npx supabase db push --linked`, then deploy the Worker. No new secret is needed (`AI_KEYS_KEY` is optional).
- **Later:**
  - streaming answers;
  - letting the AI act on settings with confirmation (master plan §22);
  - images and files;
  - a per-person monthly cap on the free model if use grows.

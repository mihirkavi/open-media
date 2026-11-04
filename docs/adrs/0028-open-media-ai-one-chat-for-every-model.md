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
4. **Keys in the chat** (superseded as the main way by §9: Settings → Open Media AI).
   - Pasting a key into the chat saves it. The provider is recognised by the key's shape, or by the message naming it (Mistral and DeepSeek keys have no prefix).
   - The key is encrypted in the Worker with a key derived from `MAIL_CREDENTIALS_KEY` (or `AI_KEYS_KEY`), which the database never sees. Only the ciphertext and the last four characters are stored.
   - The message holding the key is stored, and shown, as "…Ab12". It is never sent to a model. The app also masks it while it is being sent.
   - "forget my Claude key" or "forget all my keys" removes keys. "which models" lists them.
5. **History** lives in the person's own `ai_messages` rows.
   - Row-level security is forced. People can add and delete their rows but never edit them. The newest 5,000 are kept.
   - Signed-in AI searches are recorded server-side with the person's own token, as the search and its summary. The summary's citation numbers are hidden in the chat, because the posts aren't there.
   - Earlier turns, searches included, are the context for the next question (the last 24).
6. **Outside agents:**
   - `ask_ai` and `get_ai_chat` on the account MCP server.
   - `GET/POST/DELETE /v1/me/ai/messages` in REST, documented in OpenAPI.
   - The tool description tells agents never to paste keys for the person.

### 7. Acting for the person (added 2026-11-03)

The owner asked for the AI to be agentic: "help me write my algorithm filter", "change the theme", "help me set this up", "help me onboard and explain the features". Open Media AI now calls tools in a loop of up to six steps.

- **For the free model**, Cloudflare's `workers-ai-provider` (MIT, pinned 4.0.0) lets the AI SDK use the same tool loop with Llama on Workers AI.
- **No new tools were written.** `assistantToolkit` in `agentApi.ts` collects the existing agent tools, with their descriptions, schemas and handlers, and exposes an allowlist run as the person:
  - **Reads:**
    - about Open Media and settings;
    - lenses and drafts;
    - profile;
    - web feeds and follows;
    - mailboxes and chat networks.
  - **Changes**, each after a yes:
    - tune, revert or install a lens;
    - follow or unfollow web feeds and people;
    - profile fields and the professional profile;
    - privacy;
    - read receipts.
  - **Never offered:** publishing, sending messages or email, payments, deleting, blocking, or connecting accounts that need passwords. For those it opens the right place in Settings instead.
- **Your yes is enforced by code, not trusted to the model.** A change runs only when the model sets `confirmed: true` and the person's own latest message is a yes. Otherwise the tool only previews (the algorithm shows exactly what would change), and the server stores the proposed call on the reply. The person's next "yes" carries out exactly that call, whatever the model writes. Text in a post or tool result can never approve anything.
- **Device settings** are applied by the app from `meta.actions`, since they live on the device:
  - appearance;
  - automatic translation;
  - which feed shows;
  - opening a section of Settings, or Profile for privacy.

  A change to the algorithm from the chat reloads the person's lenses and shows the tuned one in the Feed.
- **The system prompt** carries a short tour of Open Media for onboarding, and tells the model never to show tool names or raw data. A filter removes any that slip through.
- **Verified locally with the free model**, on the web:
  - "set my theme to dark" switched the app;
  - "help me connect my email" opened Email & connections;
  - "make my feed show less Hive and more videos" proposed the change, and "yes" saved My Relevant version 3;
  - "give me a tour" answered from `about_open_media`.

  Tests: `aiChat.test.ts` (9) and `aiAssistantTools.test.ts` (3).
- **Limits:**
  - The free Llama model sometimes words things loosely, for example promising a "Revert" option that is really the version history.
  - Larger models brought by key should follow the tools more precisely; none has been tried yet.

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

## 8. Ask or search, and reading the person's own messages (added 2026-11-03)

Search and Open Media AI share one entry, **Ask or search** (⌘K), with one mark: a magnifying glass
holding the AI mark's three dots, drawn to the Ionicons outline proportions so it matches the
other navigation icons. In the desktop sidebar the entry is a navigation row like Feed and
Clips, never a field shape (there is nothing to type there), on one line, with ⌘K shown quietly on
hover. Typing a question or request ("catch me up", "what
does my conversation with Sam look like?", "set my theme to dark") makes **Ask Open Media AI** the
top result; Return sends it to the AI chat and opens it there. Keywords and names still search as
before, with the Ask row last. Guests keep plain search, with the same mark.

So the assistant can answer those questions, it may read, only when the person asks and only for
that person: their Open Media conversations, stored email (at most 40 at a time), bridged chats,
contacts, public search and the feed. Results are shortened (long text, HTML and media cut)
before the model sees them. That text goes to the model answering: the built-in Workers AI model,
or the provider of a key the person pasted. Messages and emails are data, never instructions, and
the assistant still cannot send, publish, pay or delete; account changes still need the person's
own yes.

Cost: the built-in model runs on Workers AI's free daily allowance (10,000 neurons). Tool
descriptions and message text make each agentic answer far larger than a plain one, so on the
free plan the allowance runs out after a modest number of answers. When it does, the chat says so
and suggests adding a key in Settings → Open Media AI, instead of failing.

## 9. Keys in Settings (added 2026-11-03)

The owner asked for a safer place than the chat to add keys. Settings now has an **Open Media AI**
section (found by searching Settings for "api key", "claude", "openai" and similar, or opened by
the assistant).

- **Who answers:** radio rows for Llama (free) and each saved key, shown only as its provider,
  last four characters and model. A key sealed with an old server key is marked so it can be
  removed.
- **Add a key:** choose the provider, type the key in a masked field (no autocorrect, autofill or
  spell check) and save. The field is cleared at once. The Worker checks the key against that
  provider's shape where it has one (Mistral and DeepSeek have none), encrypts it exactly as in §4
  and makes that provider answer. Nothing is written to the chat. A link opens the provider's own
  key page.
- **Remove:** removes the key; if it was answering, the next saved key or the free model answers.
- **API:** `GET /v1/me/ai/keys`, `PUT` and `DELETE /v1/me/ai/keys/{provider}` (the key only in the
  request body) and `PUT /v1/me/ai/model`, documented in OpenAPI. Saving is rate limited.
  Responses never contain a key.
- The chat replies, the free-model limit message, the assistant's instructions, the `ask_ai` tool
  and the agent skill now send people to Settings for keys. Pasting a key into the chat still works
  and is still masked, for people who do that anyway.
- **Verified:** `aiChat.test.ts` (shape check per provider, nothing written to the chat, key never
  returned, choosing and removing). Web at desktop width and 375 px. iOS and Android not run, and
  no real provider key was used.


## 10. AI search summaries use the person's own key (added 2026-11-03)

Before this, search summaries always ran on the free built-in model, even for people with a saved
key. Once Cloudflare's free daily allowance was used up, every summary failed, and the raw Workers
AI error ("4006: you have used up your daily free allocation…") was shown in Search.

- Signed in, `POST /v1/search/assist` reads the person's saved keys and chosen model with their own
  token (row-level security decides whose) and picks the model the same way the chat does
  (`chooseRoute`). That model writes the summary, from the same search text and public post
  snippets as before. Nothing else is sent to it.
- If their model fails, the built-in model writes the summary. Signed out, without a key, or after
  choosing the free model, the built-in model writes it as before.
- When the free allowance is used up, Search says so plainly and points to Settings → Open Media
  AI. It never shows the raw error. The recorded search in the AI chat names the model that
  actually wrote the summary.
- **Verified:** `searchAssist.test.ts` and `aiChat.test.ts` (own model first, fallback, spent
  allowance, keys read with the person's token, unusable or absent keys). A second local API
  server was run against the local database: signed out it returned 503, as before. With a
  made-up OpenAI key saved, the summary went to OpenAI and came back as "GPT didn't answer. Try
  again." No real provider key was used. The app's UI didn't change. iOS and Android were not run.

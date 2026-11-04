# ADR 0031: Dictation in every text field, with open-source Whisper

- Status: **accepted; live on the web** since 2026-11-04 (Worker `34904e9b`). Whisper was checked in production with a recorded clip; a real microphone in a real browser has not been tried yet. iOS and Android are not tested. On phones the mic isn't shown, and the keyboard's own dictation stays as it is.

## Context

The owner asked for speech-to-text "like Handy or Wispr Flow", with a voice icon "wherever you can possibly type", and for the button to look good. Handy is the well-known open-source (MIT) desktop dictation app. It runs OpenAI's open-source Whisper model (or NVIDIA Parakeet) on the computer. Wispr Flow is a closed, cloud dictation app known for accurate, well-punctuated text. The [no-new-buttons rule](../../AGENTS.md) applies, but the owner asked for this button by name.

A web page can't call a desktop app like Handy. What it can use is the model Handy is built on.

## Decision

### One mic, in the shared text field

Every field in the app renders through `TextInput` in `src/ui/Text.tsx`. On the web it now adds the mic (`src/ui/DictationButton.tsx`) at the right edge of fields people write words in, so new fields get the mic without extra code. The field's layout (flex, width, margins, position) moves to a box that holds both the field and the mic, and the field keeps room on its right for the button.

Fields where nobody speaks don't get the mic: passwords, sign-in codes, email addresses, numbers, links, and handles or keys (fields that turn off capitalisation). Any field can override this with `dictation={true|false}`. The rules are in `dictationEligible` in `src/domain/dictation.ts`.

### How it works

- **Tap** the mic to talk, then tap again to insert the words. You can also **hold** it down and let go when you're done (push to talk). **Escape** throws the take away. One take lasts two minutes at most.
- While it listens, the button turns ink-black with four bars that move with your voice, and a soft halo grows with how loud you are. While Whisper writes, the button shows the Open Media loading mark. Errors show as a short dark note above the button. With reduced motion on, the halo is off and the bars move less.
- Words go in at the cursor, or replace the selection, the way typing would: a space where one is needed, and a lowercase start in the middle of a sentence ("I" keeps its capital). A one-line field such as a search or a title loses the full stop at the end of a single sentence. The field's maximum length is kept. The text is written through the field's own input event, so each screen's `onChangeText` runs as if the person had typed.

### Engine: Whisper large-v3-turbo on Workers AI, and the browser as fallback

1. The page records the microphone itself (Web Audio). It downsamples to 16 kHz mono and sends a 16-bit WAV (about 32 KB a second, 4 MB at most) to `POST /v1/dictate`. The Worker runs `@cf/openai/whisper-large-v3-turbo` with voice-activity filtering, and returns `{ text, language }`. Whisper is open source (MIT), so this is the same model Handy uses. It detects the language by itself and punctuates.
2. `GET /v1/dictate` says whether the server has a speech model. When it doesn't (a local stack without `OPEN_MEDIA_LOCAL_AI=true`, or no network), the browser's own speech recognition is used if it has one (Chrome, Edge, Safari). Firefox without the server has no dictation, and says so.
3. Takes that were silent (never louder than room noise, or shorter than a third of a second) aren't sent. Whisper's usual output for silence, such as `[BLANK_AUDIO]`, is dropped.

The recorder loads only when a mic is first pressed (`import()`), so the first page doesn't grow by more than the button itself.

### Privacy and limits

- Audio and text are transcribed in memory. They are never stored, cached or logged by Open Media. `cache-control: no-store`.
- Signed in, the limit is per person; signed out (the search box on public pages), it is per IP address. Both use `DICTATION_RATE_LIMITER`: 20 takes a minute.
- Only WAV files are accepted, so the route can't be used to convert other files.
- When the browser's own engine is used, the browser maker's speech service hears the audio (in Chrome, Google's). That is the browser's usual behaviour for speech.

## Alternatives considered

- **Whisper in the browser** (transformers.js or whisper.cpp in WebAssembly). This is the most Handy-like, because audio never leaves the device. But the small models that load quickly are much less accurate, and a good one is a download of 75 to 800 MB. It's a candidate for a later "on this device" option.
- **Browser speech recognition only.** Free and live, but missing in Firefox, weaker punctuation, and the audio goes to the browser maker.
- **An LLM clean-up pass** after Whisper, like Wispr Flow's edits (removing "um", fixing grammar). It's slower and costs more per take, and Whisper turbo already drops most filler words. Left for later.
- **A global floating mic** that follows whichever field has focus. It covers every field without changing layouts, but you can't see it until you click into a field. The owner asked for the icon to be visible wherever you type.

## Consequences

- Workers AI bills Whisper per audio minute on the owner's Cloudflare account. It costs a fraction of a cent a minute.
- Phones: a later change could record with a native audio module and send to the same route, once a phone build can be tested.

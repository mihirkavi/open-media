---
name: event-personalization
description: Read and update the person's event preferences and feedback in Open Media Events with the right scope. Use when they state likes or dislikes ("no more mixers", "I prefer small dinners", "I'm in Palo Alto now"), rate an event, or ask what the system knows about their preferences.
---

# Event personalization

Tools: `get_event_preferences`, `update_event_preferences`, `submit_event_feedback`, `export_my_event_data`, `delete_my_event_history`.

## Classify every preference statement

| The person says | Treat as | Action |
|---|---|---|
| "I don't feel like networking tonight" | Temporary | Pass `exclude` in this conversation's searches. Store nothing. |
| "Don't suggest networking mixers anymore" | Explicit, long-term | Confirm the scope ("for good, or just for now?"), then `update_event_preferences` with `scope: "permanent"`, `user_confirmed: true` and `add_avoid` or `formatsAvoided`. |
| Passing on three large mixers | Behavioral | Weak evidence. Do nothing now. You may ask later whether to make it a preference. |

## Feedback

After an event, ask briefly how it went and call `submit_event_feedback` (rating 1–5, attended, would_return, reasons). Explain that one response nudges ranking and does not rewrite their stated preferences.

## Privacy

- `get_event_preferences` shows stated preferences and inferred signals with evidence and confidence. Present inferred signals as guesses.
- `export_my_event_data` exports everything as JSON or Markdown.
- `delete_my_event_history` is permanent. Call it only after an explicit, specific confirmation.

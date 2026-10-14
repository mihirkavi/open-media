---
name: event-registration
description: Handle event registration, RSVP, tickets and cancellations through Open Media Events without ever fabricating a registration. Use when the person says "register me", "RSVP", "get tickets", "I signed up", "I'm on the waitlist" or "cancel my spot".
---

# Event registration

Tools: `get_event_options`, `register_event`, `record_registration`, `get_registration_status`, `cancel_registration`.

## Current capability

No connected provider lets Open Media register an attendee programmatically (`automation.register` is `handoff`). Registration is always a handoff: the person completes it on the official page.

## Steps

1. Call `get_event_options`. State the price, availability, approval requirement and spots left.
2. If paid, say the amount and that payment happens on the provider's page. Open Media never purchases.
3. Call `register_event` and give them `open_this_link` with the checklist in `before_you_register`.
4. When they report the outcome, call `record_registration` with what the provider said: `registered`, `waitlisted`, `pending_approval` or `failed`. Ask whether to put it on the calendar, and set `user_approved_calendar` only if they agree.
5. Describe the result with its label, for example "Registered (as you reported; not verified with the provider)".
6. To cancel, call `cancel_registration` for the link. After they confirm they cancelled, call it again with `user_completed_cancellation: true`.

## Rules

- Never say "you're registered" unless `record_registration` stored it. Even then, say it was reported by them, not confirmed by the provider.
- After an uncertain outcome (page timed out, unclear confirmation), call `get_registration_status` and ask them to check their email before trying again.
- Do not bypass CAPTCHAs, sign-ins or payment steps, or use the browser to register for them.

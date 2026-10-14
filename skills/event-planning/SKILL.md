---
name: event-planning
description: Check availability and travel, and place or release calendar holds for events using Open Media Events. Use when the person asks "am I free?", "hold that", "put it on my calendar", "what am I doing Saturday?", or wants to plan several events across a week.
---

# Event planning

Tools: `check_schedule`, `plan_event`, `save_event`, `get_my_events`, `get_calendar_feed`.

## Steps

1. Resolve the event id from the conversation (ids look like `evt_…`). If it is ambiguous, ask which one.
2. Call `check_schedule`. Report conflicts (calendar and other Open Media plans), the proposed block including travel, and that travel time is an estimate.
3. If `calendar.checked` is false, say that existing calendar commitments were not checked.
4. Ask: "Hold <local block> for <title>?" Only after a clear yes, call `plan_event` with `state: "held"` and `user_approved: true`.
5. Say what happened exactly: a tentative hold on the "Open Media plans" calendar. Holds are not registrations.
6. If the person has not subscribed to the plan calendar yet, call `get_calendar_feed` once and walk them through subscribing.
7. To release a hold, call `plan_event` with `declined` (they changed their mind) or `cancelled`.
8. For "what am I doing …?", call `get_my_events` with the date range. Report the plan state, registration label and any detected changes (time, venue, cancellation).

## Planning several events

When asked for several events in a week ("two events, don't fill every evening"), pick a mix (for example one professional and one recurring social activity) on different evenings. Check each one, and confirm the set before holding anything.

## Rules

- Never place a hold without a yes for that specific block.
- Never modify or describe calendar entries that Open Media did not create.
- "I changed my mind" means `declined`. Do not claim a provider-side cancellation happened.

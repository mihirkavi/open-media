# Open Media agent skills

> Teach any agent to plan your week with [Open Media Events](../docs/events/README.md): find events, check your calendar, hold time and hand off registration, without ever pretending you are registered.

These are reusable instructions for agents that use the Open Media Events MCP server (`/mcp` on the production Worker). Each skill covers one job, so an agent can load discovery without the registration rules.

| Skill | Use it for |
|---|---|
| [event-discovery](event-discovery/SKILL.md) | Finding, comparing and explaining events |
| [event-planning](event-planning/SKILL.md) | Availability, travel estimates, calendar holds, "what am I doing Saturday?" |
| [event-registration](event-registration/SKILL.md) | RSVP and ticket handoff, recording outcomes, cancellations |
| [event-personalization](event-personalization/SKILL.md) | Preferences with the right scope, feedback, export and deletion |

[`workflows/`](workflows/) has the same flows as portable YAML specifications for agents that don't support skill packages.

The skills describe good behavior. The server enforces the rules that matter: holds need `user_approved`, permanent preferences need `user_confirmed`, deleting history needs `confirm`, and registration states can only come from `record_registration`.

**Naming:** each folder is the skill name, with a `SKILL.md` that has `name` and `description` front matter. Add new skills the same way and list them here.

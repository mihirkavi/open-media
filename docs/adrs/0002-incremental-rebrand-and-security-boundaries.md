# ADR 0002: Incremental rebrand and security boundaries

- Status: accepted
- Date: 2026-08-15

## Decision

Change the displayed product and package name to Open Media while retaining existing iOS/Android identifiers, URL scheme, EAS project, Supabase resources, mail database, and deployment names during migration. Maintain separate semantics for Open Media messages, provider messages, and email; do not claim E2E encryption until a reviewed protocol and full key/device lifecycle exist.

## Consequences

Existing installations, deep links, credentials, and deployed infrastructure remain reachable. Some internal names continue to say `convo` temporarily; they are compatibility identifiers, not user-facing product claims.

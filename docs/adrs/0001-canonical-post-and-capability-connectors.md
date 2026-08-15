# ADR 0001: Canonical posts and capability-negotiated connectors

- Status: accepted
- Date: 2026-08-15

## Decision

Feed and Clips render the same `SocialPost` record. Clips is a filtered presentation of video posts, not another content store. Every external integration provides a connector descriptor with explicit per-operation availability and reasons for unavailable operations.

## Consequences

Engagement, provenance, deletion, and future portability attach to one post. UI actions cannot infer support from a provider name. More adapter work is required, but unsupported features cannot silently appear functional.

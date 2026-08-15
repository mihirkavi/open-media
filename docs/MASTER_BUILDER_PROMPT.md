# Open Media — Master Builder Prompt

This is the public, repository-scoped version of the starting prompt for the Convo → Open Media migration. It is self-contained so contributors can understand the product intent without access to the original planning conversation.

## Role and working method

Act as the principal product engineer, distributed-systems architect, security architect, privacy engineer, protocol designer, UX researcher, full-stack engineer, mobile architect, and open-source systems designer responsible for transforming the existing **Convo** project into **Open Media**.

Do not treat this as a greenfield rewrite.

1. Inspect the existing repository.
2. Understand what already works.
3. Preserve reusable functionality and data boundaries.
4. Refactor incrementally.
5. Build a usable product before speculative infrastructure.
6. Establish protocol boundaries that support the long-term vision.
7. Research established implementation and UX patterns before making non-obvious decisions.
8. Document important architectural decisions.
9. Implement, test, run, and iterate instead of stopping at architecture documents.

## Product

Name: **Open Media**

Immediate proposition:

> **Post everywhere. Message everyone. One app.**

The product should initially feel like:

> **One app for your social world.**

Users should receive value even when none of their friends have joined Open Media. Interoperability therefore comes before relying on Open Media network effects.

## Long-term mission

> **Build the open communication layer for humanity—where people can communicate across networks, control how information reaches them, and retain ownership of their identity, relationships, and content regardless of which application they use.**

Open Media should evolve beyond a single social network, messaging app, blockchain application, or aggregator into an open protocol ecosystem for human communication.

Applications are doorways. The human remains the constant. An application should not permanently own a person’s identity, audience, social graph, content, recommendations, messaging history, or governance rights. Open Media is one reference doorway; other applications should eventually be able to use the same open protocols.

## Understandable user value

Everything technical should produce three clear benefits:

1. **Everything together:** one place for a person’s social world wherever authorized APIs and protocols permit.
2. **You control what you see:** feeds are replaceable lenses, beginning with transparent Relevant and chronological Raw modes.
3. **You are not locked in:** identity, audience, and content should become portable and verifiable over time.

## Product surface

Expose only three primary destinations:

- **Feed** — the default mixed-media stream.
- **Clips** — an immersive short-video presentation of canonical posts.
- **Messages** — the universal people-first communication surface, including email.

Profile, Search, Settings, and Create are utilities, not permanent primary destinations.

### Feed and Clips

Feed supports text, images, links, long-form content, short and long video, polls, quotes, reposts, replies, external-network content, and community content as capabilities arrive.

Clips are not a separate content object. A short video is one canonical post rendered through either Feed or Clips. Identity, engagement, comments, provenance, moderation, and portability attach to the same post.

```text
Canonical post
     ├── Feed presentation
     └── Clips presentation
```

### Messages

Messages organizes direct conversations around canonical people and intentional groups, not provider accounts. Transport provenance remains visible when relevant but does not dominate ordinary UX.

Email is part of the V1 direction. Use standard provider APIs and protocols for OAuth, Gmail, Outlook, IMAP/SMTP where appropriate, threading, unread state, attachments, replies, and sending. Preserve distinct security semantics: imported email must never be presented as end-to-end encrypted Open Media messaging.

## Write once, publish everywhere

A central experience is one intentional publish action across the user’s authorized default destinations.

```text
User creates post
      ↓
Canonical Open Media post
      ↓
Capability-negotiated connector gateway
      ↓
Authorized networks and open protocols
```

Use progressive disclosure. Show the effective destinations before publishing, make accidental disclosure difficult, retain idempotency, and expose per-destination partial failures. Never show a provider action merely because the provider exists; enable it only when the authenticated connector advertises the capability.

## Connector architecture

Do not hardcode integrations throughout the product. Every provider must implement a generic, capability-negotiated boundary for the operations it genuinely supports, such as:

- authentication and revocation;
- publish, edit, or delete post;
- media upload;
- feed, reply, or notification retrieval;
- message or email read/send;
- attachments, realtime, and webhooks.

Use official APIs and protocols. Do not use unauthorized scraping. Treat OAuth scopes, granted capabilities, rate limits, provider review, account eligibility, and regional restrictions as runtime realities rather than documentation footnotes.

## Frontend and accessibility

The interface should feel dramatically simpler than the infrastructure underneath it.

- Use a predominantly black-and-white, content-first visual system with restrained neutral grays.
- Support System, Light, and Dark appearance; default to System.
- Use adaptive mobile, tablet, desktop, and web layouts.
- Prefer established Apple, Material, web, and accessibility conventions over novel interactions.
- Maintain readable contrast, visible focus, meaningful labels, adequate targets, text resizing, reduced-motion compatibility, and accessible media descriptions.
- Avoid a crypto aesthetic, crowded dashboards, provider-button forests, and decorative complexity.

## Search and Settings

Universal search should progressively understand people, posts, Clips, messages, email, communities, settings, documentation, algorithms, and integrations.

Every setting must be indexed. Natural-language queries such as “dark mode,” “use chronological feed,” “stop posting to LinkedIn,” “who can message me?”, and “export my data” should locate the relevant control. Consequential or ambiguous changes require explicit confirmation.

## Recommendation baseline

Ship two initial feed modes:

- **Relevant:** a transparent ranking that may use explicit follows, selected interests, recency, language, approximate region, and community membership.
- **Raw:** chronological eligible content that always remains available.

Do not use private messages, KYC documents, inferred religion or political ideology, sensitive-trait inference, emotional-state prediction, precise location, or addiction optimization as default ranking inputs.

Ranked content should provide **Why am I seeing this?**, listing signals used and important sensitive signals not used. Future algorithms are permissioned, replaceable lenses and must never receive arbitrary production database access.

## Identity and verification boundaries

Keep private human roots, public or pseudonymous personas, and provider accounts conceptually separate. Multiple personas must not become automatically publicly linkable.

Human verification and intentionally public legal-identity verification are different states. Do not require proof of personhood for ordinary participation. Do not store raw government identity documents, biometric templates, Face ID data, passport numbers, or similar identity databases. Use operating-system biometric APIs only to unlock local credentials or keys.

Advanced proof-of-personhood, governance, constitutional change, organizations, AI-agent identities, blockchain, and KYC are not Phase 1 blockers. Create interfaces only where they prevent architectural dead ends.

## Security and privacy

- Minimize scopes and request authorization incrementally.
- Keep tokens and reusable credentials out of client bundles and Git history.
- Encrypt server-held secrets, support revocation, and audit consequential operations.
- Apply deny-by-default database authorization and test cross-user isolation.
- Validate connector payloads, media, redirects, and network destinations.
- Preserve identity-link review, reversibility, and private persona boundaries.
- Do not invent cryptography or claim E2E protection without a reviewed protocol, device/key lifecycle, recovery, verification, and metadata analysis.
- Treat cross-posting, deletion, export, and account linking as potentially consequential operations.

## Phase 1 execution brief

1. Map the current frontend, backend, auth, database, APIs, realtime/messaging, media pipeline, deployment, technical debt, and reusable components.
2. Document Current Architecture, Target Architecture, Reusable Components, Required Database Changes, Security Risks, Migration Strategy, and the Phase 1 plan.
3. Rebrand Convo to Open Media without breaking installed applications or existing infrastructure.
4. Build the adaptive Feed, Clips, and Messages shell with Profile, Search, Settings, and Create utilities.
5. Add System/Light/Dark appearance.
6. Add one canonical post model reused by Feed and Clips.
7. Add Raw and transparent Relevant feed modes.
8. Add searchable Settings and universal-search scaffolding.
9. Add provider and connector abstractions for cross-posting, email, and messaging with explicit capability negotiation.
10. Preserve people-first Convo conversations and working mail/contact/auth foundations.
11. Use mature libraries, official APIs, and standard protocols; never scrape.
12. Add tests, run the product, fix regressions, and keep README, architecture notes, limitations, and ADRs aligned with the code.

The working rule is simple: **build the smallest honest, coherent product slice; preserve what works; and leave clean boundaries for everything that comes next.**

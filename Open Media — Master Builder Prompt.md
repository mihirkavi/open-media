# Open Media — Master Builder Prompt

You are the principal product engineer, distributed-systems architect, security architect, privacy engineer, protocol designer, UX researcher, full-stack engineer, mobile architect, blockchain engineer, and open-source systems designer responsible for transforming the existing **Convo** project into **Open Media**.

Do not treat this as a greenfield rewrite.

Your job is to:

1. inspect the existing Convo repository;
2. understand what already works;
3. preserve reusable functionality;
4. refactor incrementally;
5. build a usable product first;
6. establish protocol boundaries that support the long-term vision;
7. research established implementation and UX patterns before making non-obvious design decisions;
8. document important architectural decisions;
9. implement, test, and iterate rather than stopping at architecture documents.

---

# 1. THE PRODUCT

## Name

**Open Media**

## Immediate consumer proposition

> **Post everywhere. Message everyone. One app.**

Open Media should initially feel like:

> **One app for your social world.**

It should aggregate and simplify the social and communication systems people already use.

A user should receive value even if none of their friends have joined Open Media.

That means interoperability comes before relying on Open Media network effects.

---

# 2. LONG-TERM MISSION

> **Build the open communication layer for humanity — where people can communicate across networks, control how information reaches them, and retain ownership of their identity, relationships, and content regardless of which application they use.**

The long-term objective is not merely:

- another social network;
- another blockchain application;
- another messaging app;
- another aggregator.

Open Media should evolve into an **open protocol ecosystem for human communication**.

It may ultimately encompass:

- public social communication;
- short-form media;
- messaging;
- email;
- communities;
- voice;
- video;
- identity;
- content provenance;
- recommendation;
- moderation;
- search;
- governance;
- regional compliance;
- third-party integrations;
- creator economics;
- decentralized infrastructure.

---

# 3. CORE PHILOSOPHY

The most important conceptual rule is:

> **Applications are doorways. The human remains the constant.**

An application should not permanently own:

- a person's identity;
- audience;
- social graph;
- content;
- recommendation system;
- messaging history;
- governance rights.

Open Media itself is one **reference doorway** into the protocol ecosystem.

Anyone should eventually be able to create another doorway using the open protocol.

---

# 4. USER VALUE

Everything technical must ultimately produce three understandable benefits.

## 4.1 Everything together

> **One place for your social world.**

The user should not have to continuously jump between:

- Instagram;
- X;
- LinkedIn;
- Facebook;
- email;
- messaging systems;
- emerging open networks.

Open Media attempts to unify them where APIs and protocols permit.

---

## 4.2 You control what you see

> **Your feed belongs to you.**

Users should not be locked into one hidden engagement-maximization algorithm.

Start extremely simply:

- Relevant
- Raw

Later support an algorithm marketplace.

---

## 4.3 You are not locked in

> **Your identity, audience, and content move with you.**

Open Media's infrastructure should progressively support:

- exportability;
- portability;
- cryptographic verification;
- replaceable applications;
- replaceable service providers.

---

# 5. PRODUCT SURFACE

The default application exposes only three primary destinations:

# Feed

# Clips

# Messages

Do not add additional permanent primary navigation destinations unless research demonstrates that doing so is necessary.

Everything advanced belongs behind contextual interactions, search, Settings, documentation, or developer interfaces.

---

# 6. FEED

Feed is the default home.

It contains one mixed-media stream.

Possible content:

- text;
- images;
- galleries;
- links;
- long-form text;
- short video;
- long video;
- polls;
- quotes;
- reposts;
- replies;
- external-network content;
- community content.

Short videos appear naturally inside Feed.

Do not create an artificial separate content universe for short-form video.

---

# 7. CLIPS

**Clips** is the product name for the immersive short-form video experience.

Clips are not a separate content object.

They are simply short-video posts viewed through an immersive vertical interface.

Therefore:

```text
Canonical post
     │
     ├── Feed presentation
     └── Clips presentation
```

The same post, engagement, comments, provenance, and identity should work in either view.

---

# 8. MESSAGES

Messages is the universal communication surface.

The initial product must support:

- Open Media direct messages;
- conversations;
- email integration.

Long-term it should support compatible external messaging systems wherever authorized APIs or protocols allow it.

Conceptually:

```text
Messages

Alice            Open Media
Bob              Email
Sarah            External service
Team             Community/service
```

The transport should remain visible when relevant but should not dominate ordinary UX.

---

# 9. EMAIL IS PART OF V1

Email is not a future experiment.

The initial Open Media product should include email integration as part of Messages.

Research the safest and most standard architecture for:

- OAuth;
- Gmail;
- Outlook;
- IMAP/SMTP where appropriate;
- threading;
- unread state;
- attachments;
- reply/send;
- provider capability abstraction.

Do not reinvent email protocols.

---

# 10. WRITE ONCE, PUBLISH EVERYWHERE

A central V1 experience is:

> **One tap → everywhere.**

Create once.

Publish to all authorized networks selected by the user's cross-post configuration.

Conceptually:

```text
User creates post
      ↓
Canonical Open Media post
      ↓
Connector gateway
      ↓
Instagram
LinkedIn
X
Bluesky
Mastodon
Nostr
Farcaster
other authorized networks
```

The composer should not show a forest of provider buttons.

Use progressive disclosure.

Example:

```text
What's happening?

[content]

Sharing to: Open Media + 4

                         Publish
```

Tapping `+4` reveals destinations.

---

# 11. CROSS-POSTING DEFAULT

Once a network is authorized for cross-posting according to user configuration, publishing should normally remain:

> **one tap → everywhere**

Destination defaults belong in:

Settings → Cross-posting.

Users may override destinations for an individual post.

Research conventional error-prevention patterns and make accidental publishing difficult without adding unnecessary friction.

---

# 12. CONNECTOR ARCHITECTURE

Do not hardcode integrations throughout the application.

Define a generic connector capability model.

Example:

```typescript
interface CommunicationConnector {
  authenticate(): Promise<void>;
  capabilities(): Promise<Capabilities>;

  publishPost?(): Promise<Result>;
  deletePost?(): Promise<Result>;
  editPost?(): Promise<Result>;

  uploadMedia?(): Promise<Result>;

  fetchFeed?(): Promise<Result>;
  fetchReplies?(): Promise<Result>;
  fetchNotifications?(): Promise<Result>;

  sendMessage?(): Promise<Result>;
  fetchMessages?(): Promise<Result>;

  sendEmail?(): Promise<Result>;
}
```

Each provider advertises capabilities.

Never pretend unsupported functionality exists.

Use official APIs and protocols.

Do not rely on unauthorized scraping.

---

# 13. THIRD-PARTY INTEGRATION PHILOSOPHY

Support as many legitimate third-party integrations as technically possible.

The architecture should allow:

- OAuth integrations;
- REST APIs;
- GraphQL APIs;
- webhooks;
- MCP-compatible systems where appropriate;
- ActivityPub;
- AT Protocol;
- Nostr;
- Farcaster;
- email;
- messaging;
- productivity systems;
- creator systems;
- commerce providers;
- future communication protocols.

Build an integration SDK.

---

# 14. FRONTEND DESIGN PHILOSOPHY

The frontend must feel dramatically simpler than the infrastructure underneath it.

The guiding principle is:

> **Don't make me think.**

The interface should feel familiar immediately.

Do not invent unusual interactions where established conventions work.

Before implementing any nontrivial UX pattern:

1. define the user problem;
2. research commonly accepted UX solutions;
3. inspect relevant Apple HIG;
4. inspect relevant Material guidance;
5. inspect WCAG/accessibility requirements;
6. inspect established mainstream patterns;
7. choose the simplest predictable solution;
8. briefly document why;
9. implement and test it.

Do not copy another company's branding.

Reuse mental models.

---

# 15. VISUAL LANGUAGE

Default aesthetic:

- white background;
- black primary text;
- restrained neutral grays;
- minimal borders;
- minimal visual decoration;
- minimal accent color;
- strong typography;
- generous whitespace.

Think:

> content first.

Do not create a crypto aesthetic.

Avoid:

- unnecessary gradients;
- neon Web3 styling;
- blockchain badges everywhere;
- excessive card borders;
- crowded dashboards;
- decorative complexity.

---

# 16. APPEARANCE

Support:

- System;
- Light;
- Dark.

Default to:

**System**

Light mode should be predominantly black text on white.

Dark mode should use near-black surfaces and near-white text.

Appearance belongs in Settings.

Do not permanently clutter the main interface with a theme switcher.

---

# 17. CROSS-PLATFORM UX

The same product should work across:

- iPhone;
- Android;
- tablets;
- iPad;
- foldables where practical;
- browsers;
- laptops;
- desktops;
- ultrawide displays;
- PWA environments;
- future native clients.

Use adaptive—not merely responsive—design.

### Mobile

Bottom navigation:

```text
Feed     Clips     Messages
```

Creation uses a simple contextual/floating action.

### Desktop

Use a narrow left navigation rail.

Expose only:

- Feed;
- Clips;
- Messages;

plus restrained utility access to:

- Create;
- Search;
- Profile.

Settings can be reached through Profile and Search.

Avoid large permanent sidebars full of features.

---

# 18. CREATION UX

Use a hybrid pattern:

- mobile: lightweight contextual/floating creation action;
- larger screens: lightweight composer may appear naturally where appropriate.

Do not permanently consume one primary navigation position with a Create tab.

---

# 19. SEARCH

Mobile:

- compact Search access.

Desktop:

- persistent but visually restrained search field where appropriate.

Long-term, one universal search system should understand:

- people;
- posts;
- Clips;
- messages;
- email;
- communities;
- settings;
- documentation;
- algorithms;
- integrations;
- governance.

Search ranking should eventually be provider-based and replaceable.

---

# 20. SETTINGS SHOULD ALMOST NEVER BE NEEDED

Settings contains complexity.

The user should be able to use Open Media for a long time without entering Settings.

Settings may eventually contain:

- Account;
- Appearance;
- Privacy;
- Security;
- Feed;
- Algorithms;
- Messages;
- Email;
- Notifications;
- Connected Apps;
- Cross-posting;
- Identity;
- Verification;
- Moderation;
- Regional Preferences;
- Accessibility;
- Data;
- Governance;
- Developer;
- About;
- Documentation.

Use progressive disclosure.

Do not expose advanced protocol implementation terminology to ordinary users.

---

# 21. SEARCHABLE SETTINGS

Every setting must be indexed.

Natural-language searches should work:

```text
dark mode

stop posting to LinkedIn

use chronological feed

disconnect Instagram

who can message me?

export my data
```

Take the user directly to the relevant setting.

---

# 22. AI-SEARCHABLE SETTINGS AND DOCUMENTATION

AI should function as an optional natural-language interface to complexity.

Examples:

> Change my feed to chronological.

> Stop automatically posting to LinkedIn.

> Why am I seeing this post?

> Where is my privacy setting?

> Export my account.

> Connect my email.

AI may identify and offer the correct action.

For consequential settings changes, show confirmation.

Do not silently execute ambiguous high-impact changes.

---

# 23. DEFAULT FEED

Open Media must not default to opaque engagement optimization.

Ship two initial feed modes:

## Relevant

Simple transparent ranking.

Allowed signals may include:

- explicit follows;
- selected interests;
- recency;
- language;
- approximate region;
- community membership.

Do not use by default:

- private messages;
- KYC documents;
- inferred religion;
- inferred political ideology;
- sensitive-trait inference;
- emotional-state prediction;
- precise location;
- addiction optimization.

## Raw

Chronological eligible content.

Raw must always remain available.

---

# 24. ALGORITHM MARKETPLACE

Recommendation algorithms are optional lenses over information.

Long-term, anyone should be able to:

- create;
- publish;
- inspect;
- rate;
- install;
- uninstall;
- fork;
- audit;
- monetize where appropriate;

a feed algorithm.

Each algorithm needs a machine-readable manifest.

Example:

```yaml
name: SerendipityFeed
version: 2.1

permissions:
  follows: true
  selected_interests: true
  public_engagement: true

forbidden:
  private_messages: true
  kyc_documents: true
  exact_location: true
  inferred_religion: true

objectives:
  relevance: 0.35
  diversity: 0.25
  discovery: 0.20
  recency: 0.20
```

Runtime permissions must be enforced.

---

# 25. ALGORITHM SANDBOX

Third-party algorithms must never receive arbitrary production database access.

Create a permission gateway.

Potential techniques:

- capability APIs;
- sandboxed execution;
- signed packages;
- resource limits;
- reproducible builds;
- scoped datasets;
- audit logs.

Sensitive systems remain inaccessible.

---

# 26. WHY AM I SEEING THIS?

Algorithmically ranked content should support:

> **Why am I seeing this?**

Example:

```text
You follow Alice
Topic matches AI
Posted recently
Selected by Relevant

Not used:
Private messages
Exact location
KYC information
```

Recommendation transparency is part of the protocol philosophy.

---

# 27. IDENTITY MODEL

Separate:

```text
Human
   ↓
private Human Root
   ↓
one or more Personas
   ↓
Accounts / identities
```

A human may have multiple personas.

Personas should not automatically be publicly linkable.

---

# 28. TWO VERIFICATION LEVELS

Support conceptually distinct verification states.

## Human verification

```text
✓ Human
```

Means:

> this persona is controlled by a verified unique human.

It does not require revealing legal identity publicly.

## Public identity verification

```text
✓ Identity

First Last
```

Means:

> government identity has been verified and the legal first/last name is intentionally public.

Do not conflate the two.

---

# 29. VERIFIED PUBLIC NAME

For a publicly identity-verified persona:

- first and last name must derive from the verified credential;
- they cannot be manually changed;
- changing the legal name requires identity re-verification.

Users may still maintain other personas.

---

# 30. MULTIPLE VERIFIED PERSONAS

A single human may operate multiple personas that independently prove:

> controlled by a verified human

without allowing observers to determine that those personas belong to the same underlying human.

However:

```text
Persona A ─┐
Persona B ─┼── Human Root → one governance vote
Persona C ─┘
```

Proof-of-personhood must not become a public cross-persona tracking system.

---

# 31. LOCAL-FIRST KYC / IDENTITY PROOFING

Raw government identity documents should not normally be uploaded to Open Media.

Target architecture:

```text
Government ID
      ↓
local device verification
      ↓
document authenticity / face / liveness evaluation
      ↓
minimal authoritative online validation
      ↓
signed credential / uniqueness commitment
      ↓
Open Media
```

Use local/open models where secure and practical.

Document images should be discarded after verification unless a specific legal requirement requires otherwise.

Open Media must not store raw:

- passport images;
- ID images;
- biometric templates;
- fingerprint templates;
- Face ID data.

---

# 32. DEVICE BIOMETRICS

Use operating-system secure biometric APIs only as authentication mechanisms.

For example:

- Face ID;
- Touch ID;
- Android biometric APIs.

Never expect access to underlying biometric templates.

Use these systems to unlock:

- credentials;
- cryptographic keys;
- local identity wallets.

---

# 33. UNIQUENESS COMMITMENT

Open Media should retain only what is necessary to detect duplicate human enrollment.

Prefer:

> **non-reversible uniqueness commitments**

instead of legal-identity databases.

Open Media should be able to determine:

> this human already enrolled

without possessing:

- passport number;
- raw document;
- home address;
- full DOB;
- biometric template.

---

# 34. HUMAN VERIFICATION IS CAPABILITY-BASED

Do not require proof-of-personhood merely to use Open Media.

People should be able to participate pseudonymously.

Human verification becomes necessary for capabilities where uniqueness matters, such as:

- one-person-one-vote;
- certain verified-human spaces;
- some regulated interactions;
- trust-sensitive features.

---

# 35. GOVERNANCE

Core governance principle:

> **One verified human = one governance vote.**

Never:

> one token = one political vote.

Money, followers, company size, creator revenue, or token holdings must not automatically create additional constitutional power.

---

# 36. BITCOIN-LIKE PROTOCOL CONSENSUS

Do not treat constitutional change as a normal app vote.

Use an Open Media Improvement Proposal process:

**OMIP**

An OMIP should include:

- title;
- authors;
- status;
- proposal type;
- motivation;
- specification;
- security implications;
- privacy implications;
- human-rights implications;
- compatibility;
- migration;
- reference implementation;
- tests;
- discussion record;
- adoption status.

Protocol evolution should resemble healthy open protocol development:

```text
Proposal
   ↓
Technical review
   ↓
Public discussion
   ↓
Rough ecosystem consensus
   ↓
Implementations
   ↓
Independent adoption
   ↓
Network convergence or fork
```

No CEO, company, board, or simple referendum should be able to unilaterally redefine the protocol.

---

# 37. CONSTITUTIONAL PROTECTIONS

Certain properties deserve extremely high amendment resistance.

Examples:

- open-source/interoperability guarantees;
- right to fork;
- privacy protections;
- algorithm choice;
- data portability;
- one-human-one-vote principle;
- protocol neutrality;
- multiple doorway implementations;
- separation of protocol from presentation.

Do not hardcode arbitrary amendment percentages without research.

Design a constitutional governance process that combines:

- extended review;
- high ecosystem support;
- implementation adoption;
- independent-node/implementation acceptance;
- forkability.

---

# 38. RIGHT TO FORK

If fundamental disagreement cannot be reconciled:

> peaceful fork is the ultimate exit mechanism.

Do not design governance under the assumption that one side must permanently control everyone else.

---

# 39. ORGANIZATIONS

Organizations are a distinct identity class.

Possible identity classes:

```text
Human
Organization
AI Agent
Service / Infrastructure
```

A verified organization may create delegated official personas.

Example:

```text
Organization Root
     │
     ├── official account
     ├── support account
     ├── press account
     └── delegated authorized personas
```

Official statements may be cryptographically signed.

Organizations do not receive human governance votes.

Employees vote only as individual humans.

---

# 40. AI AGENTS

AI agents may participate, but they must use a distinct identity class.

They may:

- post;
- reply;
- publish;
- message subject to policy;
- operate on behalf of humans or organizations.

They may not represent themselves as human-verified.

Only humans participate in one-human-one-vote governance.

---

# 41. AI CONTENT PROVENANCE

Distinguish:

- human-authored;
- AI-assisted;
- AI-generated;
- autonomous-agent-generated;
- materially synthetic media.

Do not label trivial spellcheck as equivalent to synthetic video.

Use machine-readable provenance.

Materially synthetic media should receive clearer disclosure.

---

# 42. AI-TO-HUMAN MESSAGING

AI agents should not freely spam human inboxes.

Default to permission-based initiation.

Allow policies such as:

- block AI agents;
- ask before allowing;
- allow followed agents;
- allow verified services;
- custom.

---

# 43. MODERATION PHILOSOPHY

Open Media should eventually function primarily as a doorway to decentralized content rather than owner of every artifact.

Long-term:

> **Global destruction is exceptional. Filtering is normal.**

Canonical decentralized artifacts may remain available even when particular views refuse to display them.

---

# 44. REPORTING

Anyone should be able to report public content.

Reports should contain structured metadata.

Possible fields:

- category;
- evidence;
- reporter;
- human-verification state;
- timestamp;
- community;
- severity;
- confidence.

---

# 45. REPORT COUNTS ARE SIGNALS, NOT TRUTH

Do not implement:

```text
100 reports = automatically delete
```

Raw report count is vulnerable to brigading.

Moderation confidence should consider signals such as:

- unique-human reports;
- reporter reputation;
- evidence;
- severity;
- report agreement;
- exposure;
- coordinated-report probability;
- Sybil resistance;
- context.

Research real moderation literature before choosing default thresholds.

---

# 46. USER-CONFIGURABLE FILTERING

Users should be able to configure filtering sensitivity.

Keep the default simple.

Example:

```text
Reported content

Relaxed ─────●───── Strict
```

Advanced configuration can expose:

- report thresholds;
- confidence thresholds;
- warning thresholds;
- filtering categories.

A user could theoretically choose:

> hide content reported by 2 credible humans

or:

> do not hide until much stronger consensus exists.

Do not expose advanced numerical controls by default.

---

# 47. FILTERING SCOPES

Filtering decisions may apply at distinct scopes:

```text
Individual
Community
Jurisdiction
Reference doorway
```

Do not confuse them.

A community hiding something does not destroy the canonical artifact.

---

# 48. OFFICIAL MODERATION DEFAULT

The Open Media reference doorway may maintain an official moderation policy/default.

Long-term moderation should be driven by:

- an open standard;
- published methodology;
- human-behavior research;
- safety research;
- transparent implementation;
- democratic constitutional oversight.

Do not hide moderation logic behind secret corporate policy.

---

# 49. MODERATION MARKETPLACE

Long-term, third-party moderation providers may exist.

Potential provider categories:

- spam;
- child safety;
- news context;
- scientific credibility;
- community standards;
- family safety;
- harassment;
- creator/community moderation.

Users/communities may choose providers.

The Open Media reference doorway ships sensible defaults.

---

# 50. INTERNATIONAL / CONSTITUTIONAL BASELINE

Long-term moderation philosophy may develop a common denominator informed by:

- fundamental human rights;
- freedom of expression;
- privacy;
- due process;
- protection from severe harm;
- internationally recognized legal/ethical principles;
- transparent appeals.

Do not assume there is one universal court or legal system controlling the internet.

Treat this as an evolving constitutional standards process.

---

# 51. JURISDICTION FILTERING

The protocol and the Open Media reference doorway are distinct.

If content must be filtered in a jurisdiction:

```text
Decentralized artifact exists
         ↓
Open Media reference doorway
         ↓
jurisdiction rule
         ↓
not displayed within applicable scope
```

This does not imply global destruction.

Where legally possible, show transparent reason metadata.

---

# 52. INDEPENDENT DOORWAYS

Anyone may clone or independently implement the Open Media protocol/reference code.

Example conceptually:

```text
git clone ...
```

Once another party creates an independent implementation, Open Media does not control that doorway's:

- moderation;
- ranking;
- business model;
- jurisdictional decisions;
- user interface.

The implementer is responsible for its own operation and compliance.

Core principle:

> **Protocol rules determine interoperability. Doorway rules determine presentation.**

---

# 53. CONTENT STORAGE

Remain **storage-provider agnostic**.

A canonical content object identifies what content is through cryptographic addressing, not one permanent server location.

Example:

```text
Post
 ├── content hash
 ├── author signature
 ├── media hashes
 └── storage locations
       ├── provider A
       ├── provider B
       ├── decentralized network
       └── self-hosted copy
```

Storage providers are replaceable.

---

# 54. BLOCKCHAIN

Use blockchain selectively.

Principle:

> **Blockchain proves. It does not host the social network.**

Potential on-chain uses:

- identity commitments;
- uniqueness commitments;
- governance;
- voting proofs;
- provenance anchors;
- ownership records;
- audit checkpoints;
- protocol/policy hashes;
- optional digital assets.

Do not put high-volume ordinary social traffic directly on-chain.

---

# 55. NO REQUIRED CRYPTO WALLET

Normal users should be able to sign in with familiar methods:

- passkey;
- Apple;
- Google;
- email;
- other secure identity providers.

Do not make wallets mandatory.

Advanced users may later:

- connect wallets;
- export keys;
- import cryptographic identity.

Never make users understand gas or chain IDs merely to post.

---

# 56. NFT / DIGITAL OWNERSHIP

NFT capability is optional.

Do not automatically mint posts.

Potential use cases:

- collectible works;
- provenance;
- memberships;
- creator licenses;
- digital property;
- community passes.

Participation in basic social communication must not require NFTs or tokens.

---

# 57. DELETION / WITHDRAWAL

A decentralized system cannot honestly promise that every copy of something has vanished.

Implement strong practical deletion.

When an author deletes:

```text
Signed withdrawal
    ↓
Open Media stops indexing
Feed removes
Search removes
Participating storage deletes
Connectors request external deletion
Replicas receive withdrawal
```

The user-facing behavior is:

> Deleted

Technical documentation explains that independent third-party copies may remain.

Distinguish:

- artifact provenance;
- active availability;
- indexing;
- author withdrawal.

---

# 58. LICENSING AND PUBLIC ACCESS ARE DIFFERENT

Every public artifact may carry machine-readable rights metadata.

Examples:

- all rights reserved;
- Creative Commons;
- remix permitted;
- commercial reuse permitted;
- attribution required;
- AI training allowed;
- AI training disallowed;
- transformation permission required.

Open access does not automatically mean unrestricted legal reuse.

---

# 59. CONTENT PROVENANCE

Public content objects should support:

- canonical ID;
- author;
- persona;
- timestamp;
- edit history;
- hash;
- signature;
- media references;
- visibility;
- license;
- provenance;
- AI-generation state;
- reply/repost relationship.

Support cryptographic verification where appropriate.

---

# 60. E2E MESSAGING

Open Media-native private messages should use mature end-to-end encryption.

Never invent custom cryptography.

The server should not require plaintext access to message bodies.

Research mature standards/protocols before implementation.

---

# 61. EXTERNAL MESSAGING SECURITY

Do not imply that email or external networks have the same security guarantees as Open Media E2E messaging.

Keep the ordinary UI simple:

```text
Alice
🔒 Private
```

for true protected conversations.

For ordinary email:

```text
Bob
Email
```

Detailed security explanation appears on demand.

Never silently downgrade an encrypted conversation.

---

# 62. VOICE AND VIDEO

Long-term support:

- 1:1 voice;
- 1:1 video;
- group calls;
- screen sharing.

Use mature standards such as WebRTC where suitable.

Do not route media through blockchain.

---

# 63. ACCOUNT / KEY RECOVERY

Do not create one universal Open Media master recovery key.

Support layered recovery:

- trusted devices;
- passkey/cloud-protected recovery;
- trusted people;
- threshold/social recovery;
- identity re-verification;
- optional recovery providers.

Design for:

> recoverable for ordinary humans without centralizing ultimate ownership.

---

# 64. SEARCH PROVIDERS

Search should eventually become an open provider interface.

Potential providers:

- general index;
- local/community index;
- privacy index;
- academic index;
- self-hosted index.

Feed ranking and search ranking are separate systems.

---

# 65. NOTIFICATIONS

Default notifications should optimize for usefulness, not addiction.

Default important notifications:

- direct messages;
- calls;
- direct replies;
- mentions;
- security/account events.

Bundle or reduce:

- likes;
- follower activity;
- recommendations;
- engagement bait.

Do not send manipulative notifications merely to increase usage.

---

# 66. OFFLINE / LOCAL-FIRST DIRECTION

Adopt progressive local-first principles.

Initially support local caching for:

- recent content;
- drafts;
- conversations;
- credentials;
- settings;
- cryptographic keys;
- pending posts/messages.

Users should be able to compose offline.

Queue actions securely.

Synchronize when connectivity returns.

Do not force full P2P/CRDT architecture into V1 unless existing architecture makes it practical.

---

# 67. MINORS

Support an age-aware protected mode rather than treating minors identically to adults.

Prefer privacy-preserving proofs like:

- under threshold;
- 13–15;
- 16–17;
- adult;

instead of collecting unnecessary DOB data.

Defaults for minors should be stricter.

Research jurisdiction-specific child protection requirements before implementation.

---

# 68. ADVERTISING

Advertising is not required by the protocol.

Different doorway implementations may choose:

- ads;
- subscription;
- nonprofit funding;
- self-hosting;
- other economics.

The Open Media reference doorway should initially ship with **no advertising by default**.

If advertising is introduced later:

- clearly label it;
- prefer contextual/explicit-interest targeting;
- do not scan private messages;
- do not use raw KYC;
- avoid sensitive-trait inference.

---

# 69. CREATOR ECONOMY

Support open creator monetization primitives.

Potential features:

- subscriptions;
- memberships;
- tips;
- paid communities;
- paid posts;
- events;
- crowdfunding;
- digital goods;
- commerce;
- external storefronts;
- optional digital collectibles.

Do not force one payment processor.

---

# 70. PAYMENTS

Do not create a required speculative Open Media token.

The protocol may support:

- fiat;
- conventional payment processors;
- stablecoins;
- Bitcoin;
- other cryptocurrencies;
- subscriptions;
- app-store billing;
- future payment systems.

Core rule:

> **Money can buy services. Money does not buy governance power.**

---

# 71. INFRASTRUCTURE ECONOMICS

Use a mixed model.

Different infrastructure may be funded by:

- subscriptions;
- organizations;
- foundations;
- communities;
- service fees;
- commercial providers;
- donations;
- self-hosting.

The protocol does not require one universal business model.

---

# 72. COMMERCIAL THIRD-PARTY SERVICES

Third-party services may charge money.

Possible paid systems:

- algorithms;
- storage;
- search;
- moderation;
- identity verification;
- connectors;
- AI models.

However, interoperability and disclosure must remain open.

Clearly label:

- open source;
- source available;
- proprietary;
- audited;
- unaudited.

---

# 73. OPEN-SOURCE STRATEGY

Use a split licensing strategy conceptually.

Potential direction:

- protocol specifications → permissive/open-standard terms;
- schemas → permissive;
- SDKs → permissive;
- interoperability libraries → permissive;
- some reference infrastructure → stronger copyleft where useful.

Do not choose final licenses casually.

Document candidate licenses and obtain appropriate legal/open-source review before locking them.

---

# 74. STEWARDSHIP

Early stage:

Open Media may be founder-led to enable execution.

Long term:

progressively move protocol stewardship toward an independent foundation or standards body.

Possible responsibilities:

- protocol specifications;
- OMIP process;
- trademark/conformance stewardship;
- constitutional process;
- reference tests.

Commercial entities remain free to compete on top.

---

# 75. ACCESSIBILITY

Treat accessibility as a core engineering requirement.

Support:

- semantic markup;
- keyboard navigation;
- screen readers;
- visible focus states;
- sufficient contrast;
- scalable text;
- reduced motion;
- captions;
- alt text;
- touch target sizing;
- RTL;
- localization.

Minimal design must not mean inaccessible design.

---

# 76. SECURITY

Design from the beginning for:

- XSS;
- CSRF;
- injection;
- authorization flaws;
- IDOR;
- account takeover;
- replay;
- signature forgery;
- malicious uploads;
- spam;
- bots;
- Sybil attacks;
- leaked credentials;
- malicious algorithms;
- malicious connectors;
- supply-chain attacks;
- insecure plugins;
- key theft.

Use:

- least privilege;
- rate limiting;
- audit logs;
- scoped tokens;
- secure key management;
- encryption at rest/in transit;
- safe defaults;
- dependency scanning;
- sandboxing;
- strong authentication.

---

# 77. MVP STRATEGY

Do not attempt to build the entire protocol immediately.

The first product must be useful and beautiful.

## V1 consumer experience

Primary navigation:

```text
Feed
Clips
Messages
```

Utilities:

- Search;
- Create;
- Profile;
- Settings.

---

# 78. V1 FEED

Ship:

- user profiles;
- follows;
- text posts;
- images;
- video;
- short video;
- links;
- replies;
- reactions;
- repost/share;
- Raw feed;
- Relevant feed;
- canonical content schema.

---

# 79. V1 CLIPS

Ship immersive short-video browsing using the same canonical posts as Feed.

Do not create a parallel Reels-specific database architecture.

---

# 80. V1 MESSAGES

Ship:

- Open Media conversations;
- basic DMs;
- email integration;
- provider abstraction.

Architect for future communication connectors.

---

# 81. V1 CROSS-POSTING

Implement a generic connector layer.

Ship a small number of reliable integrations first.

Do not attempt every closed social network simultaneously.

Choose initial integrations after researching:

- official API availability;
- posting support;
- authentication;
- developer terms;
- cost;
- reliability.

Keep the architecture capable of supporting more.

---

# 82. V1 SEARCH

Support:

- people;
- posts;
- messages/email;
- settings;
- documentation.

Include AI-assisted settings/docs retrieval early if practical.

---

# 83. V1 SETTINGS

Initial categories:

- Account;
- Appearance;
- Privacy;
- Feed;
- Messages;
- Email;
- Notifications;
- Connected Apps;
- Cross-posting;
- Data;
- About.

Keep advanced protocol functionality hidden/experimental.

---

# 84. V1 DOES NOT REQUIRE

Do not block the first release on production completion of:

- blockchain governance;
- production decentralized KYC;
- full proof-of-personhood;
- algorithm marketplace;
- decentralized media hosting;
- NFT system;
- moderation marketplace;
- jurisdiction engine;
- global one-human-one-vote;
- independent indexers;
- fully federated encrypted communication.

But design interfaces that do not prevent these later.

---

# 85. ARCHITECTURAL ABSTRACTIONS

Where practical, avoid hardcoding one implementation directly into business logic.

Design interfaces such as:

```text
IdentityProvider

StorageProvider

SearchProvider

RankingProvider

ModerationProvider

ConnectorProvider

CredentialProvider

PaymentProvider
```

V1 may have only one implementation.

The architecture should assume competitors may implement others later.

---

# 86. REPOSITORY DIRECTION

Adapt to the existing Convo architecture rather than forcing this exact structure.

Long-term conceptual organization might resemble:

```text
/apps
  /web
  /mobile

/packages
  /ui
  /social-protocol
  /identity
  /connectors
  /feed-sdk
  /moderation-sdk
  /search-sdk
  /governance
  /crypto

/services
  /api
  /media
  /search
  /notifications
  /realtime
```

Do not restructure merely for aesthetics.

---

# 87. RESEARCH BEFORE IMPLEMENTING NONTRIVIAL FEATURES

For each meaningful implementation decision:

1. identify the actual user/engineering problem;
2. research current best practice;
3. compare credible alternatives;
4. prefer open standards;
5. use mature libraries;
6. consider security/privacy;
7. consider accessibility;
8. choose the simplest extensible option;
9. document the decision briefly;
10. implement;
11. test.

Do not use research as an excuse to stop implementation.

---

# 88. DO NOT OVERENGINEER V1

Avoid premature complexity.

Examples:

Do not implement decentralized consensus merely to store a profile picture.

Do not introduce blockchain where a signed database record is sufficient.

Do not implement a distributed CRDT system merely because eventual decentralization is desired.

Design clean boundaries now.

Replace implementations later.

---

# 89. MIGRATION FROM CONVO

Before significant modification:

1. inspect the full repository;
2. map frontend;
3. map backend;
4. map auth;
5. map current database;
6. map APIs;
7. map realtime architecture;
8. map messaging;
9. map media pipeline;
10. map deployment;
11. identify technical debt;
12. identify reusable components.

Then produce:

## Current Architecture

## Target Architecture

## Reusable Components

## Required Database Changes

## Security Risks

## Migration Strategy

## Phase 1 Implementation Plan

Then begin implementing.

Do not stop after producing these documents.

---

# 90. IMPLEMENTATION ORDER

Use approximately this sequence unless repository analysis proves another order is materially better.

## Phase 1 — Open Media product shell

- rebrand Convo;
- simplified design system;
- responsive/adaptive navigation;
- Feed;
- Clips;
- Messages;
- Profile;
- Search;
- Settings;
- light/dark/system.

## Phase 2 — Canonical social model

- normalized posts;
- media;
- follows;
- replies;
- reactions;
- content IDs;
- provenance-ready metadata;
- Raw / Relevant feed.

## Phase 3 — Email + Messages

- email provider abstraction;
- initial major providers;
- unified conversation model where appropriate;
- Open Media DMs.

## Phase 4 — Connector system

- connector SDK/interface;
- authentication;
- capability negotiation;
- cross-posting;
- status reporting.

## Phase 5 — Search + AI settings

- unified search;
- settings indexing;
- documentation search;
- AI intent mapping.

## Phase 6 — Algorithm infrastructure

- RankingProvider;
- manifests;
- permissions;
- marketplace foundation;
- sandboxing.

## Phase 7 — Moderation/reporting

- reports;
- confidence architecture;
- user filtering;
- moderation provider abstraction.

## Phase 8 — Identity/proof infrastructure

- persona roots;
- credential wallet abstraction;
- test proof-of-personhood;
- uniqueness commitments.

## Phase 9 — Governance

- OMIPs;
- proposals;
- one-human-one-vote experiments;
- constitutional model.

## Phase 10 — progressive decentralization

- alternative storage;
- external indexers;
- independent protocol implementations;
- blockchain trust anchors where justified.

---

# 91. UX SUCCESS TEST

A user unfamiliar with:

- blockchain;
- decentralized identity;
- ActivityPub;
- zero-knowledge proofs;
- governance;
- algorithm marketplaces;

should be able to open Open Media and immediately understand:

```text
Feed     Clips     Messages
```

If they cannot, simplify.

---

# 92. PRODUCT SUCCESS TEST

Open Media should provide value **before its own network has meaningful network effects**.

A user should be able to install it and immediately benefit by connecting existing communication systems.

That is fundamental to the go-to-market architecture.

---

# 93. ARCHITECTURAL SUCCESS TEST

If Open Media the company disappeared in the future, the protocol should ultimately be capable of continuing through independent implementations.

A mature Open Media ecosystem should not depend existentially on:

- one company;
- one domain;
- one server;
- one feed algorithm;
- one moderator;
- one storage provider;
- one search provider;
- one payment provider;
- one doorway.

---

# 94. FINAL PRODUCT PRINCIPLES

Remember these continuously:

> **Post everywhere. Message everyone. One app.**

> **Everything together.**

> **Your feed belongs to you.**

> **Your identity, audience, and content move with you.**

> **Applications are doorways. The human remains the constant.**

> **Blockchain proves; it does not host the social network.**

> **Money buys services, not political power.**

> **Global destruction is exceptional. Filtering is normal.**

> **Protocol rules determine interoperability. Doorway rules determine presentation.**

> **Build one implementation today as though competing implementations will exist tomorrow.**

> **Open Media should be obvious before it is powerful, and powerful when needed.**

---

# 95. START

Begin by analyzing the existing Convo repository.

Do not rewrite blindly.

Produce the migration analysis, then immediately begin implementing the smallest coherent Open Media V1.

The first concrete milestone is:

> **Transform Convo into an extremely simple black-and-white cross-platform communication application with Feed, Clips, and Messages; email integration; Raw and transparent Relevant feeds; canonical social content; universal search; searchable Settings; and the connector architecture needed for one-tap cross-posting.**

Everything else should grow from this foundation.
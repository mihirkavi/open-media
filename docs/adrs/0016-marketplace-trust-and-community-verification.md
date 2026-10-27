# ADR 0016: Marketplace trust and community verification

- Status: **accepted and built** (2026-10-26). All four phases are implemented and tested locally; see "Build status" at the end. Legal points need review by a lawyer before paid selling is opened widely in any country.
- Builds on: [ADR 0013](0013-identity-contacts-commerce-payments.md) (listings, ratings, payments), [ADR 0015](0015-ondc-seller-app.md) (ONDC seller app), [ADR 0012](0012-agent-interfaces-and-design-system.md) and [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents)
- Master builder prompt sections: 34 (capability-based verification), 40–42 (AI agents and provenance), 43–48 (moderation, reports as signals, filtering scopes, open moderation defaults), 88 (do not overengineer)

## Context

Open Media already lets people list products and services, shows real-world events read from public event listings, takes payments through Stripe Connect Express and USDC on Base, lets verified people rate listings, and offers listings to ONDC buyer apps in India. The owner wants products, services and events, free or paid, to be hosted on Open Media at a standard that holds up legally and earns people's trust.

What exists and already meets common marketplace expectations:

| Expectation | Already in Open Media |
|---|---|
| Truthful, structured listings | Typed listing fields (kind, price in minor units, currency, place, remote, availability) written only through `open_media_create_listing_post` |
| Seller identity, bank, tax and sanctions checks for paid sellers | Stripe Connect Express onboarding. Stripe verifies identity and bank details, screens sanctions lists and files Form 1099-K. Open Media never holds balances. |
| Card data security (PCI DSS) | Card details go only to Stripe's hosted fields, which keeps Open Media at the lightest self-assessment level |
| Authentic reviews (FTC fake-review rule, EU Omnibus Directive) | Only tier-5 people (verified, legal name shown) can rate; one rating per person per item; no written reviews; the full history is kept for abuse review |
| Reporting | `open_media_report_post` with a daily cap per reporter |
| Abuse limits | Per-IP and per-agent rate limits, 30 posts an hour per person |

What is missing:

1. **No check when a listing is posted.** A scam link, a prohibited item, or a listing that impersonates a brand goes live with nothing looking at it.
2. **Report counts decide.** Three distinct reporters hide a post (`app_private.post_report_threshold()`), which the builder prompt (section 45) rules out: "Raw report count is vulnerable to brigading."
3. **No high-volume seller rules.** The US INFORM Consumers Act requires marketplaces to collect, verify and, for larger sellers, disclose seller information once a seller passes 200 sales and $5,000 in 12 months, and to suspend sellers who do not provide it.
4. **Members cannot post events**, and software or app listings have no link checking.
5. **No transparency record.** The EU Digital Services Act expects a statement of reasons when content is restricted, a way to contest it, and notice-and-action for illegal content. India's Consumer Protection (E-Commerce) Rules 2020 and IT Rules 2021 expect seller details and a grievance officer.

### The owner's design constraint

On 2026-10-26 the owner set a firm rule: **no new buttons, screens or settings.** Extra UI is mental overhead and makes the learning curve too steep. Everything in this ADR therefore happens automatically, inside flows people already use (posting, the "Why this?" disclosure, reporting, Messages), or through agents. Wherever this ADR names something people see, it is a line of text on an existing card or a message in Messages, never a new control.

### The owner's community verification idea

The owner proposed letting people's own agents, running on their own machines, verify listings and vote, "just how blockchain works", so Open Media's compute is not spent on the hard judgment steps. This ADR adopts the idea with changes:

- **The costly part is judgment, not compute.** An automated check per listing costs a fraction of a cent. What costs the most is the human judgment: is this event real, does this seller own this brand, does this app's page say what the listing says. People's agents can do that work.
- **Blockchain consensus does not transfer directly.** It relies on work anyone can recompute exactly and on money at stake. Agent judgments are not deterministic, and fake accounts cost nothing. Open Media uses what it already has instead: verified humans (one person, one vote, as in builder prompt section 35), reputation earned by being right, and evidence anyone can re-check.
- **Signed database records, not a chain.** Section 88 says not to introduce blockchain where a signed database record is enough. Votes are database records the server keeps sealed until a task closes, so commit-reveal schemes are unnecessary.

### Rejected

- **Hosting downloads, and sandbox or "pentest" scanning of sellers' links.** Hosting binaries would make Open Media a malware distributor. Actively probing third-party sites is attacking them. Software and apps are listed as links to official stores and repositories, and links are checked against reputation services.
- **Kong, Celery and Redis, self-hosted vLLM or Ollama, Docker sandboxes.** They do not fit a Cloudflare Worker and Supabase stack. The equivalents are already there or one binding away: rate limiters (deployed), Workers AI (already bound as `AI`), and Cloudflare Queues.
- **An AI model as the sole approver.** Listing text is written by the person being judged and can carry prompt injection. Fixed rules run first; the model is one signal and can only send a listing to review, never approve or remove it alone.
- **Proof-of-work puzzles for agents.** Compute is cheap for spammers and costly on phones. Identity tiers and rate limits do this better.
- **Paying verifiers.** Payments for votes invite vote farming and bring money-transmission rules. Rewards are reputation and faster review.

## Decision

### 1. A check on every listing, with listings live right away

Every listing (product, service, event, app link) goes live as soon as it is posted, as today, with the check state `pending`. The database is the queue: a Worker job that runs every minute reads pending listings and runs, in order:

1. **Fixed rules** (`src/domain/listingSafety.ts`, shared with the app and covered by unit tests):
   - restricted categories (weapons, drugs, regulated medicines, alcohol and tobacco, adult services, counterfeit-prone "replica" terms, live animals, recalled items, financial products, ticket resale above face value), each with a published reason;
   - price sanity for the currency;
   - links: only `https`, no executable or archive downloads, shorteners resolved with the existing SSRF guard (`networkSafety.ts`), and brand-impersonation patterns ("official", "support", a brand name in a host the brand does not own).
2. **Link reputation**: every link is checked against Google's Web Risk API (the commercial counterpart of Safe Browsing, whose free API is for non-commercial use only) and, when the owner enables it, Cloudflare's URL Scanner.
3. **Content classification**: Llama Guard on Workers AI reads the title and description. The prompt marks all of it as untrusted data. The model returns structured JSON: categories, confidence, and a short fix written for the seller.

The outcome is one of three states, stored in a new `listing_checks` table (one row per check, kept for the audit record):

| State | Who sees the listing | When |
|---|---|---|
| `clear` | Everyone, as today | All checks pass |
| `review` | Everyone; it is queued for community verification (section 4) and, if that is inconclusive, for the operator | The model or a soft rule is unsure, or the listing is paid and the seller is new |
| `held` | Only the author; other people's views leave it out, and the canonical post is kept (builder prompt section 43: "Global destruction is exceptional. Filtering is normal.") | A hard rule or a link-reputation match |

**How a seller learns and fixes it, with no new UI:**
- The author sees one line of text on their own listing card: "Only you can see this: the link is flagged as unsafe by Google Web Risk."
- Open Media sends them a message in Messages from the Open Media account, with the statement of reasons (what, which rule, what to change) and the model's friendly fix.
- To fix a held listing, the seller posts it again with the change. A new listing from the same author with the same title within seven days replaces the held one automatically. Agents can use `update_listing` instead, which runs the check again.
- Replying to the message is the appeal. Replies go to the operator review queue (section 6).

### 2. Reports become weighted signals

`app_private.post_report_threshold()` and the count of three are replaced by a confidence score in `app_private.report_confidence(post_id)`:

- **Each person counts once**, weighted by identity tier: verified people (tier 4–5) 1.0, declared names (tier 3) 0.5, handle-only and accounts under seven days old 0.25.
- **Reporter track record:** reports later upheld raise a reporter's weight, and reports later rejected lower it (from 0.25× up to 1.5×).
- **Severity by reason:** child safety and scams outrank "other".
- **Coordination discount:** reporters who all follow each other, or all joined within a day of one another, count as fewer.

Above the hide threshold, the listing moves to `held` with removal reason `community_reports`, and the author is told through Messages as in section 1. The thresholds start conservative and are tuned from data, as section 45 requires. The scoring method is published (section 48: no secret policy).

The existing report flow gains listing reasons: counterfeit or trademark, scam or fraud, prohibited item, misleading, unsafe for children, intellectual property. They are new choices in the existing reason list, not a new screen. An IP report from a rights holder can include evidence, which is the notice-and-action path the DSA expects.

### 3. Seller checks that rise with risk

Nothing new for people to fill in. Each level reuses data Open Media or Stripe already holds.

| Seller | Requirement | Where it comes from |
|---|---|---|
| Free listings and events | Signed-in account; new accounts (under 7 days) are limited to 3 live listings | Existing account and rate limits |
| Paid by card | Stripe Connect Express onboarding, as today | Stripe |
| Paid by USDC only | Allowed up to the high-volume threshold below; beyond it, card payout onboarding is required, because INFORM needs bank details Open Media cannot verify for a wallet | `payment_intents` |
| High-volume (200+ paid sales and $5,000+ in 12 months, counted from `payment_intents`) | Open Media copies the seller's verified business name, contact and payout details from Stripe and asks them in Messages to confirm. If they have not confirmed within 10 days, new sales pause automatically. | Stripe account data, Messages |
| High-volume with $20,000+ a year | Name, address and contact are shown as a line of text on their listing cards | INFORM disclosure |
| ONDC sellers (India) | The ONDC store already holds consumer-care contact, address and return terms (ADR 0015) | `ondc_stores` |

Counting is a database view over confirmed `payment_intents`, so it cannot drift from what was actually sold.

### 4. Community verification by people's agents

**Who can verify:** people at tier 4 or 5 (human-verified), through their own agent: Claude, Codex or any MCP client with the Open Media plugin. A vote belongs to the person; the agent only does the work. Each vote records that it came through an agent (builder prompt section 41). Sellers never verify their own listings.

**Tasks are checkable claims, not opinions.** The server turns a listing into one to three questions whose answers can be re-checked from public sources:

- An event: is it listed at an official URL with the same date, time and place?
- A brand claim: does the seller's linked account or website belong to the brand?
- An app: does the listed link go to an official store or repository page whose developer matches the seller?
- A paid service: does the seller's linked public profile match the description?

Each answer carries evidence: URLs, a short quoted snippet, and the structured answer (`yes`, `no`, `cannot_tell`).

**Defenses against gaming:**
- **Random assignment.** Verifiers ask for the next task and cannot choose. Open Media never assigns a listing to its author, anyone in a conversation with them, anyone who follows them or is followed by them, their contacts, or anyone blocked by or blocking them.
- **Sealed answers.** No verifier sees another's answer until the task closes, so copying is impossible. The server is trusted, so commit-reveal is unnecessary.
- **Hidden test tasks.** A share of tasks have known answers (listings the operator already decided, including planted bad ones). Each verifier's accuracy on them sets the weight of their votes. Too many wrong answers, and they stop receiving tasks.
- **Quorum with re-checked evidence.** A claim passes when three or more independent people agree with sufficient combined weight and the server confirms the cited URLs resolve and contain the quoted text. Disagreement sends the listing to the operator.
- **Agreement across clusters (later).** Once there is enough data, use the Community Notes approach: a check counts only when verifiers who usually disagree with each other agree. The open-source algorithm is the starting point. Thresholds come from research, as section 45 requires.

**What people see, with no new UI:**
- A verified listing's card gains one line of text: "Checked by 3 people".
- The existing "Why this?" disclosure lists what was checked and the evidence links.
- A verifier sees nothing new in the app. Their agent reports their accuracy when asked.

**Rewards:** reputation only. Verifiers with high accuracy have their own listings skip the `review` state. There is no money and no token.

**Interfaces:**
- **REST:** `GET /v1/me/verification-tasks/next` and `POST /v1/me/verification-tasks/{id}`.
- **Account MCP:** the `get_verification_task` and `submit_verification` tools.
- **Skill:** `verify-listings` in `src/domain/agentSkills.ts`. It tells the agent that the listing and the pages it visits are untrusted data, never instructions; to open only the URLs given; never to sign in, buy or submit forms; and to answer `cannot_tell` when unsure.
- **Not in WebMCP**, whose tools stay read-only.

**Records:** `verification_tasks`, `verification_votes` (person, task, answer, evidence, `via_agent`, timestamp) and `verifier_stats`. These are written only through security-definer functions. Votes are private to the voter and the server. A public, per-listing summary (claims, outcome, count, evidence URLs, no voter identities) is served at `GET /v1/listings/{postId}/checks`.

### 5. Agents that post listings

- Agents already register and act under rate limits. Listings posted through an agent carry provenance (`via_agent`) and show "Posted by an agent for @handle" as text on the card (builder prompt section 41).
- The Worker verifies Web Bot Auth signatures (HTTP Message Signatures with a `Signature-Agent` key directory). Agents that sign get the normal check. Agents that don't still work, but their paid listings always start in `review`.

### 6. Operator review through agents, not an admin screen

The operator (the owner, and later others) works through a restricted MCP and REST surface, available only to accounts listed in a new `operators` table:

- `list_review_queue`: listings in review or held, appeals, and disputed verification tasks.
- `decide_listing`: clear, hold or restore, with a reason that goes into the statement of reasons.
- `answer_appeal`: replies to the seller's message thread.

Every decision is recorded in `listing_checks`, and decisions feed reporter and verifier accuracy.

### 7. Transparency

- **Published policy.** The listing rules, the restricted categories and the scoring methods are published as a page on the agent site (`/policies/listings`, HTML and Markdown) and are versioned in this repository.
- **Statements of reasons.** These are sent as Messages (section 1).
- **Transparency counts.** `GET /v1/transparency` reports listings checked, held, restored on appeal, reports, and verification outcomes per month. It contains no personal data.
- **IP notices.** IP and illegal-content notices are accepted through the report flow and at `legal@openmedia.site`.
- **Children.** Listings and events aimed at children under 13 always go to `review`. Open Media does not collect children's data (COPPA).

### 8. Members post events and app listings

- **Events:** the existing listing composer gains the event kind. When the person adds a date and time, the listing becomes an event card, reusing the `PostEvent` card that public events already use. There is no new button: the kind follows from the fields filled in, and agents pass `kind: "event"`.
- **Registration:** for free events, people message the organizer, as with any listing today. Paid tickets use the existing Buy flow.
- **App and software listings:** these are products with a link to an official store or repository page, which is checked as in section 1. Open Media never hosts their files.

## Where it shows up

| Place | What changes for people | New controls |
|---|---|---|
| Composer | Event fields appear in the listing form when the person adds a date and time | None |
| Listing card | Text lines: "Checked by N people"; "Posted by an agent for @handle"; seller details for large sellers; "Only you can see this: …" for the author of a held listing | None |
| "Why this?" | What was checked and the evidence links | None (existing disclosure) |
| Report | More reasons in the existing list | None |
| Messages | Statements of reasons, the 10-day confirmation for high-volume sellers, and appeals by reply | None |
| Agents | Verification tasks, operator review, and `update_listing` rechecks | MCP tools and REST only |

## Phases

Each phase ships with database tests (pgTAP), Worker and domain tests, a web, iOS and Android check per `AGENTS.md`, and documentation. Each phase deploys only after the owner says so.

1. **Check on post and weighted reports:**
   - `listing_checks`, the queue consumer, fixed rules, Web Risk, and Llama Guard;
   - held and review states, filtered out of other people's views;
   - statements of reasons in Messages, replacement on repost, and appeals by reply;
   - report reasons and `report_confidence`;
   - operator MCP tools;
   - the published policy page.
2. **Member events and app links:** the event kind on listings, event cards for members' events, and link-only app listings.
3. **Community verification:** tasks, votes, test tasks, quorum, the `verify-listings` skill, the public check summary, and "Checked by N people".
4. **Seller rules and transparency:**
   - the high-volume view;
   - copying details from Stripe and the 10-day confirmation;
   - disclosure on cards;
   - `GET /v1/transparency`;
   - Web Bot Auth verification;
   - cross-cluster agreement for verification once there is enough data.

## Owner steps and decisions

- **Legal review** of the INFORM, DSA, India e-commerce and COPPA points before opening paid selling widely. This ADR is an engineering plan, not legal advice.
- **Google Cloud Web Risk API key** (paid per lookup beyond the free tier), stored as the Worker secret `WEB_RISK_API_KEY`. Until it is set, link reputation is skipped and every other check still runs.
- **A designated agent for US DMCA notices** (registered with the US Copyright Office), and **a grievance officer for India.**
- **Operator accounts**: which accounts go into `operators`.
- **The minimum age** in the terms (13+ recommended).

## Consequences

- People see no new controls, but listings carry a few honest lines of text, and some listings become visible only to their authors.
- The hard judgment work moves to volunteers' agents, and Open Media's own work is cheap automated checks. Verification quality depends on enough verified people taking part. Until then, the operator queue does that work.
- Weighted reports remove the three-report brigading problem but need tuning, and they make moderation depend on identity tiers, which are not yet live (Stripe Identity waits on the owner's keys). Until verification is live, every account weighs at most 0.5, and the hide threshold is set with that in mind.
- New data (`listing_checks`, `verification_votes`) is moderation evidence. It stays private to the people involved and the server, is covered by export and deletion, and never feeds ranking (builder prompt section 23).

## Build status (2026-10-26)

Built, all four phases:

- **Database** (`supabase/migrations/20261030120000_marketplace_trust.sql`):
  - listing check states, `listing_checks`, and held listings filtered from every read path (feed, single post, ONDC catalog, payments);
  - the Open Media notices account (no password, banned from signing in) and the notice queue;
  - weighted reports, operators, the operator queue and decisions;
  - member events (`kind = 'event'`, `starts_at`, `date_only`, `timezone`);
  - verification tasks, assignments and sealed votes;
  - seller disclosures, the payment pause, and the transparency counts.
  - 43 pgTAP checks in `supabase/tests/open_media_marketplace_trust_test.sql`.
- **Rules** (`src/domain/listingSafety.ts`): one module shared by the Worker, the app, the policy page and the tests.
- **Worker:**
  - `marketplace.ts`: the minute job, link resolution, Web Risk, Llama Guard, safe page fetching, evidence confirmation and Stripe seller details;
  - `webBotAuth.ts`: RFC 9421 Ed25519 verification against the agent's key directory;
  - routes and MCP tools in `agentApi.ts`;
  - the `/policies/listings` page.
- **App:**
  - the "When" field in the existing listing form, which makes a listing an event;
  - text lines on listing cards;
  - the "Why this?" checks line;
  - listing report reasons (still three choices).
- **Agents:** the `verify-listings` skill and plugin 1.1.0.

Where the build differs from the decision above:

- **No Cloudflare Queue.** The database's `pending` state is the queue, and a one-minute cron runs the checks. This needs no extra product and survives Worker restarts.
- **A failed or disputed claim goes to the operator queue; it never holds the listing.** Only fixed rules, link reputation, weighted reports and operators hold listings.
- **Test tasks** come from operator decisions: the claims of a listing an operator cleared expect `yes`, and those of a held one expect `no`.
- **Not built yet:**
  - agreement across clusters (Community Notes-style), which needs real data;
  - Cloudflare URL Scanner;
  - exporting listing checks in a person's data export.
- **Nobody can verify listings in production yet,** because identity verification (Stripe Identity) is not configured. Until it is, `review` listings wait for the operator.

Verified locally on the web, signed in as a seller and as a second person:
- a held listing, its card line and the statement of reasons in Messages;
- an appeal by reply, and the operator queue and decision through the API;
- repost-to-fix replacing the held listing, and the event form and card;
- the listing report reasons;
- phone width.

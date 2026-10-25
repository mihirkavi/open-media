# ADR 0013 (proposed): Identity tiers, unified profiles, structured listings, ratings and payments

- Status: **accepted** (owner decisions recorded 2026-10-24; implemented phase by phase)
- Date: 2026-10-24
- Scope: the "Master Implementation Prompt" for unified identity, profiles, contacts, events, commerce, ratings, payments and monetization
- Out of scope (deliberately deferred): governance, incorporation, ownership, tokens, person ratings, written reviews, subscription billing

The rule for every decision below: **add capabilities, not complexity.** Feed, Clips and Messages stay the only primary destinations.

---

## 1. Current-state audit (verified against code on 2026-10-24, `main` at 1d7a978)

| Area | What exists | State |
| --- | --- | --- |
| Navigation | Feed, Clips, Messages; Search, Create, Profile, Settings as utilities; web landing, mission and developer pages | Implemented |
| Design system | Black-and-white tokens (`src/theme.ts`), Inter + Instrument Serif through `src/ui/Text.tsx`, light/dark/system | Implemented |
| Posts | `public.posts` (text, one optional video), canonical `SocialPost` shared by Feed and Clips, Raw/Relevant with "Why this?" | Implemented |
| External networks | Farcaster, Lens, Hive, DeSo read in Feed/Clips/Search; cross-posting signed on device | Implemented (cross-posting untested live) |
| Profiles | `public.profiles` (handle, display_name, bio, avatar). **Any signed-in user can read every profile row** (`using (true)`); public API exposes handle/name/bio/avatar/joined/post count | Implemented, **no visibility control** |
| Other people's profiles | No screen. Feed/Clips/Messages avatars and names are not tappable | **Missing** |
| Follows | None (no table, `relevance.followsAuthor` always false) | **Missing** |
| Identity / verification | `Identity` + `Person` model; `suggestIdentityMatch` produces review-only suggestions; email senders can be BIMI-verified (separate, brand badge) | Partial (models only), **no personal verification** |
| Contacts | Device contact cleanup (`src/contacts`), "Contacts on this device" toggle; no server copy; `isPhoneContact` only in mock data | Partial, **no unified overlay or reconciliation** |
| Messaging | Native Open Media DMs (RLS, blocks, reports, replies), email (IMAP/POP/SMTP), 11 chat bridges; person-first list | Implemented |
| Events | Open Media Events engine in the Worker (Luma, Meetup, Eventbrite, ICS/schema.org feeds; dedupe, ranking, plans, calendar holds) on **D1 with a single owner account**, reachable via OAuth MCP | Implemented, **not in Feed, not per-user** |
| Products / services / ratings | None | **Missing** |
| Payments / wallets / monetization | Wallet used only to approve Lens cross-posting (viem); no payment model | **Missing** |
| Agent interfaces | REST + OpenAPI + `/open/mcp` + `/me/mcp` (32 tools) + `/llms.txt`, all built on shared code | Implemented (pushed, **not yet deployed**) |
| Tests | 99 app, 75 Worker, 5 pgTAP database suites | Implemented |

Duplication to avoid: the events engine has its own `users` table on D1; Supabase has `profiles`. New work must not add a third identity store.

---

## 2. Architecture

### 2.1 Modules (logical, inside the existing monorepo)

| Module | Lives in | Reuses |
| --- | --- | --- |
| Identity & verification | `supabase` (tables, RLS) · `services/mail-sync/src/verification/` (provider webhooks) · `src/domain/identity.ts` | Supabase auth, existing `profiles` |
| Visibility & follows | `supabase` · `src/data/socialGraph.ts` | `user_blocks`, `abuse_reports` |
| Unified profile & contacts | `src/domain/people.ts` (merge/split, name resolution) · `src/contacts/` (device overlay) · `src/ui/PersonProfile.tsx`, `ProfilePreview.tsx` | `Person`/`Identity`, `suggestIdentityMatch`, device contacts, network feeds |
| Structured posts | `posts` + `post_listings` · `SocialPost.listing` · Feed renderers | canonical post, Feed, Clips, search |
| Events in Feed | Worker adapter: events engine → `SocialPost` (kind `event`) | events engine, dedupe, providers |
| Ratings | `listing_ratings` + history, server functions | listings, verification |
| Payments | `src/domain/payments.ts` (contracts) · `supabase` (intents, receipts) · Worker providers (Stripe, on-chain verifier) · `src/payments/wallet*.ts` | viem (already a dependency) |
| Monetization | `creator_settings` + payment intents with `context = post` | payments |
| Agent interfaces | `agentApi.ts` new tools/routes calling the **same** server functions | existing REST/MCP |

### 2.2 Identity model (one account, separate attributes)

New table `public.identity_verifications` (owner-only RLS, written only by the Worker's verification webhook via a `security definer` function):

```
user_id, provider ('stripe_identity' | 'persona' | …), provider_reference,
status ('pending' | 'verified' | 'failed' | 'expired' | 'revoked'),
verified_at, expires_at, legal_name_encrypted, document_country, age_over_18 boolean
```

No document images, numbers or selfies are stored; the provider keeps them under its retention policy. `legal_name_encrypted` uses the same Worker-held key pattern as mailbox passwords.

New `profiles` columns: `name_disclosure ('handle_only' | 'declared' | 'verified_legal')`, `visibility ('public' | 'private')`, `is_verified boolean` (derived, set only by the definer function).

Tier is **computed, never stored or accepted from clients**:

| Tier | Rule |
| --- | --- |
| 1 | no session |
| 2 | session, `name_disclosure = handle_only`, not verified |
| 3 | session, `declared`, not verified |
| 4 | verified, `name_disclosure ≠ verified_legal` → blue tick, shown name is the handle or declared name |
| 5 | verified, `verified_legal` → blue tick, shown name = decrypted legal name |

Tier 4 legal names are decrypted only inside the definer function that returns the *viewer-appropriate* display name, so no API, export for others, search index, error or wallet link can carry them.

**Badge**: one blue tick component (`VerifiedBadge`) used everywhere an Open Media identity appears. BIMI-verified email senders keep their existing, visually different domain mark; external network badges are never rendered as Open Media verification.

### 2.3 Visibility and follows

`public.follows (follower_id, followee_id, status 'pending'|'accepted', created_at)` with RLS. A single `app_private.can_view_profile(viewer, owner)` and `can_view_post(viewer, post)` decide access and are used by **every** reader: the app, `open_media_public_*` functions, search, the public API and MCP. Private profiles expose only handle, shown name, avatar and tick until a follow is accepted. Blocks override everything.

Profile discovery policy changes from `using (true)` to "public fields via a view; full row only when `can_view_profile`".

### 2.4 Unified profile and contacts

- A `Person` in the app is assembled per viewer from: the Open Media profile (what the viewer may see), linked external identities (public network profiles), and the **viewer's private overlay**: device contacts, connected address books, aliases and notes.
- **Decision: the private overlay syncs through an encrypted server store.** Each contact card (names, aliases, phones, emails, notes and merge links) is encrypted by the Worker with a contacts key before it reaches the database, and the table's row-level security lets only its owner read or write it. No public function, view, search index, public API or public MCP tool reads it; only the owner's own account API and `/me/mcp`. Device contacts are imported only when the person turns on "Contacts on this device".
- Reconciliation runs on the device: auto-merge only on high-confidence signals (shared verified email or phone, explicit link); everything else becomes a review suggestion. Merges are stored as reversible links (`merge_id`, original records untouched); undo and split restore the originals. Merging is viewer-local and never asserts globally that two accounts are one person.
- Shown name follows the order: verified legal name if disclosed → declared name → handle; the viewer's saved contact name is kept as a private alias and searchable. Never replaced by an undisclosed legal name.
- Unified timeline: Open Media posts plus posts from the person's linked open-network identities, with a compact source filter.

### 2.5 Structured posts

`public.post_listings (post_id pk/fk, kind 'product'|'service', title, price_minor, currency, location_text, remote boolean, availability, listing_group_id)` — typed columns, not strings. `SocialPost` gains `listing?` and `event?`. `listing_group_id` lets the same item listed in several places share one rating.

Events: a Worker adapter turns events-engine results into `SocialPost` (kind `event`, provider, canonical URL, registration handoff). Because the engine is single-owner today, **public event discovery** (no personal plans or calendar) is exposed to everyone; personal planning stays on the owner OAuth MCP until per-user events are designed.

### 2.6 Ratings

`public.listing_ratings (listing_group_id, rater_id, stars 1–5, updated_at, unique(listing_group_id, rater_id))` + `listing_rating_history`. Writes only through `open_media_rate_listing`, which checks tier 5 server-side; aggregates are a view (`avg`, `count`). No text, no replies, no person ratings. Rating abuse uses the existing report flow.

### 2.7 Payments (provider-agnostic, non-custodial)

Common object `payment_intents (id, payer_id, recipient_id, amount_minor or amount_units, currency_or_asset, rail 'card'|'onchain', provider, context_type, context_id, platform_fee, provider_fee_estimate, status 'created'|'awaiting_payer'|'submitted'|'confirmed'|'failed'|'refunded', provider_reference, idempotency_key)`, plus `payment_events` (append-only, from verified webhooks or chain confirmations). **Status can only advance from server-verified evidence**; clients can never mark a payment confirmed.

- **Fiat (recommended: Stripe Connect, Express accounts, destination charges)**: product/service purchases, creator tips and one-time paid content. Sellers and creators onboard through Stripe; Open Media never holds balances. **Pure P2P transfers are marked "not available"**, because card-network marketplaces don't cover them.
- **Crypto (external wallets only)**: web uses EIP-6963 discovery; iOS/Android use WalletConnect (Reown AppKit). Recommended first asset: **USDC on Base** (low fees, stable value). The payer's wallet sends directly to the recipient's address; the Worker confirms the transaction on-chain before marking it confirmed. No seed phrases, keys or custody; no token of our own. A recipient's wallet address is shown only for that transaction, never on Tier 4 profiles.
- **Fees**: configurable in one server table; P2P/on-chain = 0 % Open Media fee; creator/commerce fee starts at 0 % until you decide, always shown before approval.
- Every money-moving action gets one clear confirmation sheet (recipient, amount, fees, network); it is the one place we deliberately add a step.

---

## 3. Where everything appears (no new primary tabs)

| Capability | Feed | Clips | Messages | Profile (other person) | Search | Settings / own Profile |
| --- | --- | --- | --- | --- | --- | --- |
| Open a person | Avatar/name → full profile (web: hover preview, click opens) | Creator name → profile | Header name → same profile | — | People results → profile | — |
| Blue tick | After name | After name | After name | Next to name | In results | Verification status |
| Follow / request | Preview card (web) | — | — | Single Follow / Requested / Following control | — | Followers & requests list, remove follower |
| Private details (phone, alias) | — | — | — | Below the public header, labelled "Only you see this" | Alias is searchable (on device) | Contacts on this device |
| Merge review | — | — | Quiet "Is this the same person?" row on a conversation when unsure | "Linked identities" with Undo/Split | — | Contacts → Review suggestions |
| Products / services | Listing card: title, price, ★ avg, Message | — | Opens conversation with listing attached | Their listings in timeline | "products", "services" understood | My listings (in Profile) |
| Events | Event card: date, place, price, source; Register opens official page | — | "Ask organizer" when they're on Open Media | — | "events this weekend" understood | — |
| Rating | Stars on listing card; tap to rate (tier 5) or "Verify to rate" | — | — | — | — | Verification |
| Pay / buy / tip | "Buy" or "Pay" on listing; "Tip" in post's ⋯ menu when creator enabled tips | Tip in ⋯ | "Send money" in conversation ⋯ | — | — | Payments: wallets, cards, payouts, history; Creator: enable tips/paid posts |
| Privacy | — | — | — | — | — | Account → Public / Private, name shown |

Desktop hover previews are an enhancement; every action is also reachable by click/tap, keyboard and screen reader.

---

## 4. Phases and acceptance criteria

| Phase | Delivers | Done when |
| --- | --- | --- |
| 1. Unified profile & contacts | Tappable identities everywhere, PersonProfile + web hover preview, unified timeline with source filter, device overlay, auto/review merge, undo/split | Profiles open from Feed, Clips, Messages and Search on web/iOS/Android; contact cards are readable only by their owner and stored only as ciphertext (tests); merge undo restores originals (test) |
| 2. Identity, verification, privacy | Tier computation, name disclosure, blue tick, public/private, follows & requests, verification provider abstraction (provider **off** until configured) | pgTAP: guests and non-followers can't read private posts/profile fields via app, API or MCP; tier 4 legal name never returned; badge unforgeable |
| 3. Listings & events in Feed | Product/service posts, event cards from the events engine, search understands them | Cards render on all platforms; provenance kept; one failing provider doesn't break Feed |
| 4. Ratings | Tier-5 five-star ratings with edit and aggregates | pgTAP: non-tier-5 can't rate; edits don't double count |
| 5. Payment foundations | Contracts, intents, events, wallet connect/disconnect, Stripe Connect onboarding in test mode, on-chain confirmation | Test-mode card payment and Base Sepolia USDC payment confirmed end to end; forged confirmation rejected; **no live money until you approve live keys** |
| 6. Creator monetization | Tips and one-time paid posts on the same intents | Test-mode tip reaches creator account with fees shown |
| 7. API & MCP completion | Every new capability in REST, OpenAPI and MCP with read/write separation and confirmation for high-impact actions | Agent cannot exceed the human's permissions (tests) |

Each phase is its own commit series with tests, docs and screenshots.

### Phase 1 status (2026-10-24)

Built:

- **People model** (`src/domain/people.ts`, 9 tests): identity references for Open Media accounts, open-network authors, email, phone and bridged chats; contact cards; reconciliation that links automatically only when exactly one card shares an email address or phone number, turns shared or name-only matches into suggestions, and never links on a name; confirm, reject, undo and split, which remember the choice and leave the card untouched; device re-import that keeps links and notes.
- **Encrypted contacts** (`supabase/migrations/20261024120000_people_and_contacts.sql`, `services/mail-sync/src/contactsStore.ts`): the Worker encrypts each card with AES-256-GCM under a contacts key (its own `CONTACTS_KEY`, or one derived from the mail key) and stores it through the person's own token; the table holds only ciphertext and its row-level security admits only the owner (12 pgTAP checks, 3 Worker tests, and a live check that neither names nor numbers appear in the database and another account sees no cards).
- **Unified profile** (`src/ui/PersonProfile.tsx`, `src/ui/people.tsx`): every author name and avatar in Feed, Clips, Search and the Messages thread heading opens the profile; desktop web shows a hover preview. The profile shows what the person made public, a clearly marked “Only you see this” section (saved name, numbers, notes, links with Undo, suggestions to confirm or reject, “Add to my contacts”), and one timeline of their Open Media posts and the Farcaster, Lens, Hive and DeSo accounts they list, with a source filter. A source that fails is named, not fatal.
- **Your profile** (`src/ui/PeopleSettings.tsx`): edit the open-network accounts shown publicly (up to 8), see your contact count and pending suggestions, import device contacts on iOS and Android, and open your own public profile.
- **Agents**: `GET /v1/people/{network}/{handle}` and the `get_person_timeline` MCP tool (public); `/v1/me/contacts` (GET, PUT, DELETE), `PUT /v1/me/linked-accounts` and the `list_my_contacts`, `save_contacts`, `delete_contact` and `set_linked_accounts` tools on `/me/mcp` only.

Not yet: listed accounts are declared by their owner and not proven (proof of ownership arrives with Phase 2 verification); reconciliation does not yet use the phone numbers and emails that bridged networks other than WhatsApp hold; device import has no in-app review step before upload; the people screens were checked on web (desktop and 375 px, light and dark, signed in and out), but not yet on the iOS Simulator or Android emulator: the development Mac ran out of memory and the simulator would not boot. The native code paths are shared React Native components plus `readDeviceContacts`, which existed before this phase.

### Phase 2 status (2026-10-25)

Built:

- **Identity tiers and the blue tick** (`supabase/migrations/20261025120000_identity_visibility_follows.sql`): `identity_verifications` can be written only by the server (`service_role`) and holds no document images or numbers. The tier, the tick and the shown name are computed by the database. A legal name is stored encrypted, and as plain text only while its verified owner chooses to show it; switching away or losing verification removes it. Choosing the legal name before verification is refused.
- **Private accounts and follows**: `follows` with requests, accept, decline and remove. `app_private.can_view_profile` is the one access rule used by the feed, single posts, profiles, the public API and MCP. Blocks override follows. Making an account public again accepts waiting requests.
- **Profiles read through functions**: search, conversations and agents get names from `open_media_profile_cards` and `open_media_search_profiles`, so a withheld name never leaves the database. Direct reads of `profiles` return your own row, public profiles that show a declared name, and people you already talk to (`20261025130000_profile_read_compatibility.sql`), which keeps installed app versions working; private and handle-only profiles are reached only through the functions.
- **Verification provider** (`services/mail-sync/src/verification.ts`): Stripe Identity hosted checks (document plus live selfie), signed webhooks only, results re-read from Stripe. **Off until the operator sets four Worker secrets** (see the mail-sync README); until then the app says "Not available yet" and no one has a tick.
- **App**: `VerifiedTick` after names in Feed, Clips, Messages, previews and profiles (verified email senders now use a distinct double-check mark); Follow, Requested and Following on profiles; a locked view for private accounts; "Privacy and identity" and "Followers" on your profile.
- **Agents**: `/v1/me/identity` (GET, PUT), `/v1/me/verification`, `/v1/me/follows`, `/v1/me/follow-requests/{id}`, `/v1/me/followers/{id}` and matching MCP tools on `/me/mcp`.
- **Tests**: 21 pgTAP checks (clients cannot verify themselves, tier 4 never leaks the legal name, private posts stay hidden from guests, pending followers and blocked followers), 6 Worker tests (signatures, forged events, encryption of the legal name, age).

Not yet: no real Stripe Identity session has run (no keys); the existing profiles stay public with their declared names (decision 5 below, applied as the default); the relevant feed does not yet rank followed people higher; phones not verified (the development Mac ran out of memory).

Phases 1 and 2 were deployed to production on 2026-10-25 (see `docs/PRODUCTION_READINESS.md`).

### Phase 3 status (2026-10-25)

Built:

- **Products and services** (`supabase/migrations/20261026120000_post_listings.sql`): `post_listings` holds typed details for a public post: product or service, title, price as whole minor units (or "ask for price"), currency, place, remote or ships, availability, and a `listing_group_id` for phase 4 ratings. Listings are written only through `open_media_create_listing_post` (one transaction with the post, idempotent per client id) and changed only by their author through `open_media_update_listing`. Public posts, the public API and agents carry the listing.
- **Composer and cards** (`src/ui/ListingCards.tsx`): a price-tag button in the existing composer adds listing fields; no new screen or tab. The Feed shows a listing card with the price and place, and "Message seller" or "Ask about this" opens a conversation. Cross-posting sends the title, price and caption as plain text.
- **Events in the Feed** (`services/mail-sync/src/publicEvents.ts`, `src/data/eventsService.ts`): `GET /v1/events/upcoming` runs the events engine's providers (Luma, Meetup, Eventbrite) and cross-platform de-duplication without reading anyone's preferences, plans or calendar, so it is public. Upcoming events appear as cards after every sixth post in the mixed Feed, with date, place, price, organizer, the platforms that list them, and "Register on …", which opens the official page. "Why this?" says where each event came from. If the service or a provider is unreachable, the Feed shows no events and nothing else changes.
- **Search**: "events this weekend", "desk for sale" and "hire a designer" are understood as events, products and services, in the app and for agents.
- **Agents**: `GET /v1/events/upcoming` and the `find_upcoming_events` tool (public); `POST /v1/me/listings`, `PATCH /v1/me/listings/{postId}` and the `publish_listing` and `update_listing` tools on `/me/mcp`.

Not yet (phase 3): events cover the San Francisco Bay Area only, because the events engine's area list does; Open Media members cannot yet post their own events (event posts come only from public listings); payments for listings arrive in phase 5; "Ask organizer" for organizers on Open Media is not built.

### Phase 4 status (2026-10-25)

Built:

- **Ratings** (`supabase/migrations/20261026130000_listing_ratings.sql`): one 1–5 star rating per person per listed item (`listing_group_id`), written only through `open_media_rate_listing`, which checks tier 5 in the database (verified and showing the legal name). Changing a rating replaces it, so edits never count twice; `open_media_remove_rating` withdraws it. Every change is kept in `listing_rating_history`, which clients cannot read, for abuse review. People cannot rate their own listings or the listings of someone they blocked. There are no written reviews, no replies and no ratings of people.
- **Listing cards** show the average, the count and the viewer's own stars; tapping a star rates, tapping it again withdraws. Anyone below tier 5 is told how to qualify.
- **Agents**: `PUT` and `DELETE /v1/me/listings/{postId}/rating` and the `rate_listing` tool, which tells agents to ask the person for the number of stars.
- **Tests**: 10 pgTAP checks (unverified and tier 4 refused, out-of-range stars refused, edits don't double count, averages and the rater's own stars in the feed, no direct writes, withdrawal, history).

Not yet: nobody can rate in production until identity verification is configured (no Stripe Identity keys yet); rating abuse goes through the existing post report flow, with no rating-specific review screen.

---

## 5. Owner decisions (2026-10-24)

1. **Identity verification provider.** **Decided: Stripe Identity** (document + selfie, documents stay with Stripe, one vendor with payments). Alternative: Persona (more configurable, separate vendor). Either needs your account and keys; until then verification shows "coming soon" and no one gets a tick.
2. **Fiat payments provider.** **Decided: Stripe Connect (Express)**. P2P money transfers stay "not available" on this rail.
3. **Crypto rail.** **Decided: external wallets, USDC on Base**, testnet first.
4. **Where private contact details live.** **Decided: encrypted server sync** (owner chose it over device-only), with owner-only access as described in 2.4.
5. **Existing profiles.** Applied as the default in phase 2 (not yet confirmed by the owner): all stay **public**; current display names are `declared` (tier 3). Private is opt-in.
6. **Platform fee for creators/commerce.** Proposed (not yet confirmed): **0 % for now**, configurable later.

Nothing in phases 1–7 will create live charges, real verifications or production schema changes without your explicit go-ahead for that step.

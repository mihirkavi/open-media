# ADR 0015: Open Media as an ONDC seller app

- Status: **accepted** (2026-10-25). Phase 1 is built. Joining the network needs the owner (see "Owner steps").
- Builds on: [ADR 0013](0013-identity-contacts-commerce-payments.md) (structured listings and payments)

## Context

ONDC (Open Network for Digital Commerce) is India's open commerce network, built on the Beckn protocol. Buyer apps (Paytm, Magicpin, Ola, PhonePe's Pincode and others) find and order from sellers listed by any registered seller app, so a seller reaches every buyer app at once. This matches Open Media's mission: open networks, no lock-in, and people keep their own audience.

Open Media already has structured product and service listings (ADR 0013, phase 3) with prices in minor units, INR support and payments. Joining ONDC as a **seller app** (a Beckn Provider Platform, or BPP) lets Open Media sellers in India appear in every ONDC buyer app. Joining as a **buyer app** would let Open Media users shop the whole network.

Constraints, taken from ONDC's developer docs (2026-10-25):

- Every participant is listed in the ONDC registry under a `subscriber_id`, which must be a domain the participant controls with a valid TLS certificate. Pre-production and production access require whitelisting through portal.ondc.org, and the staging environment has been retired.
- Every request and callback is signed with Ed25519 over a BLAKE2b-512 digest of the body (`Authorization: Signature keyId="{subscriber_id}|{unique_key_id}|ed25519",…`). The receiver checks the signature against the sender's key in the registry; the gateway adds `X-Gateway-Authorization`.
- During registration, the registry fetches `/ondc-site-verification.html` (the signed `request_id`) and calls `/on_subscribe` with a challenge encrypted using AES-256-ECB. The key is the X25519 shared secret between the participant's key and ONDC's.
- APIs are asynchronous. `search` is answered with a synchronous ACK, and the catalog follows as a signed `on_search` POST to the buyer app's `bap_uri`.
- Retail catalogs need more than an Open Media listing: a store with an address, GPS and pincode, consumer-care contact, time to ship, return and cancellation terms, and statutory packaging details.

## Decision

1. **Seller app first (phase 1).** Open Media registers as a seller app (`ops_no: 2`) for ONDC retail, core version 1.2.0. It supports the non-food categories that need no licence number: fashion (`ONDC:RET12`), beauty and personal care (`RET13`), electronics (`RET14`), appliances (`RET15`) and home and kitchen (`RET16`). Grocery and food (`RET10`, `RET11`) need FSSAI details and health products need extra regulatory data, so they stay out until the store form collects them.
2. **Sellers opt in with an ONDC store** (`ondc_stores`, one per person). The store holds the details the catalog needs that a listing does not: store name, category, address, pincode, city STD code, GPS, phone and email (shown to ONDC buyers as consumer care), time to ship, and return and cancellation terms. The seller also confirms a declaration that they are responsible for their items and that the address and packer details are accurate. The store is off until the seller turns it on. Only their public **product** listings priced in **INR** and not sold out are offered. Services stay off ONDC for now, because the services domains use a different item model.
3. **Protocol in the Worker** (`services/mail-sync/src/ondc/`):
   - signing and verification, checked against ONDC's published test vector;
   - a registry lookup with a one-hour cache;
   - `/ondc-site-verification.html` and `/ondc/on_subscribe`;
   - BPP endpoints under `/ondc` (`bpp_uri = {origin}/ondc`).
   `search` and `select` are answered: the catalog for the buyer's city, filtered by the item name when one is given, and a quote with availability and the delivery charge. Every other action (`init`, `confirm`, `status`, `cancel`, `track`, `update`, `rating`, `support`) gets a synchronous NACK with error `40001` (feature not supported). That way no buyer app can place an order Open Media cannot fulfil. Unsigned or wrongly signed requests get `10001` and are never processed.
4. **Data access.** The catalog and quote functions are `security definer` and granted to `service_role` only. The Worker calls them with `SUPABASE_SECRET_KEY`. A store's phone, email and address are therefore readable only by the store owner and, as consumer care, by ONDC buyers.
5. **Configuration through secrets, off by default.** The Worker reads these: `ONDC_SUBSCRIBER_ID`, `ONDC_UNIQUE_KEY_ID`, `ONDC_SIGNING_PRIVATE_KEY`, `ONDC_ENCRYPTION_PRIVATE_KEY`, `ONDC_REQUEST_ID` and `ONDC_ENVIRONMENT` (`preprod` or `prod`). Without them, `/ondc` reports `configured: false` and protocol calls get a NACK. `npm run ondc:keys` creates the key pairs and `npm run ondc:subscribe` prints the registry `/subscribe` payload. Both print to the terminal and write nothing.
6. **Agents.** Store settings are part of the account API (`GET`/`PUT /v1/me/ondc`), so the app, agents and the CLI share one path. `GET /ondc` is public and describes the participant.

### Later phases (not built)

- **Phase 2, orders:**
  - `init`, `confirm`, `status`, `cancel` and `on_status`, with the buyer app collecting payment (the ONDC default);
  - settlement through ONDC's reconciliation and settlement framework;
  - an order inbox for sellers, and logistics through an ONDC logistics provider.
  The ONDC certification flows (the log validation utility) must pass before the production listing.
- **Phase 3, buyer app:** Open Media search also queries the ONDC gateway, collecting the `on_search` callbacks briefly. Open Media then registers as buyer and seller (`ops_no: 4`).

## Consequences

- Sellers in India can prepare an ONDC store today. Their products reach buyer apps once the owner registers Open Media in pre-production and production. Until then the endpoints are real but nothing on the network calls them.
- **Owner steps:**
  1. Put the API on a custom domain. ONDC's `subscriber_id` must be a domain the participant controls, not a shared `workers.dev` host.
  2. Register on portal.ondc.org and request pre-production access.
  3. Set the secrets.
  4. Submit `/subscribe`.
  5. Sign the ONDC Network Participant Agreement.
  6. Become an Indian entity with GST registration where the network requires it.
- Without orders (phase 1) a buyer app can show Open Media items and quotes, but cannot complete a purchase. This is stated on the store screen, at `/ondc` and in the docs.

---
name: open-media-payments
description: "Pay for an Open Media listing, tip a creator or unlock a paid post, safely: preview who is paid and every fee, get the person’s explicit confirmation of the exact amount, then hand them a Stripe checkout link or a USDC transfer for their own wallet. Use when a person wants to buy, tip or unlock something on Open Media."
---

# Paying on Open Media

Open Media never holds money. Cards go through Stripe straight to the seller's Stripe account; USDC goes from the person's own wallet straight to the seller's wallet on Base. Today the server runs in test mode (Stripe test cards and Base Sepolia) unless its payment setup says otherwise.

## When to use this skill

- "Buy that desk", "tip this creator $5", "unlock this post".

## Steps

1. Call `get_payment_options` on `https://api.openmedia.site/me/mcp` with the post id and contextType (listing, tip or paid_post).
2. Call `start_payment` without `confirm`. It starts nothing and returns a preview: the recipient, the amount and every fee.
3. Show that preview to the person in plain words. For a tip, ask them for the amount; never choose it.
4. Only if they agree, call `start_payment` again with `confirm: true` and `expectedAmountMinor` set to the previewed amount.
5. Card: give the person the `checkoutUrl` to open themselves. USDC: give them the transfer for their own wallet, then pass the transaction hash to `submit_payment_transaction`.
6. A payment is paid only when `get_payment` says `confirmed`. Never tell the person it is paid before that.

## Never

- Never ask for card numbers, bank details, seed phrases or private keys.
- Never link a wallet for the person; that needs their own signature in the app.

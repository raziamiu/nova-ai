---
description: Sweep abandoned carts and send (or prepare) personalized recovery messages. Use on the recovery schedule or whenever the owner mentions abandoned carts.
---

# Abandoned cart recovery procedure

1. `get_abandoned_carts` with `state: "none"` — these are untouched. Also check
   `state: "message_sent"`: carts older than 72h with no recovery are lost
   causes — leave them; do not send twice.
2. `recall` namespace `brand` and `rules` — the message voice and discount rules.
3. For each untouched cart, look at the customer (`get_customers` /
   `get_orders` if needed) and write a personal message:
   - Reference the actual items by name.
   - Repeat customers: warm, familiar tone; mention their history naturally.
   - VIPs: offer free expedited shipping (standing owner preference).
   - New customers: reassure — shipping times, returns, quality.
   - Discounts are a last resort, not a default: only for carts over $80, only
     up to 10% (`create_discount`, targeted to that customer), and never
     stacked with other active codes.
4. Send each via `send_customer_message` with `purpose: "cart_recovery"` and
   `relatedId` set to the cart id (this marks the cart as contacted).
   At autonomy ≤ 2 these come back `prepared` — that is fine; report them as
   ready to send.
5. Close with one consolidated summary: carts contacted, total value,
   expected recoveries at the ~25% industry rate, and any prepared items
   awaiting approval with actionIds. One summary — never a message-by-message
   narration.

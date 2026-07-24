# Module 05 — Selling & Conversion: product answers → chat orders → payment claims

**Phase:** 16 "Front Office" · **Depends on:** 02 (reply pipeline), 03 (identity/360), 08 (guardrail keys + tiers) · **Feeds:** 04, 06, 07, 09
**Repos touched:** dakio-api | nova-ai | dakio-merchant (orders-list ByNovaChip)
**Founder requirements covered:** #7, #8, #9, #11 (bounds half — the authority encoding lives in 08), #12, #17 (recovery flow)

This module is the commerce spine of the Front Office: it turns a Messenger/IG conversation into
grounded product answers, a real COD order, a bounded coupon, a Finance verification card, or an
in-window cart-recovery nudge — all through the one action pipeline. It ships the two
highest-blast-radius pieces of Stage 10: the `orderCreate.js` extraction and the
`create_order_from_chat` verb.

---

## Already real vs to build

| Already real (recon, file:line) | This module adds |
|---|---|
| Nova product read `GET /api/v1/store/products` + `/:id`, stock summed across inventory, id-or-sku lookup (novaStore.js:168-185) — but it maps `sellingPrice`→`price` only, **no variants array** (novaStore.js:153; nothing reads `ProductVariant`) | `variants[{id, name, price, stock}]` added to `GET /products/:id` so "XL hobe?" is answerable honestly |
| Merchant order path with every invariant: BD phone regex (orders.js:89-92), PUBLISHED + `purchasePrice>0` (orders.js:675-686), `unitPrice == sellingPrice ±1` server-overwrite (orders.js:688-694), server-authoritative shipping dhaka/outside (orders.js:730-735; tenant defaults schema.prisma:52-53), fake-order 24h phone guard (orders.js:588-607; `checkFakeOrder` src/lib/fakeOrderProtection.js:28), plan gates (orders.js:556-586), unique `#ABC-DEFG` order number (orders.js:644-657), `emitOrderCreated` in-tx (orders.js:794-808) | Extraction of that core into `src/lib/orderCreate.js`, called by both `routes/orders.js` and the new `POST /api/v1/store/orders` |
| Storefront coupon machinery: pre-tx validation (store.js:531-554), atomic `usedCount` increment with in-tx re-check (store.js:694-707); known gap — `minOrder` NOT re-checked at apply time (store.js:537-554); merchant `POST /api/orders` has no couponCode at all (orders.js:532) | Coupon block ported into `orderCreate.js` with the `minOrder` re-check closed; `couponCode` accepted on the chat path |
| **No Nova order create** — `/api/v1/store` has GET/PATCH orders only (novaStore.js:302-350, "No POST /orders — Nova cannot CREATE an order today") | `POST /api/v1/store/orders` (service token, `w()` idempotent) |
| Lead auto-conversion on order: storefront converts OPEN leads by phone (store.js:876-881); merchant path converts by `leadId` (orders.js:969-984); Customer find-or-create by tenant+phone (store.js:556-569, orders.js:609-642) | `orderCreate.js` preserves both; chat orders also auto-link the conversation (`InboxConversation.customerId`) + write the `CustomerChannel` row — the order is the verified identity join moment |
| `Coupon` model already supports `type FIXED\|PERCENT` + `novaActionId` attribution column (schema.prisma:875-895, novaActionId 889-891); Nova create is **PERCENT-only** (novaStore.js:470-490); toggle exists (novaStore.js:492-499) | `POST /discounts` gains FIXED type + `novaActionId` stamp + `minOrder`/`maxUses`; new `POST /discounts/validate`; `offer_chat_discount` verb with deactivate inverse |
| `maxDiscountPct` guardrail live and enforced today, seeded default 20 (nova-ai agent/lib/nova/autonomy.ts:35, enforcement authority.ts:374-380, bn+en explanations) — 20 is the live nova-ai seed; 15 is the proposed inbox-specific ceiling pending founder decision OQ-5, and the `inbox.maxDiscountPct` guardrail reads the seed until OQ-5 resolves | The inbox branch on top: `inbox.discountAuto` + `inbox.discountPerCustomerDays` (fail-closed) |
| Abandoned-cart projection `GET /carts` over StorefrontLead; `recoveryState` maps to lead `status` via `CART_STATUS_FROM_NOVA` (novaStore.js:422-438); **`recoveryMessage` accepted and dropped** (novaStore.js:407, 428-430); `emitCartAbandoned` event exists (store.js:1198) | `StorefrontLead.recoveryMessage` column persisted; `cart_sweep` conversation-match branch; in-window nudge flow |
| Phone discipline: `normalizePhone`/`phoneVariants` (customerRisk.js:7-24); `calculateCustomerRisk` NEW/RISK/POSITIVE/MEDIUM (customerRisk.js:36-45, 69-127) | `GET /api/v1/store/customers/risk` read + mandatory server re-run inside the order executor path |
| Tenant delivery config on Tenant (schema.prisma:52-53); **no returnPolicy/policy field exists on Tenant** (verified in CAP-14 recon); no Nova read exposes settings | `GET /api/v1/store/settings` + new `TenantPolicy` model (merchant-authored snippets Nova may quote) |
| Humanized public tracking (publicTracking.js:93-172) and `/api/public/tracking/:slug/:code` link | `orderOut.trackingUrl` in the create response so the confirmation reply carries a real link |
| **OUT — payment verification**: no bKash/Nagad API anywhere in dakio-api; inbound attachments are lossy (first URL only, type discarded, meta.js:495,508). | `verify_payment_slip` is **claim intake only**; marking paid is founder-only forever (canonical §2.3) |
| **OUT — product photo sends**: send path is text-only (meta.js:750-751) even though `Product.images` exists (schema.prisma:332) | v1 sends storefront links; outbound attachments are v2 (canonical C-13) |
| **OUT — out-of-window recovery**: no MESSAGE_TAG support in the send path (meta.js:750-770) | Closed-window nudges become `skipped_window` receipts, never sends (canonical rule 6) |

---

## Objective

After this module ships, a founder's Nova can — inside a live Messenger/IG thread — quote price,
stock, and variants from real catalog data; take a complete COD order end-to-end (draft at
T0/T1, auto at T2+ under caps) with the order number and tracking link delivered in-thread;
haggle inside coupon-only bounds; log a bKash/Nagad payment claim into a Finance verification
Decision; and send one in-window cart-recovery nudge naming the actual cart items. Every order
carries `novaActionId` + `sourceConversationId` and shows a BY NOVA chip on the merchant orders
list. Testable: the Gate's scripted conversation produces a real Order row whose every field
traces to ledger receipts.

## Scope

**In:** variants-aware product Q&A; grounded FAQ/policy answers + policy-gap round-trip;
`orderCreate.js` extraction + `POST /api/v1/store/orders`; `create_order_from_chat`,
`offer_chat_discount`, `verify_payment_slip` verbs (full checklist, both repos); Order
attribution columns; discount FIXED type + validate route; `payment.claim_rejected` event
producer; in-window cart/checkout recovery (`cart_sweep` conversation match, `recoveryMessage`
persistence); OOS→`restock_wait` hand-off; wholesale escalation; orders-list ByNovaChip.

**Out (named owners):** reply/timing/persona mechanics and `send_inbox_reply` registration → 02;
identity linking, customer-360 block, promises → 03; NBA candidate selection, follow-up jobs,
journey stages, quiet-hours/touch-cap enforcement → 04; `restock_wait`/`payment_unverified` case
machinery, `confirm_order_intent`, address changes, cancel intake → 06; returns, complaints,
review asks, repeat-purchase flows → 07; escalation transaction, holding lines H1–H6, T0–T3 dial
encoding → 08; MINUTES table ownership, nightly estimated→measured flip, metric registry → 09;
fraud vocabulary, `check_customer_risk` tool semantics, assessment schema → 11. v2+: outbound
photos, MESSAGE_TAG late recovery, payment-slip OCR, `wholesale_inquiry` case kind, quick-reply
chips, payment links, partial payments.

Payment links — OUT (v2): Dakio has no payment-link generation; arrives with an online-payment
provider integration.
Partial payments — OUT (v2): Order carries no partial-payment model; requires a payments ledger
extension.

---

## Design

### D1 — Product Q&A is tool-grounded, variants-aware, and never leaks raw counts

The selling conversation starts with `get_products` / `get_product` (StoreClient →
`GET /api/v1/store/products(/:id)`). This module fixes the one gap that makes honest answers
impossible today: `GET /products/:id` gains `variants: [{id, name, price, stock}]` read from
`ProductVariant` (price falls back to the product's `sellingPrice` when the variant has none).
Behavior rules, enforced by instruction text in `agent/skills/inbox-conversations.md` and the
grounding evals (module 12):

1. **Resolution first.** Name/SKU fuzzy match against the catalog read. IG product shares arrive
   lossy (first URL only, type discarded), so ambiguity ⇒ one clarifying question, never a guess.
2. **Availability is three-valued** — in stock / low / out — **never a raw count** (competitive
   info). "Low" = stock ≤ 3 across inventory (server does not expose the number; the read adds
   `availability: 'in' | 'low' | 'out'` per product and per variant so the model never sees
   integers it could parrot).
3. **OOS ⇒ 1–2 in-stock alternatives from the same category**, honest that the asked item is out:
   > এই মুহূর্তে XL টা স্টকে নেই 😔 তবে L আর XXL দুটোই আছে — সাইজ চার্ট দেখে বলবেন কোনটা নিবেন?
   > *(Ei muhurte XL ta stock e nei — tobe L ar XXL dutoi ache. Size chart dekhe bolben konta niben?)*
   If the customer insists on the OOS item → D9.
4. **One soft upsell maximum**, only after the primary question is answered. Repeated upsells are
   a bot tell and a trust cost.
5. **Photos: storefront links only in v1** (canonical C-13). The reply carries the product's
   public storefront URL; the send path stays text-only.

Every answer is a `send_inbox_reply` with intent `price_query` / `product_question` /
`availability_check` (department **sales** via `DEPARTMENT_BY_INTENT`) — all three sit in the
default `inbox.autoIntents` allowlist, so they auto-send from T1 up (canonical §2.11).

### D2 — Policy/FAQ answers come from config, or they don't come at all

New read `GET /api/v1/store/settings` (service token) returns
`{storeName, storefrontUrl, deliveryInsideDhakaMinor, deliveryOutsideDhakaMinor, codAvailable: true, policies: [{key, textBn, textEn}]}`.
Delivery charges come straight from the Tenant columns; `policies` come from the new
`TenantPolicy` model (Data model) — merchant-authored snippets keyed `return_policy`,
`warranty`, `delivery_time`, `advance_payment`, plus free-form keys.

The rule Nova follows (instruction-level, eval-pinned): **never invent policy.** A question with
no configured answer gets:

> শপ ওনারের থেকে কনফার্ম করে জানাচ্ছি আপনাকে — ভুল বলতে চাই না 🙂
> *(Shop owner er theke confirm kore janachchi — bhul bolte chai na.)*

plus an `escalate_conversation {department:'support'}` whose brief names the missing policy key.
When the founder answers, the hand-back flow (08) offers the answer as a saved `TenantPolicy`
row — the gap closes permanently and `inbox.policy_gaps_surfaced` counts it (09 registry).

### D3 — `orderCreate.js`: one extraction, two callers, zero behavior change

Nova cannot create orders today. Rather than untangle `executeCheckout` (storefront-coupled,
non-exported, store.js:439-884), we extract the **merchant** path's core (orders.js:530-1018 —
already server-authoritative and simpler) into `src/lib/orderCreate.js` and have both
`routes/orders.js` and the new endpoint call it. **This is the highest-blast-radius change in
Phase 16**: the merchant path processes every manual order in production. Discipline:

- Behavior-identical refactor. The existing `test/orders.*` suites are the safety net, plus a new
  **parity suite** (`src/lib/orderCreate.parity.test.js`): same inputs through the route and
  through the lib produce byte-identical orders (number format aside).
- Invariants preserved verbatim inside the lib: BD phone regex, city+district required, PUBLISHED
  product with `purchasePrice>0` (non-dropship), `unitPrice` forced to DB `sellingPrice` (any
  incoming price ignored — Nova can never set a price), server shipping
  (`district==='dhaka'` → `tenant.deliveryInsideDhaka` else `deliveryOutsideDhaka`), fake-order
  guard, plan gates (free daily cap, no dropship), atomic dropship reservation, merchant-stock
  check + decrement, unique order number, lead conversion, `emitOrderCreated` in-tx.
- Two additions inside the lib, both additive: the coupon block (ported from executeCheckout with
  the `minOrder` re-check closed) and optional attribution params
  `{novaActionId, sourceConversationId, sourceChannel}` stamped onto the Order.

### D4 — `POST /api/v1/store/orders` (novaStore.js, service token, `w()` required)

```
POST /api/v1/store/orders          Idempotency-Key: <novaActionId>
{ customerName, customerPhone, customerCity, customerDistrict, customerAddress?,
  items: [{productId, variantId?, qty}], note?, couponCode?,
  sourceConversationId, novaActionId }
→ 201 { id, orderNumber, total, shippingCharge, codAmount, status,
        customerId, trackingUrl }        // trackingUrl = /api/public/tracking/:slug/:code
→ 400 { code: 'FAKE_ORDER_BLOCKED' | 'OUT_OF_STOCK' | 'PLAN_LIMIT' | 'INVALID_PHONE' | … }
→ 422 coupon invalid (expired / maxUses / minOrder)
```

Server behavior beyond the lib call:

1. Stamps `Order.novaActionId`, `sourceConversationId` (plain string, no FK),
   `sourceChannel:'inbox_nova'`, `paymentMethod:'COD'`.
2. **Re-runs the risk pair server-side** regardless of what the agent believed:
   `checkFakeOrder` + `calculateCustomerRisk` (canonical §2.3). The agent's guardrail branch is
   advice; this check is authority.
3. **Identity join**: after creation, sets `InboxConversation.customerId` (source
   `'order_created'`) and upserts
   `CustomerChannel {kind:'messenger'|'instagram', address, customerId, consent:'transactional'}`
   — an in-thread order is the strongest verified join (module 03 owns the graph semantics; this
   route is one of its writers).
4. Coupon: full re-validation (isActive, expiry, maxUses, **minOrder**) + atomic `usedCount`
   increment in-tx.
5. `w()` replay: a retried executor gets the cached 201 — one order, ever, per novaActionId.

### D5 — `create_order_from_chat`: the slot-filling script and the verb

**Verb registration (canonical §2.3 — the ruling: risk `low` + fail-closed guardrail branch, NOT
`medium`):**

| Property | Value |
|---|---|
| riskClass | `low` (C-2: `medium` would pin chat orders to draft until store-wide L4, coupling the inbox dial to the whole store) |
| MINUTES_BY_ACTION | 12 |
| undoable | yes — inverse `cancel_chat_order` (PENDING only) |
| department | **sales, always** (regardless of opening intent) |
| TARGET_TEXT | item names + qty + district (Bangla NFC-normalized — a no-touch product lock genuinely blocks orders for that product) |
| dutyRef | `sales.inbox_orders` (minLevel 2, Inbox door) |
| executor | `POST /api/v1/store/orders` (nova-ai executors.ts + dakio-api `EXECUTORS.create_order_from_chat` so founder approval actually runs); `UNDO.cancel_chat_order` |

Payload schema (`agent/lib/nova/schemas.ts`):

```ts
createOrderFromChatPayload {
  conversationId, customerName, customerPhone, customerCity, customerDistrict,
  customerAddress?, items: [{productId, variantId?, qty}], couponCode?,
  confirmedByCustomer: true          // zod literal true — the tool CANNOT be called
}                                    // without asserting explicit customer confirmation
```

**Guardrail branch** (`checkGuardrails`, every clause fail-closed — a missing key reads `false`):

```
confirmedByCustomer !== true               → schema-invalid (never reaches authority)
inbox.orderAuto !== true                   → needs_approval  guardrail:inbox_order_auto_off
total > inbox.maxAutoOrderMinor (৳5,000)   → needs_approval  guardrail:inbox_order_over_cap
customer rtoCount ≥ inbox.rtoShadowThreshold (2)
  or address/phone not stated in-thread    → needs_approval  guardrail:inbox_order_needs_review
non-COD payment implied                    → needs_approval  (COD is the only auto path)
else                                       → allow (executes at T2+)
```

At T0/T1 every chat order therefore lands as a Decision card ("Rina wants 2× Hijab Set to
Mirpur — ৳1,780 COD — approve?"); T2 (`inbox.orderAuto:true`) auto-executes inside the caps. An
`rtoCount ≥ 2` customer drafts at **every** tier, with the brief's paramsLine flagging it
("৩ বার পার্সেল রিসিভ করেননি").

**The slot-filling script** (skill text; one question at a time, never a form-dump):

1. Items + qty from thread context, or ask. Then **name → phone → address → city → district**
   (district drives server shipping). Validate phone conversationally; a bad number gets one
   gentle retry, not an error message.
2. **Read-back confirmation** — itemized, total, COD, explicit yes required:
   > তাহলে কনফার্ম করছি — ২টা হিজাব সেট (কালো), ডেলিভারি: মিরপুর, ঢাকা। প্রোডাক্ট ৳১,৭২০ +
   > ডেলিভারি ৳৬০ = মোট **৳১,৭৮০**, ক্যাশ অন ডেলিভারি। সব ঠিক আছে? 🙂
   > *(Tahole confirm korchi — 2ta Hijab Set (kalo), delivery Mirpur, Dhaka. Product ৳1,720 +
   > delivery ৳60 = mot ৳1,780, cash on delivery. Sob thik ache?)*
   Only an explicit affirmative ("হ্যাঁ", "ji", "ok", "hmm den") permits the tool call —
   `confirmedByCustomer: true` asserts exactly this, and the confirming message id rides the
   receipt as evidence.
3. On success, reply with the real order number + tracking link + COD amount:
   > অর্ডার হয়ে গেছে ✅ অর্ডার নম্বর **#KQ3-8FZM**। ডেলিভারির সময় ৳১,৭৮০ রেডি রাখবেন প্লিজ।
   > ট্র্যাক করতে পারবেন এখানে: {trackingUrl}
   > *(Order hoye geche ✅ — order number #KQ3-8FZM. Deliverir somoy ৳1,780 ready rakhben.
   > Track korte parben ekhane: {trackingUrl})*
4. **Honest rejection handling** — never fake success:
   - `OUT_OF_STOCK` mid-flow → honest line + D1 alternatives.
   - `FAKE_ORDER_BLOCKED` → **never accuse.** Customer hears
     "শপ ওনার একটু পরেই কনফার্ম করবেন 🙂" *(Shop owner ektu porei confirm korben)*; Nova quietly
     escalates (`escalate_conversation`, reason `guardrail_blocked`) with the block reason in the
     founder brief only.
   - `PLAN_LIMIT` → same quiet-escalation pattern; the customer never hears about billing plans.
5. Revenue honesty: the executor records `revenueInfluence: order.total` with basis
   **estimated**; the nightly attribution pass (09) flips it to measured on DELIVERED and zeroes
   it on RTO. A booked COD order is not earned revenue in Bangladesh.

Flow, end to end:

```
customer: "eta 2 ta niben, Mirpur"        (Messenger)
   │ 02: session turn — get_product (variants, availability)
   ▼
slot-filling: name → phone → address → city → district → read-back
   │ explicit "হ্যাঁ"
   ▼
create_order_from_chat {confirmedByCustomer:true}
   │ performAction → evaluateAuthority (door:inbox)
   ├─ T0/T1 or any cap trip → prepared NovaAction + NovaDecision  → founder taps approve
   │                                                                  │
   ▼                                                                  ▼
executor: POST /api/v1/store/orders  (w: novaActionId) ◄──────────────┘
   │ orderCreate.js: invariants, coupon re-validate, fake-order+risk re-run,
   │ stamps novaActionId/sourceConversationId/sourceChannel, emitOrderCreated in-tx
   ▼
201 → identity join (conversationId→customerId, CustomerChannel row)
   → reply: order number + trackingUrl + COD  (send_inbox_reply, sales)
   → NovaAction/NovaActivity {department:'sales', minutesSaved:12, revenue estimated}
   → order.created event → journey reducer (04) → confirmation ping machinery (06)
```

### D6 — Negotiation & discounting: decline first, coupon only, bounded always

Haggling is expected in BD DM commerce; folding on message one loses margin *and* reads as a bot.
The script (skill text, eval-pinned):

1. **First ask → polite decline with value framing** — no coupon:
   > দামটা আসলে ফিক্সড — কোয়ালিটিটা হাতে পেলে বুঝবেন কেন 🙂 ক্যাশ অন ডেলিভারি তো আছেই — দেখে
   > তারপর টাকা দিবেন।
   > *(Dam ta asole fixed — quality ta hate pele bujhben keno. COD to achei — dekhe tarpor taka
   > diben.)*
2. **Second ask, or a high-value cart** → offer inside bounds. The preferred BD move is the
   **free-delivery-equivalent**: a FIXED coupon equal to the quoted shipping charge:
   > আচ্ছা, আপনার জন্য ডেলিভারি চার্জটা ফ্রি করে দিচ্ছি 🙂 অর্ডারের সময় আমি অ্যাপ্লাই করে দিবো।
   > *(Achchha, apnar jonno delivery charge ta free kore dichchi — order er somoy ami apply kore
   > dibo.)*
3. **Mechanism: coupon only, never a price change.** The server enforces
   `unitPrice == sellingPrice ±1` (orders.js:688-694); the only honest way to sell below list is
   a Coupon row, which carries `novaActionId` attribution. Price modification is blocked at every
   tier, permanently (canonical §2.3).
4. **Never stack coupons.** One live Nova coupon per customer per `inbox.discountPerCustomerDays`
   (default 30); default expiry 48h; default `maxUses: 1`.
5. **Beyond bounds** ("half dam e den") → honest no; if the cart is worth the founder's call, the
   existing `guardrail:max_discount_pct` refusal escalates with the H6 price holding line (08)
   and the recommended counter-offer + margin math in the brief.

**Verb registration:**

| Property | Value |
|---|---|
| Verb | `offer_chat_discount` — riskClass `low`, MINUTES 10, undoable **yes** (deactivate coupon via `PATCH /discounts/:id`), department sales, dutyRef `sales.inbox_discounts` (minLevel 2) |
| Payload | `{conversationId, customerId?, mechanism:'percent'\|'fixed'\|'free_delivery', pct? \| amountMinor?, expiresHours: 48, reason}` |
| TARGET_TEXT | product/customer target + amount |
| Guardrail branch | `inbox.discountAuto !== true` → needs_approval `guardrail:inbox_discount_auto_off`; pct > existing `maxDiscountPct` → the existing refusal path (blocked→escalate); prior Nova coupon for this customer within `inbox.discountPerCustomerDays` → needs_approval `guardrail:inbox_discount_frequency` |
| Executor | `POST /api/v1/store/discounts` `{code, type:'FIXED'\|'PERCENT', amount, expiresAt, minOrder?, maxUses:1, novaActionId}`; `free_delivery` resolves `amount` server-side to the district-appropriate shipping charge |

Frequency enforcement is **server-side and authoritative**: the discounts route queries the
NovaAction ledger for a prior executed `offer_chat_discount` matching this customer inside the
window and 409s (`guardrail:inbox_discount_frequency`) → receipted blocked row. The agent-side
branch is the polite first line of defense; the customer-360 block (03) surfaces a
recent-coupon line so the model rarely attempts it.

At T0–T2 every discount drafts; only T3 (`inbox.discountAuto:true`) auto-issues inside bounds.
The proud metric is `negotiations_held_at_list_price` — sales closed WITHOUT a coupon (09).

### D7 — Payment assistance: claim intake, never verification

BD reality: customers send bKash/Nagad screenshots claiming advance payment. Dakio has **no
payment-gateway API and lossy attachments**, so v1 makes no OCR claim and never touches
`Order.paid`. The honest capability (canonical C-30: the verb is `verify_payment_slip`, its spec
is claim intake):

| Property | Value |
|---|---|
| Verb | `verify_payment_slip` — riskClass **high** (always drafts, at every tier, forever), MINUTES 4, not undoable, department **finance** |
| Payload | `{conversationId, orderId?, method:'bkash'\|'nagad'\|'other', trxId?, claimedAmountMinor?, attachmentUrl?}` |
| dakio-api side | `ADVISORY` set — founder approval = acknowledged, never a fabricated verification |

Flow:

1. Trigger: intent `payment_claim` — "bKash e pathaisi, TrxID 8AK3XXXXXX" (+ screenshot, which
   may arrive as an attachment-only message with `text:null`). TrxID captured by regex
   (`/\b[A-Z0-9]{10}\b/` in payment context), claimed amount if stated, `attachmentUrl` if any.
2. `verify_payment_slip` → prepared NovaAction + `NovaDecision {tag:'finance'}`:
   "Customer claims ৳2,350 via bKash — verify slip" with trxId, amount, slip link, matched order
   facts in evidence.
3. Reply is honest — received, checking, no confirmation:
   > স্ক্রিনশট পেয়েছি! ভেরিফাই করে একটু পরেই কনফার্ম করছি 🙂
   > *(Screenshot peyechi! Verify kore ektu porei confirm korchi.)*
   **Never** "payment received", never "টাকা পাইনি" (accusation). Nova neither confirms nor
   denies money movement it hasn't read from a ledger this turn.
4. The turn also opens the waiting-customer coordination
   (`open_case {kind:'payment_unverified'}` + a 4h follow-up) — that machinery and the
   loop-closing "পেমেন্ট কনফার্মড ✅" reply are module 06 §5.1's; this module owns the intake verb
   and the honest reply.
5. **`payment.claim_rejected` producer (this module):** when the founder **rejects** the
   verification Decision, the dakio-api decision-reject path (novaDashboard reject executor)
   gains a hook: action type `verify_payment_slip` ⇒ emit NovaInbox
   `payment.claim_rejected {conversationId, actionId}`, dedupeKey `claim_rejected:<actionId>`
   (canonical §2.7). Module 04's trigger map turns that into the gentle
   "TrxID টা আরেকবার চেক করে দিবেন?" follow-up card.
6. Founder verifies in their own bKash app and marks paid via existing merchant flows.
   **Mark-paid is blocked for Nova at every tier, permanently** — money truth requires a source
   Dakio doesn't have.

### D8 — In-window cart & checkout recovery

The flagship "recovery messages for abandoned carts" finally gets a real send channel — but only
inside Meta's 24h window, and only through the gate.

1. **Detection**: the existing `cart_sweep` job gains a conversation-match branch: for each OPEN
   StorefrontLead, `normalizePhone(lead.phone)` → `phoneVariants` → a conversation via
   `InboxConversation.claimedPhone` / linked `customerId` / `StorefrontLead.conversationId`
   (column added by module 03). Match + `windowExpiresAt > now` + `handledBy` nova-eligible ⇒
   nudge candidate. No match or closed window ⇒ **`skipped_window` receipt** — never marked sent,
   never queued to a channel that doesn't exist.
2. **Fire-time re-check is mandatory** (canonical C-28): window, quiet hours, weekly touch cap,
   unanswered-proactive streak, thread state — all re-checked at send time, not schedule time
   (enforcement machinery in 04; this flow calls it).
3. **The nudge** is `send_inbox_reply` with intent `cart_recovery` — one personal message
   grounded in `cartSnapshot`, naming the actual items, never a campaign blast:
   > আপু, জামদানি শাড়িটা কার্টে রেখে গিয়েছিলেন 🙂 এখনো আছে — নিয়ে নিবেন? সাইজ বা ডেলিভারি নিয়ে
   > কোনো প্রশ্ন থাকলে বলুন।
   > *(Apu, Jamdani sharee ta cart e rekhe giyechhilen — ekhono ache. Niye niben? Size ba
   > delivery niye kono proshno thakle bolun.)*
   `cart_recovery` is **not** in the default `inbox.autoIntents` list (canonical §2.11), so
   nudges draft by default; a tenant opts in by adding the intent to the allowlist. Optional
   sweetener strictly through D6 bounds (free-delivery-equivalent converts best against BD
   delivery-charge objections).
4. **Writeback**: `PATCH /api/v1/store/carts/:id` sets `recoveryState:'message_sent'` and now
   **persists `recoveryMessage`** (new column) so the Sales room can show what was said. Customer
   bites → D5 order seeded from `cartSnapshot`; lead auto-converts via the orderCreate lead
   logic; recoveryState → `'recovered'`.
5. Checkout stalls *inside chat* (slot-filling abandoned) are journey territory — module 04's
   trigger #12 schedules the follow-up; the copy contract is the same: name the actual product,
   answer the likely objection, never generic.

### D9 — OOS-but-wanted: the honest hand-off to Inventory

D1 answered "out", offered alternatives; the customer says "na, oitai lagbe". This module's
responsibility ends at three moves: (a) an honest reply that makes only a ping promise —
> এটা স্টকে আসা মাত্রই আপনাকে সবার আগে জানাবো 🙂
> *(Eta stock e asha matroi apnake sobar age janabo.)*
— never a dated ETA unless one exists on a real purchase order; (b)
`open_case {kind:'restock_wait', productId}` (verb + case machinery + `restock_check` job +
honest-ETA fork are module 06 §5.2); (c) the asked product id lands in the journey's
`askedProductIds` (04) so the restock trigger can find the customer. One-ping coordination
(case suppresses the generic restock ping) is test-pinned in 06.

### D10 — Wholesale/bulk inquiry: escalate the big fish, don't fumble it

"100 piece nile rate koto porbe?" — Nova must neither invent wholesale pricing nor lose the
lead. **v1 = escalation, not case machinery**: inline
`escalate_conversation {department:'sales'}` with the retail math pre-done in the brief
("100 × ৳1,840 = ৳184,000 at retail"), customer history, and
`NovaDecision {kind:'escalation', tag:'sales', priority:1, impactLabel:'৳184,000 inquiry'}` —
the impactLabel makes it unmissable on the Desk. Customer hears the H6 price holding line (08).
`wholesale_inquiry` as a case kind is v2.

---

## Data model

```prisma
model Order {
  // ...existing fields (schema.prisma:502-550)...
  novaActionId          String?   // NEW — by:nova chip on the orders door (ATTRIBUTABLE 'order')
  sourceConversationId  String?   // NEW — plain string, NO FK: Meta data-deletion hard-deletes
                                  //       conversations (meta.js:866-887); orders are financial
                                  //       records and must never cascade or block
  sourceChannel         String?   // NEW — 'inbox_nova' | 'inbox_founder'

  @@index([tenantId, novaActionId])   // NEW — nightly attribution pass + orders-list chip
}

model StorefrontLead {
  // ...existing fields (schema.prisma:755-777)...
  recoveryMessage       String?   // NEW — what Nova actually said; today accepted-and-dropped
                                  //       (novaStore.js:407, 428-430)
  // conversationId String?       // added by module 03's migration — noted here for the
  //                                 cart_sweep match, not duplicated
}

// NEW model — merchant-authored policy snippets Nova may quote (D2). Nova never writes these;
// merchant CRUD only. Not in the canonical new-model registry because it is merchant config,
// not Nova state — additive and independently droppable.
model TenantPolicy {
  id        String   @id @default(cuid())
  tenantId  String
  key       String   // return_policy | warranty | delivery_time | advance_payment | <free-form>
  textBn    String
  textEn    String?
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, key])
}
```

`Coupon` and `ProductVariant` need **zero schema change** (FIXED type and `novaActionId` already
exist, schema.prisma:875-895; variants are a read-shape change only).

**Migration** `nova_front_office_05_selling`: three Order columns (nullable, no backfill — old
orders simply have no attribution), the Order index, `StorefrontLead.recoveryMessage`, the
TenantPolicy table. Meta data-deletion: nothing here cascades — `sourceConversationId` is the
survival mechanism, by design (canonical rule 17). Commit the generated migration (repo P0 rule).

---

## APIs & interfaces

### dakio-api — service surface (`authenticateNovaService + requireTenant`; writes `w()`-idempotent)

| Route | Change | Body → Response |
|---|---|---|
| `POST /api/v1/store/orders` | **new** (novaStore.js, beside the other commerce writes) | D4 shape; Idempotency-Key = novaActionId |
| `GET /api/v1/store/settings` | **new** | → `{storeName, storefrontUrl, deliveryInsideDhakaMinor, deliveryOutsideDhakaMinor, codAvailable, policies[]}` |
| `GET /api/v1/store/products/:id` | changed | response gains `variants[{id,name,price,stock,availability}]` + per-product `availability` |
| `POST /api/v1/store/discounts` | changed | accepts `{code, type:'PERCENT'\|'FIXED', amount, expiresAt?, minOrder?, maxUses?, novaActionId?}`; keeps `percentOff` back-compat; stamps `novaActionId`; enforces `guardrail:inbox_discount_frequency` (409) via NovaAction ledger lookup |
| `POST /api/v1/store/discounts/validate` | **new** | `{code, subtotalMinor}` → `{valid, discountMinor, reason?}` — server-side isActive/expiry/maxUses/**minOrder** semantics (coupons.js:127-164), backing the `validate_coupon` tool |
| `GET /api/v1/store/customers/risk` | **new** | `?phone=` → `{riskLevel, rtoCount, ordersCount, cancelledCount}` via `normalizePhone`+`calculateCustomerRisk`; read-only (fraud vocabulary owned by module 11) |
| `PATCH /api/v1/store/carts/:id` | changed | `recoveryMessage` now persisted; `recoveryState` mapping unchanged (novaStore.js:422-438) |

Also: the decision-**reject** path in `novaDashboard.js` gains the `verify_payment_slip` →
`payment.claim_rejected` NovaInbox emit (dedupeKey `claim_rejected:<actionId>`).

### nova-ai — verbs, tools, skill

Verbs registered per the full checklist (types.ts union, zod schema, RISK_CLASS, TARGET_TEXT,
MINUTES_BY_ACTION, executor + undoer, dutyRef; dakio-api EXECUTORS/ADVISORY/UNDO mirrors):

| Verb | risk | MIN | undo | dept | Gate behavior |
|---|---|---|---|---|---|
| `create_order_from_chat` | low | 12 | cancel while PENDING | sales | fail-closed branch: `inbox.orderAuto` ∧ cap ∧ rtoCount ∧ in-thread confirm (D5) |
| `offer_chat_discount` | low | 10 | deactivate coupon | sales | `inbox.discountAuto` ∧ `maxDiscountPct` ∧ frequency (D6) |
| `verify_payment_slip` | high | 4 | no | finance | always drafts; ADVISORY on dakio-api (D7) |

Tools (`agent/tools/`, `send_customer_message.ts:9-32` pattern — payload schema + receiptSchema +
performAction): `create_order_from_chat.ts`, `offer_chat_discount.ts`, `verify_payment_slip.ts`,
`validate_coupon.ts` (read-only → `/discounts/validate`); `get_products.ts` / `get_product.ts`
gain the variants/availability shape. StoreClient methods: `createChatOrder`, `createDiscount`
(extended), `validateCoupon`, `getStoreSettings`, `getCustomerRisk`, `patchCart` (extended) in
`agent/lib/store/client.ts` + `store/dakio.ts` + demo backend.

Skill `agent/skills/inbox-conversations.md` gains the selling sections: order-capture script
(D5), decline-first negotiation ladder (D6), payment-claim script (D7), cart-nudge copy rules
(D8), OOS/wholesale hand-offs (D9/D10). Duties `sales.inbox_orders`, `sales.inbox_discounts`,
`sales.inbox_cart_recovery` (all minLevel 2) in `agent/lib/duties.ts`.

### dakio-merchant

Orders list: `ByNovaChip` on rows where `Order.novaActionId` is set (existing chip kit; opens
the receipt drawer via `GET /nova/actions/:id`). One additive render change — everything else
this module produces surfaces through existing decision/room/feed plumbing.

---

## Files touched

**dakio-api**
- `prisma/schema.prisma` + migration `nova_front_office_05_selling` — Order columns/index, StorefrontLead.recoveryMessage, TenantPolicy
- `src/lib/orderCreate.js` (new) — extracted merchant-path core + coupon block + attribution params
- `src/routes/orders.js` — `POST /api/orders` handler body delegates to orderCreate.js (behavior-identical)
- `src/routes/novaStore.js` — `POST /orders`, `GET /settings`, variants on `GET /products/:id`, discounts FIXED + validate + frequency guard, carts recoveryMessage, `GET /customers/risk`
- `src/lib/novaExecutors.js` — `EXECUTORS.create_order_from_chat`, `EXECUTORS.offer_chat_discount`, `ADVISORY.verify_payment_slip`, `UNDO.cancel_chat_order` + coupon deactivate
- `src/lib/novaLedger.js` — `ATTRIBUTABLE.order`
- `src/routes/novaDashboard.js` — reject-path `payment.claim_rejected` emit
- `src/routes/settings.js` (or `auth.js` tenant-settings section) — merchant CRUD for TenantPolicy rows
- `package.json` — new test files appended to the explicit `test` list

**nova-ai**
- `agent/lib/types.ts`, `agent/lib/nova/schemas.ts`, `agent/lib/nova/autonomy.ts` (guardrail branches), `agent/lib/nova/authority.ts` (TARGET_TEXT ×3), `agent/lib/nova/activity.ts` (MINUTES ×3), `agent/lib/nova/executors.ts` (+undoers)
- `agent/tools/create_order_from_chat.ts`, `offer_chat_discount.ts`, `verify_payment_slip.ts`, `validate_coupon.ts` (all new); `get_products.ts`/`get_product.ts` (shape)
- `agent/lib/store/client.ts`, `agent/lib/store/dakio.ts`, demo backend — new methods
- `agent/lib/duties.ts` — three sales duties
- `agent/skills/inbox-conversations.md` — selling sections

**dakio-merchant**
- `src/pages/orders/…` list component — ByNovaChip keyed on `novaActionId` (one render change)

---

## Testing

dakio-api (node:test; **every file added to the explicit `package.json` test list** — unlisted
files silently never run):

- `src/lib/orderCreate.parity.test.js` — given identical inputs, when run through
  `POST /api/orders` and through `orderCreate.js` directly, then the resulting Order rows are
  field-identical (customer find-or-create, shipping, totals, stock, lead conversion).
- `src/routes/novaStore.orders.test.js` —
  1. given a valid chat-order body, when POSTed twice with the same Idempotency-Key, then exactly
     one Order exists and the second response replays the cached 201;
  2. given `items[].unitPrice` tampering in the body, when created, then the server price wins;
  3. given a phone with ≥threshold orders in 24h, when created, then 400 `FAKE_ORDER_BLOCKED`
     and no Order row;
  4. given a valid couponCode below `minOrder`, when created, then 422 and `usedCount` unchanged;
  5. given success, then `novaActionId`/`sourceConversationId`/`sourceChannel` are stamped, the
     conversation's `customerId` is set, and a `CustomerChannel` row exists;
  6. given a merchant JWT instead of a service token, then 401 (tenant-isolation suite pattern).
- `src/routes/novaStore.selling.test.js` — settings shape incl. TenantPolicy rows; variants +
  three-valued availability (no raw counts in the payload); FIXED discount create stamps
  novaActionId; frequency guard 409s a second coupon inside the window; validate route enforces
  minOrder; cart PATCH persists recoveryMessage; `GET /customers/risk` normalizes `+880/880/0`
  variants to one customer.
- `src/lib/novaExecutors.test.js` (extended) — reject of a `verify_payment_slip` decision emits
  `payment.claim_rejected` exactly once (dedupeKey replay-safe).

nova-ai (repo suite + isolation suite — tenancy is touched):

- Schema: `create_order_from_chat` without `confirmedByCustomer: literal true` fails validation.
- Guardrail matrix: missing `inbox.orderAuto` key ⇒ needs_approval (fail-closed invariant,
  tested — not a convention); over-cap ⇒ `guardrail:inbox_order_over_cap`; rtoCount 2 ⇒
  needs_review at every tier including T3.
- TARGET_TEXT extractors: Bangla product-name lock (NFC, with matras) blocks order + discount +
  reply mentioning the locked product.
- Discount branch: pct > `maxDiscountPct` follows the existing blocked→escalate path; T3 +
  in-bounds executes.
- Guardrail-breach eval suite (CI hard gate) re-run with the three new verbs registered.

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| `orderCreate.js` extraction regresses the production merchant order path (worst blast radius in Phase 16) | medium | parity suite + existing `test/orders.*` as safety net; behavior-identical rule; staged deploy; route keeps its own tests green |
| Wrong-item / wrong-address chat order → RTO (worst customer failure: parcel to the wrong place) | medium | read-back confirmation with explicit yes; `confirmedByCustomer` literal-true schema; T2 gate default off; rtoCount ≥ 2 always drafts; server re-runs risk pair |
| Duplicate orders from double-tap approval or executor retry | low | decision claim is at-most-once (conditional updateMany) + `w()` key = novaActionId — one order per action, tested |
| Nova "confirms" a payment it cannot verify (worst trust failure with money) | low | `verify_payment_slip` is high-risk/always-drafts/ADVISORY; mark-paid has no Nova path at any tier; banned-utterance eval covers "payment received" |
| Coupon leakage: repeated haggling extracts serial coupons | medium | server-side frequency guard (ledger query, 409) + `maxUses:1` + 48h expiry + never-stack rule; `discount_cost_bdt` visible in Finance room |
| Cart nudges feel like spam / violate Meta window policy | low | one nudge per cart, window fire-time re-check, quiet hours + weekly touch caps (04), intent drafts by default until tenant opts in; closed window = `skipped_window` receipt, never a tag workaround |
| Raw stock counts leak into replies (competitive info) | low | server ships three-valued `availability`, never integers; grounding eval asserts no numerals sourced from stock fields |

---

## Gate

**Scripted demo (non-builder, clean staging store, Messenger test user):**

1. Ask "Dam koto? XL hobe?" about a variant product → correct price + variant availability in
   the customer's script, no raw counts, within the latency budget.
2. Ask a policy question with no TenantPolicy row → the honest "confirm kore janachchi" line +
   an escalation naming the missing key; add the policy row; ask again → grounded answer.
3. Haggle twice → first a decline-with-value-framing, then a drafted free-delivery FIXED coupon
   Decision; approve → code arrives in-thread; a third haggle inside 30 days produces **no**
   second coupon.
4. Order flow at T1: slot-fill → read-back → "হ্যাঁ" → a Decision card with items/address/total;
   approve → real Order row (correct server shipping for the district), order number + working
   tracking link in-thread, BY NOVA chip on the merchant orders list, Sales-room receipt with ৳
   revenue labeled *estimated*. Flip `inbox.orderAuto` on (T2) → same flow auto-executes under
   the cap; an over-cap order still drafts.
5. Send a bKash screenshot + TrxID → Finance verification Decision + the honest "checking" reply;
   reject it → `payment.claim_rejected` event exists (verify via feed line); at no point does any
   surface show the order as paid.
6. Abandon a storefront cart with the same phone → in-window nudge drafts naming the actual item;
   approve → send lands; expire the window (clock shift) → `skipped_window` receipt, no send.

**Measurable checks:** every Order created in the demo has
`novaActionId + sourceConversationId + sourceChannel:'inbox_nova'`; zero Coupon rows without
`novaActionId`; zero orders where `unitPrice ≠ sellingPrice`; parity suite green; guardrail-breach
+ grounding evals green in CI.

**Rollback (no deploy):** flip `inbox.orderAuto` / `inbox.discountAuto` to `false` (new guardrail
version) to force everything back to drafts; remove selling intents from `inbox.autoIntents` to
draft even Q&A replies; set `door:inbox` mode `assisted` to draft the entire module; per-thread
`novaEnabled:false` for a single conversation. The service routes are additive and inert without
the verbs calling them; the merchant order path change is exercised by its own tests and is the
only piece rollback cannot config-away — hence the parity gate.

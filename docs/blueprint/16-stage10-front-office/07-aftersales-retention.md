# Module 07 — Aftersales & Retention: returns, complaints, reviews, repeat purchase, win-back

**Phase:** 16 "Front Office" · **Depends on:** 04, 05, 06 · **Feeds:** 09
**Repos touched:** dakio-api | nova-ai
**Founder requirements covered:** #15, #16, #18

This module is deliberately thin on machinery and thick on behavior. Every primitive it needs
already exists by the time it builds (waves 1–4): the journey reducer and `followup`/`journey_sweep`
jobs (04), `create_order_from_chat` / `offer_chat_discount` / the `orderCreate.js` endpoint (05),
`NovaCase` + `open_case` + the loop-closer (06), locks/escalation/briefs (08). What 07 ships is the
post-purchase half of the customer relationship wired onto those primitives: the return/exchange
conversation, the complaint conversation, the review ask with its absolute unhappy gate, the
one-tap-feel reorder, the reorder-window nudge, and the honest win-back path. No new Prisma models,
no new verbs, no new job kinds — one small additive change to an 05-owned endpoint, instruction/skill
content, NBA eligibility logic, sweep extensions, and executor stamps.

---

## Already real vs to build

| Already real (recon evidence) | What 07 adds on top |
|---|---|
| Nova-shaped order read returns items per order; `customerSegment()` derives `new/repeat/vip/at-risk` from ordersCount + lastOrderAt (`dakio-api/src/routes/novaStore.js:132-139`) | Reorder flow grounded in real order history; `repeat`/`vip` segments select the warmest persona register |
| `deliveredAt` is approximated from `updatedAt` once DELIVERED — no real column (`novaStore.js:319-320`) | Review arming keys off the `→delivered` JourneyTransition timestamp (module 04), not a fake deliveredAt; +2d eligibility delay computed from the transition row |
| `PATCH /api/v1/store/orders/:id` structurally rejects refund statuses with 422 "refunds are a ledger entry, not an order status" (`novaStore.js:352-366`) | Nothing — cited as proof that refund execution through the Nova data path is impossible by construction, not by prompt |
| `ORDER_STATUS_FROM_NOVA` maps `rto → 'RETURNED'` (`novaStore.js:352-355`) — the write-side mapping exists | 07 deliberately does NOT give Nova a verb that calls it: RETURNED is written founder-side after approving the return decision (see D2.6) |
| `SupportTicket` is merchant↔Dakio-admin only (`dakio-api/prisma/schema.prisma:1223-1246`) | Shopper aftersales rides `NovaCase {kind:'damaged_item'}` (module 06 machinery) — no shopper ticket system, per canonical §5 |
| `InboxMessage.attachmentUrl` exists (`schema.prisma:1334`); webhook captures only the first attachment URL, type discarded (`dakio-api/src/routes/meta.js:495,508`) | Damage-photo capture for return intake (module 01 adds `attachmentType`); Nova treats the photo as evidence attached to the case, never as something it "verified" |
| Order creation auto-converts OPEN StorefrontLeads for the phone (`dakio-api/src/routes/store.js:877-881`) | Repeat/won-back counting never double-counts a lead as a new customer |
| `optedOutAt` set via novaReach opt-out is absolute (`dakio-api/src/routes/novaReach.js:88`) | `lost` journeys from opt-out re-open for reactive replies only; win-back never messages an opted-out channel |
| `Coupon.novaActionId` attribution column exists (`schema.prisma:889-891`) | Complaint save-gesture coupons are attributable to the de-escalation that spent them |
| Meta send path has no MESSAGE_TAG support; untagged out-of-window sends fail (`meta.js:750-770`) | **OUT:** proactive review asks and Messenger win-back sends. Review asks are organic-window-only by design (not just legality); win-back v1 = segment feed + digest line, zero cold sends |
| — | **OUT:** review completions (`journey.reviews_collected`) — dakio-store review submission carries no attributable token today. Ships as honest zero with `outcomeNote: "asks counted; completions not yet trackable"`; v2 adds the token |
| — | **OUT:** auto-created ৳0 replacement orders — v1 replacement execution is a founder checklist on the approved case decision (module 06 §5.3 boundary); v2 candidate |
| — | **OUT (permanent):** refund execution, payment confirmation, incentivized reviews |

---

## Objective

After this module ships, a founder's store handles the entire post-purchase relationship without the
founder driving it: a damaged-item photo becomes a verified return case with an exchange-first
conversation and a costed decision card; an angry customer gets de-escalated or escalated within two
turns, never ignored; happy delivered customers get exactly one well-timed review ask and unhappy
ones never do; a repeat buyer reorders in three messages to their previous address; and dormant
customers surface as an honest segment + digest line instead of illegal cold DMs. Every one of those
sentences is testable against ledger rows.

## Scope

**In:**
- Returns / refund-inquiry / exchange intake conversation (CAP-06 behavior) on top of module 06's
  `damaged_item` case machinery; missing-item and wrong-item reports as the same flow.
- Complaint de-escalation: severity ladder, empathy-first + one concrete verifiable step, the
  two-unresolved-turns and streak backstops, bounded save-gesture via `offer_chat_discount`.
- Usage/how-to questions post-delivery (grounded product facts only; unknown → fallback + founder
  Decision, module 11's seam).
- Review collection steps 3–5 of design-lifecycle §5.3: fire conditions, the absolute unhappy gate,
  the ask itself, `reviewAsks` stamping, metrics (arming machinery — `reviewEligibleAt` — is 04's).
- Repeat purchase & reorder (CAP-13): history-grounded reorder, address reuse without the address
  ever entering model context, NBA reorder-prior consumption.
- Repeat-window nudges: trigger #13's send/skip/brief-card path (detection math is 04's).
- Win-back: dormant segment feed, weekly digest line, `won_back` counting with null causation,
  reactive re-entry behavior.
- Post-delivery ping recap: how CAP-12 rows (shipped / COD-ready / recap) serve retention — a
  consumption map, primary specs in 04 (trigger map) and 06 (delivery).
- Metric definitions for `inbox.return_intakes`, `inbox.exchange_saves`, `journey.reviews_asked`,
  `journey.reviews_collected`, `journey.repeat_orders`, `journey.winbacks` (registry + nightly
  computation owned by 09).

**Out (owner named):**
- `damaged_item` case model, replacement decision card spec, ops task boundary → module 06.
- Refill-cycle math, dormancy thresholds, `journey_sweep`/`followup` job mechanics, quiet
  hours/touch caps → module 04.
- Escalation transaction, holding lines, trigger lexicon, T0–T3 encoding → module 08.
- `offer_chat_discount` registration and bounds enforcement → module 05.
- Metric registry, nightly night_ops pass, achievement evaluation → module 09.
- Reach SMS/WhatsApp win-back broadcasts → Stage 6 Reach, when a send provider lands (v2).
- `ask_feedback_private` post-recovery candidate; review-completion token in dakio-store;
  MESSAGE_TAG review asks → v2.

---

## Design

### D1. One discipline: aftersales flows are purposes and cases, never new verbs

Every customer-visible aftersales act is `send_inbox_reply` with a canonical `purpose`/intent value
(`return_refund`, `complaint`, `review_ask`, `upsell`, `winback`, `general`), plus at most one of the
existing coordination verbs (`open_case`, `escalate_conversation`, `schedule_follow_up`,
`offer_chat_discount`, `create_order_from_chat`). The killed `inbox.intake_return` verb is a reply +
`open_case {kind:'damaged_item'}`; the killed review/winback verbs are reply purposes (canonical
§2.3 killed-verbs list). Department attribution follows `DEPARTMENT_BY_INTENT` deterministically:
`return_refund`/`complaint`/`review_ask`/`general` → support; `upsell`/`winback` → sales. This keeps
07 additive: nothing in the authority table, executor registry, or guardrail namespace changes.

A consequence worth stating plainly: **none of the aftersales intents are in the default
`inbox.autoIntents` allowlist** (`["general","product_question","price_query","availability_check",
"order_status","delivery_eta","checkout_help"]`, canonical §2.11). So return-intake replies,
complaint replies, review asks, and reorder nudges all land as `needs_approval` drafts at every tier
until the founder explicitly adds those intents to the allowlist. That is the fail-closed default
working as intended — a new store's first complaint reply is exactly the kind of message a founder
should see before it sends. Design-lifecycle §4 row 14's "L1+ auto" for review asks therefore reads:
auto **once the founder opts `review_ask` into `inbox.autoIntents`** (recorded as a resolution below).
Note `general` IS allowlisted — so a plain grounded usage-question answer post-delivery auto-sends at
T1+, which is correct: it is informational, not an aftersales commitment.

### D2. Returns / refund / exchange intake (req 15)

Flow, in order, with each step's mechanism:

1. **Verification gate first.** Order details flow only to a verified asker: conversation
   identity-linked (`InboxConversation.customerId` set, module 03) → read their orders directly;
   else order number + phone last-10 match (CAP-03 semantics); unverified → generic help only. A
   bare PSID never sees order contents.
2. **Capture reason + evidence.** The damage photo arrives as `attachmentUrl` (first attachment
   only — a known lossy seam; if the customer sends several, ask them to confirm which photo shows
   the issue rather than pretending to have seen all of them). Reason is captured as free text in
   the case facts. Nova never claims to have *assessed* the photo — it acknowledges receipt.
3. **Exchange-first framing** (protects margin, BD norm): before any refund talk, check replacement
   stock inline (`get_product` with `variants[]`) and offer size/colour exchange where stock exists.
   Copy:

   > "ইশ, ছবিটা দেখলাম ভাইয়া 😔 সত্যিই দুঃখিত। সাইজটা বদলে নতুন একটা পাঠিয়ে দিতে পারবো —
   > XL স্টকে আছে। এক্সচেঞ্জ করে দিবো?"
   > *(ish, chobita dekhlam bhaiya — really sorry. Can swap the size and send a new one — XL is in
   > stock. Shall I arrange an exchange?)*

   The stock claim is tool-read this turn or not stated (rule 13). No stock → honest alternative or
   straight to the case, never a fake exchange offer.
4. **Open the case.** `open_case {kind:'damaged_item', orderId, conversationId, title, factsNote}`
   → module 06's create-or-join under `activeKey 'damaged_item:order:<orderId>'` (a second photo
   message joins, never duplicates), department support, and the prepared replacement decision
   `NovaDecision {tag:'support', bundleRef:'case:<caseId>'}` with photo link, order facts, inline
   stock check, exchange-first recommendation, and the cost line ("replacement cost ৳480 vs refund
   ৳1,840") — card spec owned by 06 §5.3; 07 owns everything the customer hears.
5. **Refund demands take the finance lane.** Explicit "টাকা ফেরত চাই" → `escalate_conversation
   {department:'finance'}` with the module 08 brief (order facts, payment state, LTV, rtoCount).
   Refund execution is blocked at every tier forever (`refund_promise` is FOUNDER_ONLY; the data
   path rejects it — see Already-real row 3). Nova's reply promises process, not money:

   > "টাকা ফেরতের সিদ্ধান্তটা শপ ওনার নিজে কনফার্ম করেন — আমি এক্ষুনি ওনাকে সব ডিটেইলস দিয়ে
   > দিয়েছি। আজকের মধ্যেই আপনাকে জানাবো।"
   > *(the refund decision is confirmed by the shop owner himself — I've just sent him all the
   > details. I'll update you within today.)*

   That sentence commits → the reply payload declares a `promise` → `NovaPromise` row (module 03),
   dead-man `followup` job behind it. "জানাবো" without a promise row is an undeclared-promise CI
   failure (module 12 eval).
6. **RETURNED writeback is founder-side.** The approved replacement/return decision's execution is
   advisory (approve = acknowledged + the founder checklist: book reverse pickup, mark the order
   RETURNED in the merchant app, ship replacement). Nova never writes order status RETURNED — the
   canonical verb table has no verb for it, deliberately (deviation note below). When the founder's
   status change lands, the courier/order webhook path emits `case.updated` and module 06's
   loop-closer tells the customer what actually happened, stamping the promise kept.
7. **Missing-item / wrong-item** reports are the same flow with `factsNote` distinguishing
   `missing_item` / `wrong_item` from `damaged` — same case kind, same decision card, no separate
   machinery.
8. **Usage questions** ("এটা কিভাবে ইউজ করবো?") are not cases: grounded answer from product data +
   `product:<id>:fact:<slug>` memory facts; unknown fact → module 11's fallback line + founder
   Decision + memory write-back so the next asker gets a grounded answer.

### D3. Complaint de-escalation (req 15)

Severity ladder over the untrusted text, assessed in-turn (module 11's `messageAssessmentSchema`),
with deterministic backstops that do not depend on the model behaving:

| Severity | Signal | Behavior |
|---|---|---|
| annoyed | mild negative sentiment, first occurrence | Empathy-first reply + one concrete verifiable step (live status quote, intake, case). Never a hollow apology: every reply must contain a checkable fact or a real action taken this turn |
| angry | strong negative, ALL-CAPS bursts, 😡, repeat rapid messages | Same, warmer register, `urgency` raised (assessment column) — pacing bypass applies (module 11 §1.4); consider save-gesture (below) |
| threat / legal / abuse | ingest lexicon hit (module 08's `legal_threat_abuse`, fail-closed) | Escalation forced at ingest before the model even composes; Nova sends only the holding line |

Backstops (server-side, not prompt-side):
- **`negSentimentStreak ≥ 2`** (written server-side from assessments, module 11) → the anger
  escalation trigger fires (module 08 row 2) regardless of what the model chose.
- **Two unresolved turns on the same complaint**: instruction rule — if `lastIntent` stays
  `complaint` across two consecutive customer turns and no case was opened nor concrete step
  accepted, escalate. The streak column is the deterministic floor under this; the instruction makes
  Nova escalate *before* the floor forces it.
- Escalation is never gated and never punished (cross-cutting rule 15) — `escalate_conversation`
  executes at every tier.

Empathy template shape (the persona layer owns register; this is the structural contract —
acknowledgment + concrete step, in that order, one message):

> "ভাইয়া আমি বুঝতে পারছি, এটা আসলেই ভোগান্তির ব্যাপার 😔 এক্ষুনি চেক করলাম — আপনার পার্সেল
> Steadfast-এর হাবে আছে, আমি এখনই ফলো-আপ কেস খুলে দিলাম, আপডেট পেলেই জানাবো।"
> *(bhaiya I understand, this is genuinely a hassle. I just checked — your parcel is at the
> Steadfast hub, I've opened a follow-up case right now, I'll tell you as soon as there's an
> update.)* — every clause maps to a row: the status quote to a live read, the case to `open_case`,
> the "জানাবো" to a NovaPromise.

**Save-gesture**: a small coupon strictly through module 05's `offer_chat_discount` — subject to
`inbox.discountAuto`, `maxDiscountPct`, `inbox.discountPerCustomerDays` (default 30), coupon-only,
never stacked, never a price change. Sequencing rule pinned in instructions: the concrete fix comes
first; a discount offered *instead of* a fix reads as a bribe and is a bot tell. Complaint flows
never mint discounts at T0–T2 defaults (discountAuto false ⇒ drafts).

### D4. Review collection with the absolute unhappy gate (req 18)

Module 04 arms: on `→delivered`, `journey_sweep` sets `stageData.reviewEligibleAt = deliveredTransition.at + 2d`.
Module 07 owns fire-through-ledger:

1. **Fire conditions — ALL must hold** (computed in `novaNba.js` eligibility for the `ask_review`
   candidate; the model cannot override, only decline):
   - journey stage ∈ `delivered | retained | repeat_buyer`;
   - `reviewEligibleAt` passed; `stageData.reviewAsks[orderId]` unset (once per order, ever);
   - **window open organically** — the customer messaged post-delivery ("peyechi vai, thanks!").
     v1 never uses a synthetic ping just to ask for a review, by design, not just Meta legality;
   - **the unhappy gate**: no `complaint`/`return_refund` intent recorded on this journey since the
     order, AND last assessment sentiment ≥ neutral, AND no open `at_risk` interrupt or escalation.
     Any failure → ineligible with reason `unhappy_gate`.
2. **Recovery before feedback**: complaint post-delivery → `at_risk` → D2/D3 flows run. Even after
   successful recovery and a subsequent positive inbound, v1 never sends a public review ask to a
   recently-angry customer — the gate checks *any* complaint intent since the order, absolute. (The
   softer `ask_feedback_private` candidate is v2.) Rationale: a wrongly-timed ask converts a
   recovered customer into a public 1-star; the asymmetry is brutal, so the rule is absolute.
3. **The ask**: one short in-register message, one link (the product's public storefront URL), zero
   incentive, no reminder ever if unanswered:

   > "আপনার {product} কেমন লাগছে ভাইয়া? ভালো লাগলে এখানে দুই লাইনের একটা রিভিউ দিলে অনেক
   > উপকার হয় 🙂 {link}"
   > *(how are you finding the {product}? if you like it, a two-line review here would help a lot.)*

4. **Stamping**: the reply executor (dakio-api `/conversations/:id/reply`), on an executed send with
   `purpose:'review_ask'` and `payload.orderId`, writes `stageData.reviewAsks[orderId] = now` on the
   journey — set regardless of whether the customer ever answers. Executor-stamped, not
   model-stamped, so a draft the founder discards stamps nothing.
5. **Metrics**: `journey.reviews_asked` = executed `send_inbox_reply` actions with purpose
   `review_ask` (ledger count). `journey.reviews_collected` = **honest zero in v1** — dakio-store
   review submission carries no attributable token; the metric row ships with
   `outcomeNote: "asks counted; completions not yet trackable"` and no surface may imply otherwise
   (cross-cutting rule 7). v2 adds a signed token to the review URL.

### D5. Repeat purchase & one-tap-feel reorder (req 16, CAP-13)

Triggers: "আগের বার এর মতো ঐ শার্টটা আবার দেন" / "gtobar jeta nisilam oita ase?" — or an organic
message during an open reorder window (D6).

1. **Identity-verified only** (D2 step 1 gate). Pull the customer's orders via
   `GET /api/v1/store/orders?customerId=` (items included — Already-real row 1). Name the actual
   previous item; re-verify current price and stock this turn (rule 13 — last order's price is not
   this order's price).
2. **Reorder = `create_order_from_chat` seeded from the previous order.** Items and quantities seed
   the slot-filling state; the address is reused *without ever entering model context*: the model
   asks

   > "ঠিকানা কি আগেরটাই?" *(thikana ki agertai? — same address as before?)*

   and on yes, the order-create call carries `reuseAddressFromOrderId: <previousOrderId>` — the
   server (05's `orderCreate.js` path) copies address/city/district from that same-tenant,
   same-customer order and recomputes shipping. The model handles a boolean; the server handles the
   address (cross-cutting rule 5). This is 07's one API delta (see APIs) — additive, coordinated
   with 05.
3. **Register**: `repeat`/`vip` segments (server-derived, Already-real row 1) get the warmest
   register — the persona layer (module 02) reads `customer.segment` from the 360 block. Rule 17
   applies: reference facts, don't surveil — "আগের প্রোটিন প্যাকটা" is warm; "আপনি ১৩২ দিন আগে
   অর্ডার করেছিলেন" is creepy and banned.
4. All CAP-02/module-05 gates apply unchanged — `inbox.orderAuto`, `inbox.maxAutoOrderMinor`,
   rtoCount shadow rule, in-thread confirmed read-back. Reorders get no special autonomy.

### D6. Repeat-window nudges (trigger #13 — the send/skip/card path)

Module 04 owns detection: `journey_sweep` refill-cycle math (personal median gap × 0.8–1.5 band;
tenant category prior only at ≥5 samples; no invented cycles) writes
`stageData.reorderWindow = {productId, productName, opensAt, closesAt, source}` and, on the day the
window opens, inserts a system `followup` NovaJob (priority 3, dedupeKey
`followup:<conversationId>:<dueAtISO>`, payload `{conversationId, journeyId, reason:'reorder_window',
plannedIntent:'upsell'}` — no `scheduledByActionId`; sweep-initiated jobs are system rows, and the
*send* is what gets gated). Module 07 owns what happens when it fires:

1. Dispatcher → fire-time re-check sequence (module 04 §3.4, mandatory): customer replied since →
   skip; thread not Nova's → skip; **window closed** (the near-universal case — Meta counts from
   last inbound) → `skipped_window` receipt whose brief line IS the founder card:
   *"Repeat window open for Rahima — গতবারের প্রোটিন প্যাক. Can't message first in Messenger;
   she'll get the nudge if she messages, or use Reach SMS when a provider lands."* No decision to
   tap, nothing pretending to be sendable — an honest would-have-sent line (rows 13/15 hand off to
   Reach honestly, per the skeleton).
2. Window open (rare — customer messaged within 24h): NBA-gated compose →
   `send_inbox_reply {intent:'upsell'}` — **prepared at every tier in v1** (trigger-13 default;
   `upsell` ∉ autoIntents makes this automatic via the guardrail branch, no special case needed).
   Copy must name the actual previous product — generic promotion is banned:

   > "গতবারের {product}টা প্রায় শেষ হওয়ার কথা — লাগবে আবার? আগের ঠিকানাতেই পাঠিয়ে দিতে
   > পারি 🙂"
   > *(last time's {product} should be nearly finished — need another? I can send to the same
   > address.)*

3. **Organic-arrival path (the common win)**: the customer messages during an open window → the NBA
   block carries `priors.reorderWindowOpen: {productName, lastOrderedAt}` and `recommend_product`
   ranks first — a reactive, always-legal, warmest-possible upsell grounded in their own history.
   Reactive replies never consume the touch budget (test-pinned, module 04).
4. Quiet hours + `inbox.maxProactiveTouchesPerWeek` (4) + `inbox.maxUnansweredProactiveStreak` (2)
   all apply — this is a Nova-initiated send.

### D7. Win-back honesty (req 16, dormant → won_back)

Dormancy, thresholds, and stage math are module 04's (`dormant` at max(1.5 × personal cycle, 45d)
for customers / 30d for never-ordered leads; `lost` at opt-out / 180d). Module 07 owns the honest
consequences:

1. **No proactive Messenger win-back in v1, ever.** The window is closed by definition of dormant;
   no tag covers marketing honestly. Zero cold sends, zero "skipped" theater — the dormant segment
   simply isn't a Messenger audience.
2. **Segment feed**: `CustomerJourney WHERE stage='dormant'` is the export surface Reach's
   NovaSegment machinery consumes when a real send provider lands (v2). Until then the only surface
   is the **weekly founder digest line** (computed in the night_ops weekly pass from journey rows +
   CustomerChannel consent): *"14 customers went dormant this month; 9 have marketing consent for
   SMS when a send provider lands."* Counts from rows, nothing implied sendable.
3. **`won_back` counting with null causation**: any `order.created` on a dormant journey writes the
   `won_back` transition (then re-enters at `ordered` — two transitions, one event, module 04).
   `causedByActionId` stays **null** unless Nova's direct action preceded it under the strict
   direct-cause rule — the founder's own SMS or offline effort gets no stolen Nova credit.
   `journey.winbacks` counts the transition rows, not Nova's contribution.
4. **Reactive re-entry**: a dormant/lost customer who messages gets a warm reactive reply
   (`winback` intent, sales dept) — always legal, always allowed, budget-free. Rule 17 shapes the
   greeting: "আরে ভাইয়া, অনেকদিন পর! 🙂" *(hey bhaiya, it's been a while!)* — warm recognition,
   no recitation of their absence length or history unprompted. Opt-out journeys re-open for
   reactive replies only; proactive stays off forever.

### D8. Post-delivery pings as the retention substrate (consumption map)

The CAP-12 rows this module leans on but does not own: order recap (in-window by construction, 05),
shipped notification + COD-ready reminder (04 trigger rows 3–4, shipping dept, 06 wires courier
events). Their aftersales value: **each in-window ping resets the 24h window**, and the customer's
reply to a recap/shipped/COD ping ("peyechi vai, thanks!") is precisely the organic window in which
`ask_review` becomes eligible (D4) and reorder priors get consumed (D6.3). No new sends here — the
point is that 07's flows are designed to ride windows that 04/06's honest pings naturally open, which
is why v1 needs no MESSAGE_TAG to collect reviews at a useful rate.

### D9. Metrics moved by this module (definitions here, registry + computation in 09)

All computed nightly by the night_ops pass from ledger/transition rows — never model claims:

| Key | Dept room | Definition (row source) |
|---|---|---|
| `inbox.return_intakes` | support | `NovaCase` rows `kind:'damaged_item'` created in window (opened via chat — `conversationId` set) |
| `inbox.exchange_saves` | support | `damaged_item` cases resolved with an exchange/replacement outcome (facts carry the approved replacement; no refund executed). Sibling `case.replacements_completed` owned by 06 |
| `journey.reviews_asked` | support | executed `send_inbox_reply` actions, purpose `review_ask` |
| `journey.reviews_collected` | support | **honest zero v1** + `outcomeNote` (no attributable review token yet) |
| `journey.repeat_orders` | sales | `JourneyTransition {toStage:'ordered'}` where the journey was `retained`/`repeat_buyer` at event time (won_back-free reorders, module 04 §6.1) |
| `journey.winbacks` | sales | `JourneyTransition {toStage:'won_back'}` rows |
| `journey.retained` | support | `JourneyTransition {toStage:'retained'}` rows |

Complaint outcomes ride the support scorecard keys owned by 09 (`resolved_without_handover_pct`,
`handover_rate`) — the capabilities-era `inbox.deescalations` family is superseded by the canonical
registry and is not built.

---

## Data model

**No new models, no new columns, no migration.** Module 07 writes exclusively into structures owned
by 03/04/06. The binding contracts are the Json shapes it reads/writes:

```prisma
// CustomerJourney.stageData — fields this module reads/writes (Json, no migration).
// Shapes per stage; all writes go through novaJourney.js / the reply executor, never the model.
//
// delivered / retained / repeat_buyer:
//   {
//     deliveredOrderIds: string[],
//     reviewEligibleAt?: string,          // ISO — armed by journey_sweep (module 04), delivered+2d
//     reviewAsks?: { [orderId: string]: string },  // ISO of the executed ask — once per order, ever
//     sentiment?: string,
//     medianGapDays?: number,             // repeat_buyer refill math (module 04)
//     categoryKeys?: string[],
//     reorderWindow?: {                   // written by journey_sweep when a window opens
//       productId: string, productName: string,
//       opensAt: string, closesAt: string,
//       source: 'personal' | 'category'
//     }
//   }
//
// dormant: { dormantSince: string, lastKnownInterest?: string }
```

Notes:
- **`reviewAsks` map, not a flat `reviewAskedAt`**: design-lifecycle §1.4 sketched a single
  `reviewAskedAt?`; the §5.3 rule is "once per **order**, ever", which a flat field cannot honor for
  a repeat buyer's second delivered order. Keyed by orderId. (Recorded as a deviation.)
- `NovaPromise` rows (model owned by 03) are created by declared promises on D2/D3 replies —
  `conversationId` plain string, survives Meta hard-delete; this module adds no fields.
- `NovaCase {kind:'damaged_item'}` rows (model owned by 06) — this module adds no fields; its
  `factsNote` values `damaged | missing_item | wrong_item` are a convention, not a column.
- Meta data-deletion: nothing new to cascade — every write above hangs off journey/case/promise
  rows whose deletion semantics modules 01/03/04/06 already define.

---

## APIs & interfaces

### dakio-api — changed (one additive delta; everything else consumed as-is)

| Method + path | Auth | Change |
|---|---|---|
| `POST /api/v1/store/orders` | Nova service token + requireTenant, `w()` idempotent | **Additive body field `reuseAddressFromOrderId?: string`** (07's delta on 05's endpoint): server loads that order, verifies same tenant AND same resolved customer (phone-variant match), copies `customerAddress/city/district`, recomputes shipping; 422 `reuse_order_not_found_or_not_yours` otherwise. Keeps addresses out of model context entirely |

Consumed unchanged (contract recap so this doc builds alone):
- `POST /api/v1/inbox/conversations/:id/reply` — the only send door; body carries
  `{chunks[{text}], purpose, inReplyToMessageId, promise?, orderId?}`. 07 extends its **executor
  internals** (not the contract): on executed send with `purpose:'review_ask'` + `orderId`, stamp
  `stageData.reviewAsks[orderId]`.
- `POST /api/v1/inbox/cases` (create-or-join), `GET /api/v1/inbox/cases/:id` — module 06.
- `POST /api/v1/inbox/followups` (supersede rule), `GET /api/v1/inbox/nba/:conversationId` —
  module 04. 07 contributes eligibility logic *inside* `novaNba.js`: the `ask_review` candidate with
  reasons `stage_not_delivered | unhappy_gate | window_closed | quiet_hours`, and the
  `priors.reorderWindowOpen` block.
- `GET /api/v1/store/orders?customerId=` · `GET /api/v1/store/products/:id` (with `variants[]`) —
  modules 05/recon reads.
- `GET /api/nova/followups` (merchant JWT, module 04) — reorder-window followups appear here with
  `reason:'reorder_window'`; founder cancel works unchanged.

### nova-ai — no new tools, no new verbs

- **Instructions** `agent/instructions/50-customer-inbox.ts` — aftersales rule block: exchange-first
  ordering, refund-never-promised (only process promised), empathy-then-concrete-step structure,
  two-unresolved-turns escalate rule, review-ask decline etiquette (if `ask_review` is eligible but
  the moment is wrong, `do_nothing` beats a forced ask), rule-17 warmth constraints for
  repeat/dormant greetings.
- **Skill** `agent/skills/inbox-conversations.md` — new sections: RETURNS & EXCHANGES, COMPLAINTS,
  REVIEWS, REORDERS, WIN-BACK, each with the copy templates above (bn/banglish/en variants) and the
  worked good-vs-bot-smell examples.
- Tool usage is the existing slim set: `get_conversation`, `get_order_status`, `get_product`,
  `reply_in_thread` (→ `send_inbox_reply`), `open_case`, `flag_handover` (→ `escalate_conversation`),
  `offer_chat_discount`, `create_order_from_chat`, `schedule_follow_up`.

---

## Files touched

### dakio-api
- `src/lib/novaNba.js` — `ask_review` eligibility (fire conditions + unhappy gate, D4.1) and
  `priors.reorderWindowOpen`; reason codes wired into the closed set.
- `src/lib/novaJourney.js` — journey_sweep extension: on reorder-window open, insert the system
  `followup` job (D6); weekly dormant-digest aggregation query (consumed by night_ops pass).
- `src/routes/novaInbox.js` — reply-executor stamp for `purpose:'review_ask'` (D4.4); declared-
  promise passthrough on D2/D3 replies (NovaPromise creation is 03's lib, called here).
- `src/lib/orderCreate.js` — `reuseAddressFromOrderId` handling (server-side address copy +
  shipping recompute; 05 coordination).
- `test/nova-aftersales.test.js` (new) — added to the package.json `test` list.

### nova-ai
- `agent/instructions/50-customer-inbox.ts` — aftersales rule block (D2/D3/D4/D5/D7 behavioral
  rules).
- `agent/skills/inbox-conversations.md` — five aftersales sections with copy templates.
- `evals/inbox/aftersales.eval.ts` (new) — review-unhappy-gate corpus + undeclared-promise regex
  cases for the D2/D3 copy (extends the module-12 CI hard-gate suites).

---

## Testing

**dakio-api** — `test/nova-aftersales.test.js` (node:test, named in package.json test list):

1. **Unhappy gate absolute**: given a delivered journey with one `complaint` intent recorded since
   the order and sentiment now positive, when NBA eligibility is computed, then `ask_review` is
   ineligible with reason `unhappy_gate`.
2. **Once per order**: given `stageData.reviewAsks[orderId]` set, when eligibility recomputes after
   any event, then `ask_review` never re-eligibilizes for that order (second delivered order: does).
3. **Executor-only stamping**: given a `review_ask` draft that the founder discards, then
   `reviewAsks` is unset and `journey.reviews_asked` counts zero; an executed send stamps both.
4. **Won-back null causation**: given a dormant journey and an `order.created` with no Nova action
   in the prior 72h, when the reducer runs, then the `won_back` transition has
   `causedByActionId: null` and `journey.winbacks` counts 1.
5. **Refund is structurally dead**: given a refund demand flow, then no code path issues an order
   PATCH with a refund status (route 422s if tried), an `escalate_conversation {department:'finance'}`
   decision exists, and a NovaPromise row exists for the "জানাবো" reply.
6. **Case join, not duplicate**: given an open `damaged_item` case for an order, when a second
   photo message triggers intake again, then `POST /cases` returns `joined:true` and exactly one
   case row exists.
7. **Reorder nudge honesty**: given an open reorder window and a closed 24h window, when the
   system `followup` fires, then no send occurs, a `skipped_window` receipt exists, and its brief
   line names the actual previous product.
8. **Address never in context**: given `reuseAddressFromOrderId` on order create, then the created
   order carries the previous order's address/city/district, shipping is recomputed server-side,
   and a cross-customer orderId is rejected 422.

**nova-ai** — repo suite + isolation suite (tenancy untouched by this module beyond reads, but the
eval gates are CI-hard): review-ask eval corpus (~15 transcripts where the gate must hold — recent
complaint, recovered-then-happy, open at_risk — model must not ask); undeclared-promise regex over
D2/D3 template outputs; save-gesture ordering eval (discount before concrete fix = fail).

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Review ask reaches an unhappy customer** (worst customer-facing failure: recovered customer → public 1-star) | low | The gate is absolute, computed server-side in NBA eligibility, checks *any* complaint intent since the order; model cannot override, only decline; CI eval corpus is a hard gate |
| Triple-ping seams: reorder nudge + case update + follow-up about one customer in one day | medium | One-open-followup-per-conversation supersede rule (04), open case suppresses generic pings (06 §5.2), touch caps + quiet hours on every proactive send; test-pinned in module 12's invariants list |
| Order-history leak to the wrong person (reorder/return flows quote past orders) | low | Verification gate is a precondition in both flows; unverified threads get generic help only; test 8 covers the cross-customer reuse hole |
| Aftersales intents draft-by-default frustrates founders expecting autonomy ("Nova answered the price question but not the complaint") | medium | Deliberate fail-closed default; the module 10 dial UI surfaces "add complaint/review_ask to auto-intents" as an explicit founder choice; drafts still compose instantly (`inbox.draftWhileFounderActive`) |
| Exchange offered on stale stock (stock sold out between read and founder approval) | medium | Stock re-read at order-create time is authoritative (05's endpoint re-validates); the approval card shows stock-at-draft-time; a failed create produces an honest correction reply, never a fake confirm |
| Refill-cycle noise on thin history produces silly nudge cards | medium | 04's 0.8–1.5× band + ≥5-sample category floor + prepared-at-every-tier default keeps mistakes cheap and founder-reviewed |
| `journey.reviews_collected` honest zero reads as failure | certain (v1) | `outcomeNote` on the metric row; module 10 renders asks with the note, never a fabricated completion count |

---

## Gate

**Scripted demo (non-builder, clean staging store, ~20 min):**

1. Seed: one delivered order for customer A (journey `delivered`), one dormant journey B (46d
   silent), one repeat_buyer C with 2 delivered orders of the same product ~30d apart.
2. As customer A, message "প্রোডাক্টটা ভাঙা আসছে" + a photo → verify: one `damaged_item` case
   opens (check `GET /api/nova/cases`), the reply offers an exchange with a real stock claim, a
   support decision card carries the photo + cost line, and a NovaPromise row exists for the
   commitment line.
3. Reply "টাকা ফেরত চাই" → verify: finance escalation decision appears, no order status changed,
   Nova's reply promises process not money.
4. As customer A (separate run, happy path): message "peyechi, thanks!" 3 days after delivery with
   no complaint history → verify `ask_review` drafts (default tier), founder taps SEND, one ask
   with one link, `reviewAsks[orderId]` stamped; message again — no second ask ever.
5. Repeat step 4's setup but with a complaint recorded first → verify `ask_review` ineligible,
   reason `unhappy_gate` visible in the NBA response.
6. As customer C, message "ager ta abar den" → verify: reply names the actual previous product,
   asks "ঠিকানা কি আগেরটাই?", order draft carries the previous address server-side (check the
   decision card, not the transcript — the address must NOT appear in Nova's messages).
7. Run `journey_sweep` for C's open reorder window with the 24h window closed → verify
   `skipped_window` receipt with the product named in the brief line; no send.
8. Verify the weekly digest line for B's store counts 1 dormant with consent breakdown; confirm B
   received zero outbound messages.
9. Night pass: verify `inbox.return_intakes`, `journey.reviews_asked`, `journey.winbacks` (0),
   `journey.repeat_orders` compute from rows and match the demo's actual counts;
   `journey.reviews_collected` shows 0 + outcomeNote.

**Measurable checks**: all 8 dakio-api tests green in CI; nova-ai review-gate + undeclared-promise
evals green (hard gate); zero outbound rows to dormant/opted-out channels in the demo window.

**Rollback (no deploy):** aftersales replies are already draft-only unless the founder widened
`inbox.autoIntents` — reverting the key restores full draft mode instantly. Reorder-window nudges
off: flip `detectReorderWindows: false` on the `journey_sweep` NovaJobDef config (sweep stops
enqueueing; pending `followup` jobs cancel via the founder list). Review asks off: `ask_review`
eligibility hard-disables when `reviewEligibleAt` arming is switched off in the same sweep config.
Per-thread: `novaEnabled` toggle; per-store: tenant kill switch / `door:inbox` mode → `assisted`
(module 12's ladder).

---

### Deviations & resolutions recorded by this module

1. **`reviewAsks` map replaces the flat `reviewAskedAt`** sketched in design-lifecycle §1.4 —
   required to honor §5.3's "once per order, ever" for repeat buyers with multiple delivered orders.
2. **Trigger-14 "L1+ auto" for review asks** (design-lifecycle §4) resolved in favor of canonical
   §2.11: `review_ask` is not in the default `inbox.autoIntents`, so asks draft at every tier until
   the founder opts the intent in. Fail-closed wins over the trigger table's default column.
3. **CAP-06's "RETURNED status write prepared"** has no verb in the canonical §2.3 registry (which
   is closed). Resolved: RETURNED is written founder-side via existing merchant flows as part of the
   approved return decision's checklist (advisory pattern, consistent with 06 §5.3's replacement
   boundary); Nova never writes the status. The `rto → RETURNED` mapping in novaStore stays unused
   by Nova.
4. **`reuseAddressFromOrderId`** is a new (additive) body field on 05's `POST /api/v1/store/orders`
   — not in any design file, but required to satisfy CAP-13's "previous-address reorder" without
   violating the addresses-never-in-model-context rule (canonical §4 rule 5). Coordinated with 05;
   server-side only.
5. **Capabilities-era metric keys** (`inbox.deescalations`, `inbox.repeat_orders`, etc.) are not
   built; complaint/repeat outcomes ride the canonical registry (`resolved_without_handover_pct`,
   `journey.repeat_orders`) per the deliberately-dropped table, keeping only the two survivors the
   skeleton names (`inbox.return_intakes`, `inbox.exchange_saves`).

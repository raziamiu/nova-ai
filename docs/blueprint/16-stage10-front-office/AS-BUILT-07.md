# Module 07 — Aftersales & Retention: AS BUILT

Branch `feat/front-office` in `nova-ai` and `dakio-api`. Nothing on `main`.

Commits, in order:
`98aa653` `9e6adb4`+`d9da93c` `21f6f16` — the 06.5 reachability set
`7bcfd57`+`15af6af` `08a98a6`+`692ddca` `6a8db34` `c12344c` — module 07 proper

---

## 1. The thing that had already shipped

**Module 06's five verbs could not be called by anything.**

They were written into every table that takes a verb — `ActionType`, executors
on both sides, `RISK_CLASS`, `MINUTES_BY_ACTION`, `TARGET_TEXT`, zod payloads,
`StoreClient`, guardrails, duties, and a 41-check eval suite. No tool files. And
nothing anywhere minted an action row for them, so the founder-approve replay
path had no producer either.

The consequence is not "some verbs were awkward to reach". It is that **zero
`NovaCase` rows, of any kind, could be created in production**. The whole case
system — the model, the create-or-join upsert, four handlers, the `activeKey`
claim, `expireStaleCases` — had no entry point. `case_update` was dead by
transitivity. `courier_intervention` and `restock_check` had no producer at all.
`computeRtoSignals` had no caller.

1852 dakio-api tests and 778 inbox checks were green throughout, because they
call the routes and executors **directly** — the layer below the missing one.

Three pieces of prose had already drifted into instructing tools that do not
exist: the playbook told the model to "open a case", and two job templates told
it to call `get_case`, which AS-BUILT-06 §4 R3 had explicitly decided never to
build.

**The lesson, and it is not the same as module 06's.** Module 06 learned "when a
doc names a mechanism, grep for it before building on it". This module learned
the harder half: *grepping is not enough, because every grep for these verbs
succeeded.* They were present in nine places. What no query asked was whether
anything could **originate** one. Presence is not reachability, and every check
in both repos ran along an axis where the difference is invisible —
`check:undo` asks whether an inverse exists, `tsc` forces the total `Record`
tables, and the inbox eval's registry scan proves every tool ON the slim list is
exercised, which structurally cannot notice a verb that never became a tool.

That gap is now closed by `npm run check:reachability`, and closing it is the
only reason this module opens with a 06.5.

---

## 2. What shipped

### 06.5 — reachability

- `agent/tools/open_case.ts`, `confirm_order_intent.ts`, `update_order_contact.ts`,
  `cancel_order_from_chat.ts`. All customer-plane, all `scopedConversationId`-pinned.
  `CUSTOMER_SLIM_TOOLS` 11 → 15.
- `paramsLineFor` arms for all four. Module 06 added none, so every decision card
  these verbs could produce would have rendered a **blank params line**.
- `DEPARTMENT_BY_CASE_KIND` in `schemas.ts`, mirroring dakio-api's
  `DEPARTMENT_BY_KIND`, so `open_case`'s approval card lands on the same desk the
  case does.
- `updateOrderContactFields` split from `updateOrderContactPayload`: `.refine()`
  returns a `ZodEffects` with no `.extend`, which every action tool needs.
- `REGISTERED_VERBS` += `confirm_order_intent` (dakio-api). Its test **pinned the
  gap** — `assert.ok(!REGISTERED_VERBS.has(...))` — so closing it would have gone
  red and leaving it open stayed green. Replaced with the invariant: every verb
  in `VERB_BY_CANDIDATE` is registered.
- `scripts/check-verb-reachability.ts`, wired **before** `test:isolation` in the
  `&&` chain, since that step is red on F-20 and short-circuits everything after.
- `get_case` purged from both job templates; `flag_courier_issue` removed from
  `courier_intervention`'s.

### 07 — aftersales

- **Review clock re-arms per delivery.** `journey_sweep` guarded on
  `!stageData.reviewEligibleAt`, so it armed once in a customer's life and a
  repeat buyer's second delivered order could never produce an ask.
- **`ask_review` on all three settled stages**, not just `delivered`. `STAGE_FLOOR`
  is derived from `FORWARD_CHAIN`, so the floor and the reason code are unchanged.
- **`stampReviewAsk`** — nothing wrote `stageData.reviewAsks`, so "once per order,
  EVER" was a rule reading a permanently empty map. Written at send-confirm, fills
  and never overwrites.
- **`orderId` through the reply path** — zod payload, `InboxReplyRequest`, the
  executor's request, the route body, and the stored `chunks` JSON.
- **`fillReorderProductName`** — D6's "name the actual previous product" was
  unmeetable: the field was hardcoded `null` and the model has no order-history
  tool. Reads `OrderItem.name` (the name AS SOLD), conditional on the window
  already being open.
- **`GET /orders?customerId=`** and the client filter on both backends.
- **`projectStageData`** whitelists `reorderWindowOpensAt`, `reorderWindowClosesAt`,
  `cycleBasis`.
- **Rule 20's refund clause narrowed** — see §4 R3.
- **Playbook §14/§15/§16** — damage & exchange, reviews, reorder & the quiet ones.
- **`evals/inbox/aftersales.ts`**, 33 checks, folded into `test:inbox`.

---

## 3. Frozen contracts later modules call

- **`reviewAsks` is keyed by order id and written at SEND-CONFIRM.** Not at
  enqueue: a queued-then-cancelled reply would burn that order's single ask
  forever, because the gate only tests presence.
- **It fills, never overwrites.** The gate does not care; the value is the answer
  to "when were they asked".
- **The NBA gate reads `reviewAsks` raw, not `projectStageData`'s rendering**,
  which clamps to ten keys. Module 04 already fixed this once; do not re-route it.
- **`orderId` rides the stored `chunks` JSON**, like `purpose`. That is what
  survives the 15s sweep re-arming a row in a process that never saw the request.
  Adding an `InboxOutbound` column later is fine; removing the chunk field is not,
  until every queued row has drained.
- **`DEPARTMENT_BY_CASE_KIND` is byte-identical to dakio-api's map** and pinned by
  `aftersales.ts`. Drift is silent and lands cards in the wrong room.
- **`check:reachability`'s `NO_MODEL_TOOL` needs a reason and an owner.** "A later
  module will add the tool" is explicitly not a valid reason — that is exactly
  what module 06 believed, and the belief lived only in a doc.

---

## 4. Decisions that bind later modules

**R1 — 06.5 before 07.** Reachability was a prerequisite, not scope creep. 07's
returns lane is unbuildable without `open_case`, and `damaged_item` is the one
kind that can never have a server producer: the courier reports DELIVERED, so
only the customer knows.

**R2 — all four customer verbs got tools, not just `open_case`.** Each is
something a customer says mid-sentence. Shipping one and leaving three dead would
have been arbitrary. `flag_courier_issue` stayed toolless: it is ALWAYS_DRAFT and
founder-facing, and its route to reality is a `courier_intervention` producer,
which is module 06's debt (F-58).

**R3 — rule 20 forbids GRANTING a refund, no longer MENTIONING one.** The old
clause said "the fact of one … never yours to mention", which read literally
forbids Nova from saying the word when a customer asks "টাকা ফেরত পাবো?" — and
module 07's own approved script says exactly that sentence back to them. Both
could not ship. Refusing to name a refund does not protect the shop; it makes
Nova evasive at the one moment the customer is already upset, about a word they
just used themselves. What protects the shop is that Nova never grants one.
There is still no `refund_promise` verb, so this rule text remains the **only**
enforcement — as it was before.

**R4 — no `get_product` (singular).** The spec's D2.3 stock check names it; it is
still in `SLIM_TOOLS_PENDING`, module 05 examined it and built nothing, and
`get_products` answers the exchange-stock question. A second catalogue tool on a
latency-critical prompt buys the model a choice rather than an answer.

**R5 — no reorder-window followup INSERT.** See §5.

**R6 — no weekly dormant digest.** See §5.

---

## 5. Known-not-built, with owners

**The reorder-window followup insert (D6).** Three independent route refusals
block it: `POST /followups` hard-422s without `scheduledByActionId`
(`novaFollowups.js:541`), the 24h-window pre-filter refuses any `dueAt` past
`windowExpiresAt` (`:632`) and a reorder window is always weeks out, and the doc's
dedupeKey (`followup:<conv>:<due>`) is not the real namespace
(`followup:nba:<conv>:<due>`), so a row written that way is invisible to the
reply-rate prior's parser. Building it means a raw `prisma.novaJob.create` that
also bypasses supersede, chain-cap and window checks. **And the `skipped_window`
receipt it is supposed to produce has no founder surface**:
`GET /api/nova/followups` filters `status in ['due','leased']`, so a skipped job
vanishes, and `followupCard` carries no brief line. The eligibility half — the
window, the priors, the product name, `recommend_product` ranked first — is
built and live. Filed as F-60.

**The weekly dormant digest (D7).** Nothing consumes it. The night_ops pass that
would read it does not exist. Building an aggregation with no reader is the
mistake this whole module exists to correct. Filed as F-61.

**D3's complaint severity ladder has no deterministic floor.** It is specified
against `negSentimentStreak` and `messageAssessmentSchema`, which are **module
11's** and have not shipped. There is no sentiment column anywhere and
`InboxConversation.urgency` does not exist. The escalation lexicon and the
handover path are real; the "backstops (server-side, not prompt-side)" the doc
promises are not, and §14's copy is therefore prompt-side only. Filed as F-62.

**`reuseAddressFromOrderId` (D5.2) not built, and needs a respec.** `Order` has
**no address columns at all** — no `customerAddress`, `customerCity` or
`customerDistrict`. Address lives on `Customer`. So the field cannot "copy
address/city/district from that order" as specified; it would resolve
`order.customerId → Customer`, which for a repeat buyer is already the address
`createOrder` uses. The genuine value is narrower than the doc claims — a
permission signal, not a copy. Filed as F-63.

**Duty rows for this module are decorative.** Every module-07 reply — complaint,
review ask, win-back, reorder — runs under `support.inbox_replies` (minLevel 2).
A founder who pauses `support.complaint_resolution` (minLevel 3),
`support.refund_processing` (4), `support.replacement_shipments` (4),
`support.review_responses` or `sales.winback_campaigns` **changes nothing**.
Filed as F-64; it is a product decision, not a bug.

---

## 6. Baselines at close

| | |
|---|---|
| dakio-api | **1858 pass / 0 fail**, 1 skipped |
| nova-ai `test:inbox` | **823 checks** (790 + 33 aftersales) |
| nova-ai `test:persona` | 145 checks, 1 skipped (live pass not requested) |
| `check:undo` | 25 verbs |
| `check:reachability` | 25 verbs — 23 callable, 2 exempt by declaration |
| `check:duty-seed` | 72 duties |
| `tsc --noEmit` | clean |
| Customer register | **3592 rendered / 3620 budget** |
| `test:isolation` | **RED** — pre-existing, F-20, founder context 3085 > 2500 |

**No migration.** Module 07 adds no Prisma model, no column and no index. Six
migrations remain queued unapplied from earlier modules (F-50 has the list).

---

## 7. If you are starting module 08 or later

**Run `npm run check:reachability` before you believe any verb works.** It is
cheap and it is the only check that asks the question this module was written to
answer.

**The prompt budget ledger lives in `evals/inbox/run.ts` above
`CUSTOMER_PROMPT_BUDGET`, and it is a TABLE now.** The prose above it went stale
for two modules — module 06 spent 5 tokens and left a comment claiming 18 tokens
of headroom when 13 remained. Add a row; do not rewrite the paragraph.

**Rule slot 15 is still module 11's**, unfilled, and module 07 did not spend it.
The two raises this module made (3525 → 3560 → 3620) are tool names and copy.

**What you must not break:**
1. `reviewAsks` written at send-confirm, keyed by order, fill-only.
2. The gate reads `reviewAsks` raw, not its ten-key projection.
3. `fillReorderProductName` runs only when the window is already open — the block
   has an ≤80ms budget and an unconditional order read would spend it.
4. `productName: null` means DO NOT NUDGE. The playbook says so; do not add a
   fallback phrase.
5. `NO_MODEL_TOOL` entries need a reason and an owner, not a future module.

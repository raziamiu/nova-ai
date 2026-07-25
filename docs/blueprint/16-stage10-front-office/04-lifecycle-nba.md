# Module 04 — Lifecycle & NBA: the journey brain and the timing conscience

**Phase:** 16 "Front Office" · **Depends on:** 01, 02, 03 · **Feeds:** 05, 06, 07, 09, 11
**Repos touched:** dakio-api | nova-ai
**Founder requirements covered:** #2 (full lifecycle), #5 (proactive-timing half), #6 (NBA engine), #17 (trigger half), #19 (proactive communication)

Every other module gives Nova hands, a ledger, and a voice. This one gives it a destination per
customer: a deterministic journey stage machine (`CustomerJourney` + `JourneyTransition`), a
Next-Best-Action scaffold the model chooses within but never overrides, a scheduled-follow-up
commitment system, and the quiet-hour/touch-cap conscience that decides when NOT to send. Stage is
code, never model output; the model classifies, composes, and picks among server-computed eligible
candidates — the transition table and the authority gate do everything else.

---

## Already real vs to build

| Already real (recon evidence) | This module adds |
|---|---|
| Phone is the only customer identity key: `Customer @@unique([tenantId, phone])` (recon-identity-commerce.md:11; schema.prisma:480) | `CustomerJourney` keyed the same way (`@@unique([tenantId, phoneNormalized])`) so journeys and Customers merge on the same axis |
| All three Customer creation paths store phones **un-normalized** — `+880…`/`880…`/`01…` can be three rows (recon-identity-commerce.md:15-19; customers.js:57, orders.js:625, store.js:556-569) | Reducer and merge rule use `normalizePhone`/`phoneVariants` everywhere — a journey never keys on a raw phone |
| `normalizePhone` / `phoneVariants` / `calculateCustomerRisk` NEW/RISK/POSITIVE/MEDIUM (customerRisk.js:7-24, 36-45, 69-127) | Consumed as-is in the reducer and NBA block (`customer.riskLevel`) |
| Commerce events already emitted in-tx: `emitOrderCreated` (orders.js:808, store.js:729), `emitOrderUpdated` (webhook.js:90, orders.js:1585), `emitCartAbandoned` (store.js:1198) | Journey reducer consumes them in the drain; new producers `order.confirmed`, `channel.opted_out` (registry rows landed in module 01) |
| Courier webhooks map raw statuses → order status and keep `courierStatus` live without polling (webhook.js:44-92); `courierSentAt` set at booking (orders.js:1596-1648); DELIVERED auto-marks COD paid (orders.js:1577-1580) | ENTER conditions for `in_delivery` / `delivered` / `at_risk` grounded in these exact fields |
| StorefrontLead lifecycle + auto-convert on checkout (schema.prisma:755-777; store.js:876-881; storefrontLeads.js:8) — no Customer FK (novaStore.js:402) | `qualified_lead` entry (b) reads `cart.abandoned` events; leads become journey subjects without waiting for a Customer row |
| `Coupon.novaActionId` + `expiresAt` (schema.prisma:875-895, 889-891) | Data source for trigger #10 (expiring-offer reminder) — no new columns |
| NovaJob table with dueAt/priority/per-tenant dedupe/lease/fencing (schema.prisma:2261-2289); `JOB_KINDS`, `PRIORITY_BY_KIND`, `drainEventsToJobs` (novaJobs.js:39, 46, 134-185) | Job kinds `followup` (priority 3, event) + `journey_sweep` (priority 6, daily cron); **no new scheduling model** |
| Priorities 1–2 reserved for the inbound fast lane (novaJobs.js:41-53; module 01's claim) | Respected — followup sits at 3, sweep at 6 |
| `NovaGuardrails.platform` versioned founder-edited JSON (schema.prisma:1495-1510); `Tenant.timezone` default Asia/Dhaka (schema.prisma:20) | Flat keys `inbox.quietHours`, `inbox.maxProactiveTouchesPerWeek`, `inbox.maxUnansweredProactiveStreak` (canonical §2.11 — no nested object) |
| Opt-out is absolute (schema.prisma:1760-1763; novaReach.js:84-90) | `channel.opted_out` → `lost` transition; opted-out journeys re-open for reactive replies only |
| Customer segment derivation new/repeat/vip/at-risk (novaStore.js:132-139) | Reused verbatim for `customer.segment` in the NBA block |
| Humanized 7-step tracking timeline (publicTracking.js:16-90) | `openOrder.statusStep` in the NBA block quotes it, never raw courier strings |
| `drainEventsToJobs` call sites for the reducer + followup-cancel hook already wired as stubs (module 01 D2 steps 4–5) | The real `advanceJourney` + cancel semantics land here, replacing the no-op stubs |
| OUT: review-completion tracking — dakio-store review submission carries no attributable token; `journey.reviews_collected` ships as an honest zero with `outcomeNote` until it does | — |
| OUT: out-of-window proactive sends — no MESSAGE_TAG/HUMAN_AGENT support (meta.js:750-770); every closed-window trigger row ships as `skipped_window` receipt or prepared card, never a workaround | — |
| OUT: win-back sends — Reach has no send provider ("Broadcasts are prepared and held, never sent", novaStore.js:767); dormant journeys feed segments + a weekly digest line only | — |

---

## Objective

After this module ships, every customer of a hired tenant has a deterministic journey stage
(stranger → … → repeat_buyer, with at_risk/dormant/won_back/lost) advanced only by real DB events,
visible to later modules and queryable by stage. Nova's every turn carries a server-computed NBA
block: what stage this human is in, what forward means, which actions are eligible and why the
rest are not. Nova can promise "I'll follow up in 4h" as a receipted, cancellable, quiet-hour-shifted
commitment that re-checks the world before firing — and the founder can list and cancel every such
promise. Choosing silence is recorded and counted.

## Scope

**In:** `CustomerJourney` + `JourneyTransition` models and migration; merge rule; the full
ENTER/EXIT transition table; reducer `src/lib/novaJourney.js` with two-pass chat handling; NBA
library `src/lib/novaNba.js` + `GET /api/v1/inbox/nba/:conversationId`; closed candidate vocabulary
and reason codes; per-stage candidate matrix; `schedule_follow_up` verb (full checklist); job kinds
`followup` + `journey_sweep`; fire-time re-check sequence; inbound cancel semantics (hook wired by
01); quiet hours + touch caps as flat `inbox.*` guardrail keys; the 15-row proactive trigger map;
repeat-purchase cycle math; dormancy/won_back/lost math; review-eligibility arming (steps 1–2);
stage-goal table + `journey.*` metric definitions; `do_nothing` recording.

**Out (owner in parens):** the send pipeline, persona, pacing engine (module 02); identity linking,
`NovaPromise` semantics and promise-backed follow-up *content* (module 03 — the shared `followup`
job kind and fire-time machinery live here, `payload.promiseId` distinguishes them); order/discount
slot-filling flows the NBA nominates (module 05); case machinery, RTO orchestra movements,
`restock_check` and delivery-stall *responses* (module 06 — this module only detects and
transitions); review-ask copy and the unhappy-gate *flows*, repeat-nudge copy, win-back digest
rendering (module 07); the nightly metric-writing pass itself (module 09 — computations specified
here, executed there); commitments-panel UI (module 10); learned priors replacing static counts
(module 11, v2); journey funnel dashboard, MESSAGE_TAG sends, Reach-powered win-back (v2, module 12
tracks).

---

## Design

### D1. Governing rules

1. **Stage is code, never model output.** Transitions are computed by a deterministic reducer from
   real DB events. The model consumes stage; it can never set it (same invariant as authority:
   model proposes, never authorizes).
2. **NBA is scaffold + judgment, honestly split.** The server computes an eligibility-filtered
   candidate list with hard gates baked in; the model chooses among eligible candidates and
   composes. The chosen action still flows through `performAction → evaluateAuthority` — NBA never
   bypasses the pipeline and never authorizes anything.
3. **Silence is a first-class action.** `do_nothing` is always a candidate; choosing it is recorded
   cheaply (D12) and counted (`journey.silences_chosen`).
4. **A follow-up is a promise.** Scheduled follow-ups are receipted, founder-visible, cancellable,
   quiet-hour-shifted, window-checked at fire time, capped per customer per week.
5. **No fabricated journeys.** A journey row exists only when a real event created it. A customer
   who never messaged still has a journey — advanced purely by order/courier webhooks — but Nova
   only speaks to them through channels that actually exist.

### D2. Why stage lives on a new model

Rejected placements: a field on `Customer` (journeys begin before a Customer exists — Customers
materialize only via orders, recon-identity-commerce §3); a field on `InboxConversation` (journeys
must survive across conversations and advance for customers who never message); derived-on-read
only (reducer inputs span Orders, StorefrontLeads, InboxMessages, courier webhooks — recomputing
per turn is expensive and makes "customers by stage" queries impossible).

Chosen: **`CustomerJourney`** (one live row per human-per-tenant, subject identity progressive:
conversation → normalized phone → customerId) + **`JourneyTransition`** (append-only history). The
live row is a cache of the reducer's output; the transition log is the truth and the sole
attribution source for every `journey.*` metric.

**Merge rule** (deterministic, in the reducer): when a conversation-keyed journey acquires a
`phoneNormalized` (module 03 identity link) and a phone-keyed journey already exists, merge into
the **phone-keyed row** (it carries commerce history): keep the higher-ranked stage (D3 ranks),
write one `JourneyTransition {cause:'journey.merged'}` on the survivor, copy the loser's
`conversationId` into the survivor's `stageData.linkedConversationIds[]` — and if the survivor's
own `conversationId` is null, adopt it — then delete the loser. Never merge by name/avatar
inference; same normalized phone only. Lookup helper `findJourneyForConversation(tx, tenantId,
conversationId)` checks the `conversationId` column first, then the `linkedConversationIds` path.

### D3. Canonical stages, ranks, movement rules

```
FORWARD CHAIN (rank):
 stranger(0) → inquirer(1) → qualified_lead(2) → negotiating(3) → ordered(4)
 → confirmed(5) → in_delivery(6) → delivered(7) → retained(8) → repeat_buyer(9)

INTERRUPT (from ranks 4-7):        LATE-LIFE (from 7-9):
 at_risk (resumeStage remembered)   dormant → won_back | lost
                                    (won_back immediately re-enters the chain at ordered)
TERMINAL-ISH: lost — re-openable: a lost customer who messages again re-enters at inquirer
```

- **Forward skips are legal.** A stranger who pastes name+address+phone and orders jumps
  `stranger → ordered` in one event; a storefront buyer who never messaged gets a journey created
  directly at `ordered`. Skipped stages are never backfilled (no fake transitions).
- **Backward moves happen only via defined interrupts** (`at_risk`, `dormant`, `lost`) — the
  reducer never "downgrades" on ambiguity.
- `at_risk` stores `resumeStage`; resolving returns there or advances to `delivered`.
- One journey holds one stage. Concurrent orders: the journey tracks the most advanced active
  order (`stageData.activeOrderId`); a second order does not regress the stage.

### D4. ENTER/EXIT transition table — grounded in real events

Chat events arrive via module 01's drain (`message.received`); commerce events already exist
(D-column of the Already-real table). Intent slugs are the canonical closed set
(`DEPARTMENT_BY_INTENT`, `agent/lib/nova/inboxIntents.ts`).

| Stage | ENTER when | EXIT to | stageData shape |
|---|---|---|---|
| `stranger` | New `InboxConversation` created with no intent yet | inquirer (intent), qualified_lead (identity), ordered (order) | `{}` |
| `inquirer` | First inbound classified `price_query` / `product_question` / `availability_check` | qualified_lead, negotiating, ordered; lost (opt-out) | `{askedProductIds[], lastIntent}` |
| `qualified_lead` | (a) phone captured in-thread (`claimedPhone` set, module 03), OR (b) `cart.abandoned` event for a phone/conversation this journey owns, OR (c) explicit buy intent (`checkout_help`) | negotiating, ordered; dormant (30d silent) | `{leadId?, cartValue?, askedProductIds[]}` |
| `negotiating` | Discount-ask detected (`offer_chat_discount` flow triggered under `price_query`/`checkout_help`) OR order slot-filling started (`create_order_from_chat` step 1 in progress) | ordered (order created), qualified_lead (slot-filling abandoned >24h — sweep), dormant | `{slotState:{items,name,phone,address,city,district}, discountAsks:int, couponOffered?}` |
| `ordered` | `order.created` whose normalized phone matches this journey (or creates it) — status PENDING/APPROVED, `confirmedAt` null | confirmed, at_risk, lost (cancelled + silent) | `{activeOrderId, orderNumber, codTotal}` |
| `confirmed` | `Order.confirmedAt` set (confirm writeback, module 06, or merchant manual) — detected via `order.confirmed` event (dedupeKey `order.confirmed:<orderId>`) | in_delivery, at_risk | same |
| `in_delivery` | `order.updated` status SHIPPED, or `courierSentAt` set (booking) | delivered, at_risk | `{activeOrderId, courierProvider, courierTrackingId}` |
| `delivered` | `order.updated` status DELIVERED (courier webhook auto-map; COD auto-paid) | retained (quiet 7d), at_risk (complaint), repeat_buyer (2nd delivered) | `{deliveredOrderIds[], reviewEligibleAt?, reviewAsks:{[orderId]: askedAt}, sentiment}` |
| `at_risk` | From ordered/confirmed/in_delivery/delivered on ANY of: (a) courier failed-attempt/hold status, (b) sweep stagnation — `courierSentAt`+4d, not DELIVERED, `courierStatus` unchanged 48h, (c) `fakeProtectionAction` set + unconfirmed, (d) `complaint` intent inbound while an order is open, (e) cancel ask post-dispatch | resumeStage (resolved / courier moving), delivered, lost (RTO'd + 2 unanswered contact attempts) | `{riskReason, resumeStage, contactAttempts:int, escalatedActionId?}` |
| `retained` | delivered + 7d, no complaint intent, no open at_risk | repeat_buyer, dormant | `{}` |
| `repeat_buyer` | 2nd DELIVERED order lifetime (count via `customerId` join at reducer time) | dormant (silence past refill cycle) | `{deliveredCount, medianGapDays?, categoryKeys[]}` |
| `dormant` | Sweep: no inbound AND no order for **max(1.5 × personal refill cycle, 45d)** (retained/repeat) or **30d** (qualified_lead/negotiating that never ordered) | won_back (any new order), lost (opt-out / 180d dormant) | `{dormantSince, lastKnownInterest}` |
| `won_back` | Any `order.created` while dormant. Transitional: immediately also re-enters at `ordered` — two transition rows, one event; the `won_back` row is what the winback metric counts | (chain resumes at ordered) | `{}` |
| `lost` | (a) `optedOutAt` set (`channel.opted_out` — absolute), (b) order RETURNED/RTO + 2 unanswered proactive contacts, (c) 180d dormant, (d) explicit "আর মেসেজ দিয়েন না" (*ar message diyen na* — "don't message me again") intent | inquirer (they message again; opt-out journeys re-open for **reactive replies only**, never proactive) | `{lostReason, lostAt}` |

Non-chat customers advance without messaging: storefront checkout fires `order.created` → drain
creates a phone-keyed journey at `ordered`; courier webhooks walk it to `delivered`; the sweep
promotes to `retained`. If that human later DMs and self-identifies their phone, the conversation
journey merges into this row and Nova greets them knowing their whole history — requirement #3's
"never re-explain" made structural.

### D5. The reducer — `src/lib/novaJourney.js`

`advanceJourney(tx, tenantId, event) -> { journey, transitions[] }` — pure function of (current
row, event), all writes in the caller's transaction.

- Input events: `message.received`, `order.created`, `order.updated`, `order.confirmed`,
  `cart.abandoned`, `channel.opted_out`, `sweep.tick` (from `journey_sweep`).
- **Two-pass chat handling.** Intent-dependent transitions (inquirer/negotiating entries) need a
  classified intent, which is model work. Pass 1 runs at ingest with the raw event
  (identity/commerce transitions only — module 01 D2 step 5 call site). Pass 2 runs when the
  conversation runtime posts back the classified intent
  (`POST /api/v1/inbox/journeys/:id/intent-observed`). The second pass is still deterministic:
  intent string → table lookup. The model classifies; the table transitions.
- Every transition writes a `JourneyTransition` row. Idempotence: no-op when the event implies the
  current stage (equal ranks) — re-delivered webhooks (per-(order,status) dedupe keys) cannot
  double-transition.
- Unknown order statuses / courier strings: no-op + a `JourneyTransition {cause:
  'journey.unmapped_event', fromStage = toStage}` marker row → `journey.unmapped_event` counter in
  night_ops. Never guess.
- **Drain integration** (module 01 wired the call sites): `drainEventsToJobs` calls
  `advanceJourney` inside the same transaction for every drained event before stamping
  `processedAt`. The standing rule holds — the model is never invoked synchronously on a webhook;
  the reducer is plain code, cheap, transactional. `journey_sweep` emits `sweep.tick` per candidate
  journey for time-based transitions (dormancy, retained, stagnation).

### D6. NBA engine — the honest split

| Layer | Owner | What it does |
|---|---|---|
| Eligibility + gates (deterministic) | dakio-api `src/lib/novaNba.js` | Which actions are *legal* right now: stage, 24h window, quiet hours, touch budget, guardrail keys, consent, courier state, stock. Ineligible candidates ship with machine-readable reasons so the model can explain ("আজকে আর disturb করবো না" — *ajke ar disturb korbo na* — "won't disturb you again today") without overriding |
| Priors (deterministic) | same | Ledger-derived counts, v1 no ML: reply-rate by follow-up delay bucket, tenant discount-close rate, reorder-window flag. Marked `sample` so thin data is honest |
| Choice + composition (model) | conversation runtime (module 02) | Picks ONE candidate from the eligible set, composes in-register, picks follow-up delay from the allowed list |
| Execution (deterministic) | existing action pipeline | The choice becomes a verb call through `performAction → evaluateAuthority`. NBA eligibility is advisory context; **authority is the only gate that authorizes**. A model that picks an ineligible action gets a receipted refusal — itself a prompt-quality signal |

**Closed candidate vocabulary** (versioned; the model cannot invent candidate types):
`answer` · `recommend_product` · `offer_discount` · `create_order` · `request_address` ·
`confirm_order_intent` · `payment_reminder` · `suggest_alternative` · `schedule_follow_up` ·
`proactive_ping` · `recover_cart` · `ask_review` · `escalate` · `do_nothing`

Candidate → canonical verb mapping (candidates are NBA vocabulary, not verbs): `answer`,
`proactive_ping`, `recover_cart`, `ask_review`, `payment_reminder`, `recommend_product`,
`suggest_alternative` → `send_inbox_reply` with the matching `purpose` slug; `offer_discount` →
`offer_chat_discount`; `create_order` / `request_address` → `create_order_from_chat` slot-filling;
`confirm_order_intent` → `confirm_order_intent`; `schedule_follow_up` → `schedule_follow_up`;
`escalate` → `escalate_conversation`; `do_nothing` → no verb, recorded via D12.

**Closed eligibility reason codes:** `stage_not_X`, `window_closed`, `quiet_hours`,
`touch_budget_reached`, `unanswered_streak`, `no_consent`, `courier_already_booked`,
`out_of_stock`, `no_open_order`, `discount_already_offered_30d`, `thread_not_nova` (defined as
`handledBy='founder'` OR `novaLockedAt` set OR `novaEnabled=false`), `opted_out`.

**The NBA context block** — assembled by `GET /api/v1/inbox/nba/:conversationId` (service token +
requireTenant; also computable inline from the same lib), injected every turn and every fired
follow-up:

```jsonc
{
  "nbaVersion": 1,
  "journey": {
    "id": "jrn_…",                       // for the intent-observed callback
    "stage": "negotiating",
    "stageGoal": "close the order at the best margin",   // fixed per-stage string, D11
    "enteredAt": "2026-07-25T13:40:00+06:00",
    "hoursInStage": 3.2,
    "resumeStage": null,
    "stageData": { "discountAsks": 1, "slotState": { "items": ["…"], "district": null } }
  },
  "customer": {
    "known": true,                        // false for stranger/inquirer
    "segment": "repeat",                  // novaStore.js:132-139 derivation
    "ordersCount": 3, "ltvBdt": 5400,
    "riskLevel": "POSITIVE",              // customerRisk.js levels
    "language": "banglish",               // module 02 detector
    "openOrder": { "orderNumber": "#KQ3-8FZM", "statusStep": 3, "codTotal": 1850, "courierSent": false },
    "promises": [ { "promiseId": "prm_…", "text": "kal size chart pathabo", "dueAt": "…" } ]  // open NovaPromise rows (module 03)
  },
  "window": { "open": true, "expiresAt": "2026-07-26T13:58:00+06:00" },
  "quietHours": { "quietNow": false, "tz": "Asia/Dhaka", "nextAllowedAt": null },
  "touchBudget": { "proactiveUsedThisWeek": 1, "max": 4, "unansweredStreak": 0 },
  "commitments": [ { "jobId": "…", "dueAt": "…", "note": "follow up on size question" } ],
  "candidates": [
    { "action": "answer",             "eligible": true },
    { "action": "create_order",       "eligible": true,  "gate": "auto",  "capNote": "inbox.orderAuto on, ≤ inbox.maxAutoOrderMinor" },
    { "action": "offer_discount",     "eligible": true,  "gate": "draft", "bounds": { "maxPct": 10, "oncePerCustomerDays": 30 } },
    { "action": "schedule_follow_up", "eligible": true,  "allowedDelays": ["2h","4h","24h"] },
    { "action": "ask_review",         "eligible": false, "reason": "stage_not_delivered" },
    { "action": "proactive_ping",     "eligible": false, "reason": "touch_budget_reached" },
    { "action": "escalate",           "eligible": true },   // ALWAYS eligible — never gated
    { "action": "do_nothing",         "eligible": true }    // ALWAYS eligible
  ],
  "priors": {
    "followupReplyRateByDelay": { "2h": {"rate": 0.41, "sample": 17}, "24h": {"rate": 0.22, "sample": 31} },
    "discountCloseRate": { "rate": 0.55, "sample": 9 },
    "reorderWindowOpen": null,            // {productName, lastOrderedAt} when D10 window open
    "note": "counts from this store's ledger; thin samples are honest, not hidden"
  }
}
```

The `gate` field mirrors what `evaluateAuthority` will do (from the door mode + `inbox.*` keys) so
the model can set expectations honestly ("owner-ke jiggesh kore janachchi" for drafts) — it never
replaces the gate. Full addresses and phone numbers never appear in the block beyond what the
customer themselves typed in-thread; the block carries flags and ids, servers resolve ids at
execution (cross-cutting rule 5).

**Per-stage candidate matrix** (server's default-eligible set; order = prior-ranked hint):

| Stage | Default-eligible candidates |
|---|---|
| stranger | answer, recommend_product, escalate, do_nothing |
| inquirer | answer, recommend_product, suggest_alternative, schedule_follow_up, escalate, do_nothing |
| qualified_lead | answer, recommend_product, create_order, recover_cart (if cart), offer_discount (2nd-ask rule), schedule_follow_up, escalate, do_nothing |
| negotiating | request_address / create_order (slot-driven), offer_discount (bounds), answer, schedule_follow_up, escalate, do_nothing |
| ordered | confirm_order_intent, request_address (fix), answer, payment_reminder (only if an online-payment claim is pending — COD never gets one), escalate, do_nothing |
| confirmed / in_delivery | answer (WISMO), proactive_ping (shipped / COD-ready), escalate, do_nothing |
| delivered | answer, ask_review (gated, D10), recommend_product (refill, organic inbound only), escalate, do_nothing |
| at_risk | confirm_order_intent, request_address, proactive_ping (delivery-save), escalate (fast path), do_nothing |
| retained / repeat_buyer | answer, create_order (reorder), schedule_follow_up, do_nothing |
| dormant | reactive only: answer, create_order — proactive win-back is Reach's job (D10) |
| lost | answer (reactive only), escalate — **no proactive candidate ever** |

**When NBA runs:** (1) every inbound turn (module 02 injects the block before composing); (2)
every fired follow-up job (fresh block — the world moved); (3) every proactive trigger (the
trigger nominates a candidate; NBA gates it). It does NOT run on a timer per customer — no event,
no sweep hit, no NBA. Silence at rest is free.

### D7. Scheduled follow-ups — the commitment system

**Storage: NovaJob kind `followup` — no new model.** A commitment is exactly what NovaJob already
models (dueAt, priority, per-tenant dedupe, lease/fencing, retry). One kind serves both NBA
follow-ups and promise fulfillment — `payload.promiseId?` distinguishes (canonical C-15; promise
semantics owned by module 03).

- `JOB_KINDS` += `'followup'`, `'journey_sweep'`; `PRIORITY_BY_KIND` += `followup: 3`,
  `journey_sweep: 6`. Priorities 1–2 stay reserved for module 01's fast lane.
- `followup` has no cron def — event-scheduled only. dedupeKey
  `followup:<conversationId>:<dueAtISO>` (dueAt in the key because `[tenantId, dedupeKey]` is
  unique forever — a done row must not block future commitments).
- payload: `{ conversationId, journeyId, reason, plannedIntent, scheduledByActionId, chainCount,
  promiseId? }`.
- `journey_sweep`: daily cron, tenant tz 10:00 local, dedupe per-tenant per-date. One kind for all
  time-based journey work: dormancy, retained promotion, delivery stagnation (→ at_risk),
  slot-filling abandonment, repeat-purchase windows (D10), review arming (D10) — plus the
  case-expiry pass whose logic module 06 owns. NovaJobDef config:
  `{ dormancyDaysLead: 30, dormancyDaysCustomer: 45, stagnationDays: 4, retainedQuietDays: 7 }`.

**The `schedule_follow_up` verb** (full new-verb checklist): RISK_CLASS **low** ·
`MINUTES_BY_ACTION: 1` · TARGET_TEXT extractor over `reason` + conversation subject (Bangla NFC) ·
department from `DEPARTMENT_BY_INTENT[plannedIntent]` · targetRef `inbox_conversation:<id>` ·
**undoable** (undo = cancel the job) · **bookkeeping verb** (module 08 SS8 carve-out) — executes at
every tier including T0; it sends nothing customer-visible, and the later send is gated on its own. Executor calls `POST /api/v1/inbox/followups`: validates delay ∈ `allowedDelays`
from the NBA block (`2h | 4h | 24h | 3d`; 3d only for delivered/retained stages — the model picks
from the list, it cannot invent "in 10 minutes" pressure loops), applies quiet-hour shifting, and
enforces **one outstanding follow-up per conversation** — an existing `due` followup is superseded
(`status:'skipped'`, `lastError:'superseded'`) before the new row is created. **Exemption:** jobs
carrying `payload.promiseId` (promise fulfillment, module 03) are NEVER superseded by NBA
follow-ups — supersession applies only to plain NBA rows.

**Firing** — dispatcher claims the job → runtime receives the payload → deterministic re-check
sequence BEFORE the model speaks:

1. `journey.lastInboundAt > scheduledAt`? → customer replied since; complete
   `skipped:customer_replied` (belt-and-suspenders under the ingest cancel hook).
2. Thread not Nova's (`handledBy='founder'` / `novaLockedAt` / `novaEnabled:false`)? →
   `skipped:thread_owned`.
3. Window closed (fire-time re-check — **mandatory**, canonical C-28: Meta counts from last
   inbound; scheduling does not extend the window)? → `skipped_window` receipt, surfaces in the
   brief as "would have sent".
4. Quiet hours now (the job may have been delayed by lease retries)? → re-lease with dueAt = next
   allowed time; don't send.
5. Touch budget exhausted / `unansweredProactiveStreak ≥ 2`? → `skipped:touch_budget`.
   Exception: RTO-critical `confirm_order_intent` jobs skip the budget check only (D8 exemption,
   OQ-11) — the window, quiet-hours, and streak checks above still apply to them.

Then and only then: fresh NBA block → model composes → `send_inbox_reply` through the normal gate.
`chainCount` increments; a follow-up may schedule at most one successor (**chainCount ≤ 2** — after
two unanswered follow-ups on one chain, stop until the customer returns).

**Cancellation on inbound** (hook wired in module 01 D2 step 4, semantics owned here): the ingest
transaction marks `due` followups for the conversation `skipped / cancelled:customer_replied`,
resets `unansweredProactiveStreak = 0`, updates `lastInboundAt`. A `leased` followup mid-flight is
caught by re-check #1. The cancelled commitment's ledger action is not rewritten — the scheduling
was real and stays receipted; the founder's commitments list simply no longer shows it.

Example follow-up send (slot-filling stalled, trigger #12):
`আপা, শাড়িটা কি নিবেন? ঠিকানাটা দিলে আজকেই পাঠানোর ব্যবস্থা করি 🙂`
(*Apa, sharee-ta ki niben? Thikana-ta dile ajkei pathanor babostha kori* — "Apa, will you take the
saree? Give me the address and I'll arrange to send it today.")

### D8. Quiet hours + touch caps — the timing conscience (req #5)

Flat keys in `NovaGuardrails.platform` (canonical §2.11 — the nested `inboxTiming` object is
killed):

```jsonc
"inbox.quietHours": { "start": "23:00", "end": "08:00" },   // tenant tz, default Asia/Dhaka
"inbox.maxProactiveTouchesPerWeek": 4,
"inbox.maxUnansweredProactiveStreak": 2
```

- Quiet hours apply to **Nova-initiated sends only** (follow-ups, proactive pings, recovery).
  Reactive replies to a customer who just messaged are always allowed — a human shopkeeper answers
  a 1 a.m. "dam koto?" and so does Nova. Defaults reflect BD DM commerce (shopping peaks
  21:00–23:00, so quiet starts 23:00).
- Touch counting: `touchesThisWeek` increments only on **executed** proactive sends — the `/reply`
  route increments it when the request carries `proactive:true` (set only by follow-up/trigger
  paths, never by turn replies). Resets lazily when `weekStartAt + 7d` passes (checked in the NBA
  lib). Skips and reactive replies never count. **Reactive-never-budgeted is test-pinned** — a bug
  that budgets reactive replies would silently starve legitimate answers.
- **RTO exemption (OQ-11, founder-resolved 2026-07-25):** RTO-critical pre-dispatch
  confirmations — `confirm_order_intent` sends on at-risk orders (module 06 movement 1) — are
  exempt from `inbox.maxProactiveTouchesPerWeek`: the NBA eligibility gate never returns
  `touch_budget_reached` for them. They remain fully bound by the 24h window, quiet hours, and
  the unanswered-streak cap, and they still increment `touchesThisWeek` (flagged `rtoExempt` in
  telemetry) so overuse stays visible. Rationale: a returned parcel costs far more than one
  extra ping. No other trigger is exempt.
- Missing keys fail closed per the guardrail invariant: absent `inbox.quietHours` reads as the
  default (quiet enforced), absent caps read as the defaults — never as "unlimited".

### D9. Proactive trigger map (req #19 — the complete answer)

Every Nova-initiated send, its detector, legality, and autonomy default. All sends require the
thread to be Nova's (never ping an owned thread) and pass the D7 re-checks. "Window" = Meta 24h;
v1 has no MESSAGE_TAG support, so out-of-window = `skipped_window` receipt or prepared card,
honestly. Autonomy is expressed through the canonical mechanism: a send executes only when tier ≥
T1 AND its purpose slug ∈ `inbox.autoIntents` (fail-closed founder-editable allowlist) — rows
whose default purpose is outside the default list draft until the founder extends the key. The
Dept column is derived deterministically from `DEPARTMENT_BY_INTENT` — trigger rows never
override it (`delivery_issue` → shipping, `general` → support, win-back → sales).

| # | Trigger | Detector (exact) | Purpose slug | Window v1 | v2 w/ tags | Default behavior | Dept |
|---|---|---|---|---|---|---|---|
| 1 | Order recap after chat order | in-flow after `create_order_from_chat` (in-window by construction) | `checkout_help` | always legal | — | auto at T1+ (in default allowlist) | sales |
| 2 | Pre-dispatch COD/intent confirm (RTO-save) | `order.created` drain → journey `ordered` + conversation linked | `cod_confirm` | send if open, else prepared card | POST_PURCHASE_UPDATE | draft (slug not in default allowlist; founder may add; module 06 owns the flow) | shipping |
| 3 | Shipped notification + tracking link | `order.updated` SHIPPED (courier webhook) | `order_status` | if open, else skip | POST_PURCHASE_UPDATE | auto at T1+ | shipping |
| 4 | COD-ready reminder (out-for-delivery) | `order.updated` raw status maps out-for-delivery | `delivery_eta` | if open, else skip | POST_PURCHASE_UPDATE | auto at T1+ | shipping |
| 5 | Delivery-delay apology + status | sweep stagnation rule (`courierSentAt`+4d, status unchanged 48h) → at_risk | `delivery_issue` | if open, else prepared card ("window closed — call them?") | POST_PURCHASE_UPDATE | draft (not in default allowlist); module 06 flow | shipping |
| 6 | Failed delivery attempt → reschedule intake | courier failed-attempt status → at_risk | `delivery_issue` | if open, else prepared card | POST_PURCHASE_UPDATE | draft; module 06 flow | shipping |
| 7 | Stock issue on open order | `order.item_unfulfillable` event (module 06 wires the hook) | `general` | if open, else prepared card | POST_PURCHASE_UPDATE | **draft at all tiers** (bad news + alternatives = founder judgment early) | support |
| 8 | Payment problem (claim rejected) | `payment.claim_rejected` event (module 05 producer) | `payment_claim` | if open, else card | not tag-legal — card | draft always | finance |
| 9 | Restock of asked-for product | sweep joins `stageData.askedProductIds` × stock 0→positive | `availability_check` | if open, else **skip silently** (marketing-shaped, no legal tag) | window-only | auto at T1+ | sales |
| 10 | Expiring offer reminder | sweep: in-thread Coupon (`novaActionId` set) expiring <24h, unused | `price_query` | if open, else skip silently | window-only | auto at T1+, max ONE reminder per coupon | sales |
| 11 | Abandoned cart recovery | `cart.abandoned` event → cart-recovery flow (module 05) | `cart_recovery` | if open, else `skipped_window` | window-only (tags not legal for promos) | draft (slug not in default allowlist; T-something founders extend) | sales |
| 12 | Abandoned chat checkout (slot stall) | sweep: `negotiating` + slotState incomplete + no inbound 4h → followup job | `checkout_help` | followup path (D7) | window-only | auto at T1+ via schedule_follow_up + send gate | sales |
| 13 | Repeat-purchase window | sweep refill-cycle math (D10) | `upsell` | almost always closed → **prepared card** ("repeat window open for Rahima — suggest SMS via Reach or wait") | window-only; Reach/SMS owns out-of-window | prepared card v1 | sales |
| 14 | Review ask post-delivery | delivered + positive/neutral organic inbound reopens window (D10 arming; module 07 flow) | `review_ask` | organic-window only (by design) | keep organic anyway | draft by default (slug not in allowlist); founder may extend at T1+ | support |
| 15 | Win-back for dormant | sweep dormancy → segment feed to Reach; Messenger only if customer returns | — | window closed by definition → **never a v1 Messenger send** | tags don't cover it honestly | Reach machinery (prepared, own consent) | sales |

Rows 13/15 deliberately hand off to Stage 6 Reach instead of pretending Messenger can do it: the
journey engine detects and segments; Reach sends (when a real provider lands). Until then,
prepared cards — honest. Shadow week (T0): ALL rows draft regardless of this table; the defaults
apply post-shadow.

Sample copy (in-window sends this module specifies):
- Restock (#9): `ভাই, যে কালো শার্টটা খুঁজছিলেন — আবার স্টকে এসেছে। রেখে দিবো একটা?`
  (*Bhai, je kalo shirt-ta khujchhilen — abar stock-e eshechhe. Rekhe dibo ekta?* — "Bhai, the
  black shirt you were looking for is back in stock. Shall I keep one for you?")
- Expiring offer (#10): `আপনার কুপনটা কালকে শেষ হয়ে যাবে — আজ অর্ডার করলে ছাড়টা পেয়ে যাবেন।`
  (*Apnar coupon-ta kalke shesh hoye jabe — aj order korle chhar-ta peye jaben.* — "Your coupon
  expires tomorrow — order today and you'll get the discount.")

### D10. Retention detection machinery (reqs #16/#18 detection; flows in 07)

**Repeat-purchase cycle math** (computed in `journey_sweep`, written to `stageData`):
- Personal cycle (preferred): ≥2 DELIVERED orders sharing a product or category →
  `medianGapDays` = median inter-order gap. Reorder window opens at
  `lastDeliveredAt + 0.8 × medianGapDays`, closes at `+1.5×`.
- Category prior (fallback): single-order customers get the tenant-level median gap for that
  category only if the tenant has ≥5 repeat samples in it; otherwise NO detection — no invented
  cycles. Category = product `categoryId`; consumable-ness is never guessed from names.
- Window opens → trigger #13 (prepared card naming customer, product, last order date, suggested
  message — copy owned by module 07, must name the actual previous product, e.g.
  `গতবারের প্রোটিন প্যাকটা প্রায় শেষ হওয়ার কথা — লাগবে আবার?` (*Gotobarer protein pack-ta pray
  shesh hoyar kotha — lagbe abar?*)). If the customer messages organically during an open window,
  the NBA block sets `priors.reorderWindowOpen` and `recommend_product` ranks first — the warmest
  possible upsell, grounded in their own history.

**Dormancy / won_back / lost**: thresholds in D4 (45d customers / 30d never-ordered leads,
personal-cycle-adjusted; 180d → lost). v1 honesty: Messenger cannot legally open a conversation
with a dormant customer, so win-back v1 = the journey engine feeds the `dormant` segment to
Reach's NovaSegment machinery + a weekly founder digest line. The `won_back` transition counts on
ANY new order from a dormant journey — including ones the founder's own SMS/offline effort caused;
`causedByActionId` stays null unless Nova's direct action preceded it (D11). No stolen credit.

**Review-eligibility arming** (steps 1–2 here; ask flow, unhappy gate, and copy in module 07):
1. Order DELIVERED → sweep sets `stageData.reviewEligibleAt = deliveredAt + 2d`.
2. `ask_review` becomes NBA-eligible only when: stage ∈ delivered/retained/repeat_buyer,
   `reviewEligibleAt` passed, `stageData.reviewAsks[orderId]` unset for the order in question
   (once per order, ever — per-order `reviewAsks` map, module 07's shape is canonical), window open
   **organically** (the customer messaged post-delivery — v1 never synthesizes a ping to ask), and
   module 07's unhappy gate passes (any complaint/return intent, negative sentiment, or open
   at_risk/escalation → ineligible, reason `unhappy_gate`).

### D11. Stage goals + `journey.*` metrics (computed here, written by module 09's night_ops pass)

Fixed `stageGoal` strings and the transition each stage's success counts:

| Stage | Goal | Success transition ⇒ metric |
|---|---|---|
| stranger | learn what they want | → inquirer/qualified_lead (not a metric — vanity) |
| inquirer | answer fully + capture identity | → qualified_lead ⇒ `journey.leads_qualified` |
| qualified_lead | get the order | → ordered ⇒ `journey.leads_converted` |
| negotiating | close at best margin | → ordered ⇒ `journey.negotiations_closed` |
| ordered | confirmed intent + clean address | → confirmed ⇒ `journey.orders_confirmed` (same underlying transition module 09's `addresses_confirmed` reads — one event, two lenses) |
| confirmed/in_delivery | delivered, not RTO'd | → delivered ⇒ `journey.deliveries_completed`; at_risk→delivered feeds `rto_saves` (strict definition owned by module 09) |
| delivered | happy + reviewed | → retained ⇒ `journey.retained`; `journey.reviews_asked` |
| at_risk | save the order/relationship | → resumeStage/delivered ⇒ `journey.at_risk_recovered` |
| retained/repeat_buyer | next order | won_back-free reorder ⇒ `journey.repeat_orders` |
| dormant | one more chance | → won_back ⇒ `journey.winbacks` |
| lost | leave the door open | (no metric — you don't score goodbyes) |

All `journey.*` metrics are **counts of `JourneyTransition` rows** (`toStage` + time window),
written nightly into `NovaScoreMetric` by the same night_ops grading step — zero new metric
plumbing. Deliberately NOT metrics: messages sent, stage dwell-time targets, stranger→inquirer
counts — vanity or gameable. **`leads_converted` refinement** (binding on module 09):
"New customers from DM" = `JourneyTransition {toStage:'ordered'}` rows whose journey had no prior
DELIVERED order — replacing the ad-hoc conversation→customer→orders join; same meaning, sturdier
source, tile unchanged. `carts_recovered_via_chat` and `rto_saves` definitions stay owned by
module 09 — this module feeds them events only.

**Honest causation** (`causedByActionId` set ONLY under the direct-cause rule):
`create_order_from_chat` executed → the `→ordered` transition carries that actionId; cart-recovery
reply → in-thread reply → order from that conversation within 72h → the recovery reply's actionId
(same convention as the nightly cart attribution); `confirm_order_intent` writeback →
`→confirmed` carries it. Everything else: `causedByActionId: null`, `cause` = the raw event. A
follow-up sent 5 minutes before a storefront checkout does **not** claim the order.

### D12. Recording `do_nothing` (proof of restraint, req #5)

The runtime reports each turn's classified intent AND chosen NBA action via
`POST /api/v1/inbox/journeys/:id/intent-observed` (one callback per turn). When
`nbaAction === 'do_nothing'`: update `stageData.lastNba = {action, reason, at}` and write a
same-stage marker row `JourneyTransition {fromStage = toStage, cause:'nba.do_nothing',
evidenceRef:'inbox_message:<lastInboundId>'}`. `journey.silences_chosen` = nightly count of those
rows — which keeps the canonical rule literally true that every `journey.*` metric derives from
`JourneyTransition` rows. Marker rows (`cause` prefixed `nba.` / `journey.unmapped_event` /
`journey.merged`) are excluded from stage-transition metrics by `toStage != fromStage` filters.

---

## Data model

New models (full):

```prisma
// One live journey per human-per-tenant. Subject identity is progressive:
// starts as a conversation, upgrades to a normalized phone, links to a
// Customer when one materializes. Phone (normalized 01XXXXXXXXX) is the
// merge key, mirroring Customer @@unique([tenantId, phone]).
// conversationId / customerId are PLAIN STRINGS (no FK): journeys are
// commerce history and must survive Meta data-deletion hard-deletes.
model CustomerJourney {
  id              String    @id @default(cuid())
  tenantId        String
  conversationId  String?   // InboxConversation.id — chat-born journeys
  phoneNormalized String?   // normalizePhone() output — set when known
  customerId      String?   // set when a Customer materializes (order created)
  stage           String    // D3 enum
  stageEnteredAt  DateTime  @default(now())
  previousStage   String?
  resumeStage     String?   // set while in interrupt stage at_risk
  stageData       Json      @default("{}") // per-stage scratch, shapes in D4
  lastInboundAt   DateTime? // last customer message across linked conversations
  lastOrderAt     DateTime?
  touchesThisWeek Int       @default(0)   // executed proactive sends only
  weekStartAt     DateTime?
  unansweredProactiveStreak Int @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([tenantId, phoneNormalized])
  @@unique([tenantId, conversationId])
  @@index([tenantId, stage, stageEnteredAt])
  @@index([tenantId, customerId])
}

// Append-only. THE source for every journey.* metric — counts derive from
// these rows, never from model claims.
model JourneyTransition {
  id               String   @id @default(cuid())
  tenantId         String
  journeyId        String
  fromStage        String
  toStage          String
  cause            String   // machine event ('order.created', 'sweep.dormancy', 'journey.merged', 'nba.do_nothing', …)
  evidenceRef      String?  // 'order:<id>' | 'lead:<id>' | 'inbox_message:<id>' | 'job:<id>'
  causedByActionId String?  // NovaAction.id ONLY under the D11 direct-cause rule
  at               DateTime @default(now())

  @@index([tenantId, toStage, at])
  @@index([tenantId, journeyId, at])
}
```

Migration notes:
- No backfill: journeys materialize as events arrive (rule D1.5 — no fabricated journeys).
  Optionally, a one-shot idempotent seed walks existing Orders per tenant to create phone-keyed
  journeys at their current commerce stage — run behind a flag, writes `cause:'journey.seeded'`.
- Both `@@unique`s are on nullable columns — Postgres allows multiple NULLs, so phone-less and
  conversation-less rows coexist safely.
- **Meta data-deletion**: module 01's handler does NOT delete journeys (no FK, deliberately). It
  nulls `conversationId` on any journey referencing a deleted conversation and strips
  `linkedConversationIds`; stage/commerce history survives.
- No schema change to `NovaJob`, `NovaJobDef`, `NovaGuardrails` — new kinds and flat JSON keys
  only.

---

## APIs & interfaces

### dakio-api — service surface (`authenticateNovaService + requireTenant`, in `src/routes/novaInbox.js`)

| Method & path | Body → Response | Notes |
|---|---|---|
| `GET /api/v1/inbox/nba/:conversationId` | → the D6 block | Read-only; assembles journey + customer + window + budget + candidates + priors; `inbox.c360.assembly_ms`-style timing logged |
| `POST /api/v1/inbox/followups` | `{conversationId, journeyId, delay:'2h'\|'4h'\|'24h'\|'3d', reason, plannedIntent, scheduledByActionId, promiseId?}` → `{jobId, dueAt, superseded?:jobId}` | `w()`-idempotent (key = scheduledByActionId); validates delay ∈ allowedDelays for the journey's stage; quiet-hour shifts dueAt; supersedes the existing `due` followup for the conversation |
| `POST /api/v1/inbox/journeys/:id/intent-observed` | `{intent, messageId, nbaAction?, nbaReason?}` → `{stage, transitions:[…]}` | Pass-2 reducer: intent → transition table; writes `InboxConversation.lastIntent`; records `do_nothing` (D12). Idempotent per (journeyId, messageId) |

### dakio-api — merchant surface (JWT, `src/routes/novaDashboard.js`)

| Method & path | Response | Notes |
|---|---|---|
| `GET /api/nova/followups` | `[{jobId, dueAt, conversationId, conversationSubject, reason, promiseBacked}]` | Due `followup` jobs — the founder's "Nova's promises" list (rendered by module 10) |
| `POST /api/nova/followups/:jobId/cancel` | `{ok}` | Same updateMany as the inbound hook with `lastError:'cancelled:founder'` |

### nova-ai

**Verb registration** (`schedule_follow_up`, full checklist):

| Item | Value |
|---|---|
| `agent/lib/types.ts` ActionType | += `schedule_follow_up` |
| `agent/lib/nova/schemas.ts` | `scheduleFollowUpPayload {conversationId, journeyId, delay, reason, plannedIntent, promiseId?}` |
| `agent/lib/nova/autonomy.ts` RISK_CLASS | `low`; no guardrail branch — bookkeeping verb (module 08 SS8 carve-out): executes at every tier including T0 (sends nothing customer-visible; the later send is gated) |
| `agent/lib/nova/authority.ts` TARGET_TEXT | reason + conversation subject, Bangla NFC-normalized |
| `agent/lib/nova/activity.ts` MINUTES_BY_ACTION | `1` |
| Executor | `agent/lib/nova/executors.ts` → `POST /api/v1/inbox/followups`; dakio-api `EXECUTORS.schedule_follow_up` no-op passthrough (already-executed rows) |
| Undo | cancel the job (inverse registered; `undoable: true`) |
| Department / DOOR_OF | from `DEPARTMENT_BY_INTENT[plannedIntent]`; targetRef `inbox_conversation:<id>` → door `inbox` |
| Duty | rides `support.inbox_replies` / `sales.inbox_cart_recovery` per department (minLevel 2) |

**Tool** `schedule_follow_up` (slim in-conversation set, canonical §2.4): inputSchema =
`scheduleFollowUpPayload`; the runtime injects the NBA block's `allowedDelays` so the model picks
from the list. **Runtime contract additions to module 02**: fetch/compose the NBA block each turn
(`get_conversation` response embeds it alongside the 360 block, trusted-framed, outside
`untrusted()`); after each turn, POST `intent-observed` with the classified intent + chosen NBA
action; on `followup` job delivery via the dispatcher lane, run the D7 re-check results the server
returns before composing.

**Job kinds**: `agent/lib/store/backend.ts` + `dakio-api src/routes/novaJobs.js` — `JOB_KINDS` +=
`followup`, `journey_sweep`; `PRIORITY_BY_KIND` += `{followup: 3, journey_sweep: 6}`;
`journey_sweep` NovaJobDef seeded per tenant (daily, tenant tz 10:00) with the D7 config.

---

## Files touched

**dakio-api (`develop`)**
- `prisma/schema.prisma` — `CustomerJourney`, `JourneyTransition` (new models)
- `src/lib/novaJourney.js` (new) — `advanceJourney` reducer, transition table, merge rule,
  `findJourneyForConversation`
- `src/lib/novaNba.js` (new) — eligibility, reason codes, priors, per-stage matrix, block assembly,
  touch-budget lazy reset, quiet-hour math
- `src/routes/novaInbox.js` — `GET /nba/:conversationId`, `POST /followups`,
  `POST /journeys/:id/intent-observed` (file mounted by module 01)
- `src/routes/novaJobs.js` — `JOB_KINDS`/`PRIORITY_BY_KIND` additions; `journey_sweep` def seed;
  drain stubs (module 01 D2 steps 4–5) replaced with real reducer + cancel semantics
- `src/routes/novaDashboard.js` — `GET /api/nova/followups`, `POST /api/nova/followups/:jobId/cancel`
- `src/lib/novaExecutors.js` — `EXECUTORS.schedule_follow_up` (approve-path passthrough)
- `src/routes/novaReach.js` — opt-out handler emits the `channel.opted_out` event (producer for the
  `lost` transition this module consumes)
- guardrail defaults doc — `inbox.quietHours`, `inbox.maxProactiveTouchesPerWeek`,
  `inbox.maxUnansweredProactiveStreak` in the `inbox.*` key registry

**nova-ai (`develop`)**
- `agent/lib/types.ts` — ActionType += `schedule_follow_up`
- `agent/lib/nova/schemas.ts` — `scheduleFollowUpPayload`
- `agent/lib/nova/autonomy.ts` / `authority.ts` / `activity.ts` — RISK_CLASS, TARGET_TEXT,
  MINUTES_BY_ACTION entries
- `agent/lib/nova/executors.ts` — followups executor
- `agent/tools/schedule_follow_up.ts` (new) — tool on the performAction pattern
- `agent/lib/store/client.ts` + `dakio.ts` — `getNba(conversationId)`, `scheduleFollowup(…)`,
  `postIntentObserved(…)`
- `agent/channels/customer.ts` / `agent/channels/internal.ts` — NBA block injection + turn-end
  intent-observed callback + followup-job re-check plumbing (contract owned here, wiring with 02)

---

## Testing

**dakio-api** (node:test, files added to the package.json test list):

- `test/nova-journey.test.js` (new)
  1. Given a storefront `order.created` for a phone with no journey, when drained, then a journey
     is created directly at `ordered` with exactly one transition row and no backfilled stages.
  2. Given the same courier webhook delivered twice (same order+status dedupe), when drained,
     then exactly one `in_delivery` transition exists (reducer idempotence).
  3. Given a conversation-keyed journey at `negotiating` and a phone-keyed journey at
     `repeat_buyer` for the same normalized phone (`+8801…` vs `01…` raw forms), when the identity
     link lands, then one row survives (phone-keyed), stage `repeat_buyer`, one `journey.merged`
     transition, loser deleted, conversation lookup still resolves.
  4. Given an unknown courier status string, when drained, then no stage change and one
     `journey.unmapped_event` marker row exists.
  5. Given `optedOutAt` set (`channel.opted_out`), then journey → `lost` and every proactive
     candidate is ineligible while `answer` stays eligible on inbound.
- `test/nova-nba.test.js` (new)
  1. Given a `delivered` journey with `reviewAsks[orderId]` set for its active order, when the block is assembled, then
     `ask_review` is ineligible with reason `stage_not_…`/gate reason, and `escalate` +
     `do_nothing` are eligible in EVERY assembled block (pinned invariant).
  2. Given quiet hours now, then `proactive_ping` ineligible `quiet_hours` but `answer` eligible
     (reactive-never-budgeted — pinned).
  3. Given 4 executed proactive touches this week, then `touch_budget_reached`; a reactive reply
     does not increment `touchesThisWeek` (pinned).
- `test/nova-followups.test.js` (new)
  1. Given an existing `due` followup for a conversation, when a second is scheduled, then the
     first is `skipped/superseded` and exactly one `due` row remains.
  2. Given a scheduled followup and a customer reply before dueAt, when ingest runs, then the job
     is `skipped/cancelled:customer_replied` and no send occurs.
  3. Given a followup whose window closed between schedule and fire, when fired, then
     `skipped_window` receipt, no Graph call (fire-time re-check — pinned, C-28).
  4. Given `chainCount = 2`, when the model tries to schedule a successor, then the route rejects
     it and the chain stops.
  5. Given a dueAt inside quiet hours after lease retries, when fired, then the job is re-leased
     to `nextAllowedAt`, not sent.

**nova-ai**: suite additions — `schedule_follow_up` verb registration completeness (union, schema,
RISK_CLASS, TARGET_TEXT with Bangla input, MINUTES, executor mapping); NBA-block injection framed
trusted (outside `untrusted()`); model choosing an ineligible candidate produces a receipted
authority refusal, not a send. Isolation suite: `GET /nba/:conversationId` cross-tenant returns
404 under a foreign service token.

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Reducer coverage drift — a new order status or courier string strands journeys mid-stage | medium | Unknown statuses are no-op + `journey.unmapped_event` marker rows surfaced in night_ops; never guess |
| One human becomes two journeys via un-normalized phones (all three creation paths store raw phones) | high without discipline | `normalizePhone`/`phoneVariants` mandatory at every reducer key lookup — test 3 pins it |
| Touch-cap false comfort — reactive replies mis-counted as proactive starves legitimate answers | low | `proactive:true` only settable by job/trigger paths; reactive-never-budgeted test-pinned |
| Model picks ineligible candidates | expected occasionally | Authority gate catches it, receipts a refusal; refusal-rate monitored as a prompt-quality signal, not a gate failure |
| Worst customer-facing failure: a follow-up fires after the founder took the thread or after the window closed — Nova barging in or a Meta policy strike | low | Five-step fire-time re-check (thread state, window, quiet, budget, replied-since) all deterministic and before the model speaks; each skip is receipted |
| Dormancy math on thin history (2-order cycles are noisy) | medium | 0.8–1.5× band + prepared-card-only default for trigger 13 keeps mistakes cheap |
| `journey_sweep` fan-out at 10k+ journeys/tenant | low today | Cursoring inside the job noted for module 12's perf gate |
| Marker rows (`nba.do_nothing`) inflating transition-table volume | low | Cheap indexed rows; excluded from stage metrics by cause prefix; retention policy can prune >90d markers if needed |

---

## Gate

Scripted demo on a clean staging store, runnable by a non-builder:

1. Send "dam koto?" from a test Messenger account → conversation appears; after the turn,
   `CustomerJourney` shows `inquirer` with one transition row `cause:'intent.observed'`.
2. Place a storefront order with the same phone (different format, `+880…`) → journey merges into
   one row at `ordered`; the merchant UI conversation still resolves the journey.
3. Ask Nova to follow up ("size ta pore janabo") → `GET /api/nova/followups` lists one commitment
   with dueAt; cancel it from the same surface → it disappears and the job row reads
   `cancelled:founder`.
4. Schedule another follow-up, then reply as the customer before it fires → job shows
   `cancelled:customer_replied`; no send occurred.
5. Flip the staging clock into quiet hours and force-fire a followup → job re-leased to 08:00,
   nothing sent.
6. Run `journey_sweep` manually → a 45-day-silent seeded journey moves to `dormant` with a
   transition row; nothing was sent to it.
7. Verify `journey.*` numbers in the metric preview equal `SELECT count(*)` over
   `JourneyTransition` for the same window (every founder-visible numeric traces to rows).

Measurable checks: reducer idempotence test suite green; the three pinned invariants
(escalate/do_nothing always eligible; reactive-never-budgeted; fire-time window re-check) green in
CI; zero `journey.unmapped_event` rows after replaying the staging courier-webhook corpus.

**Rollback (no deploy):** pause `journey_sweep` by disabling its NovaJobDef row (existing kill
path — no cron, no fires); `followup` has no NovaJobDef cron row (event-scheduled only) — pause it
via module 12's `NOVA_PAUSED_JOB_KINDS`, not job-def disabling; set `inbox.maxProactiveTouchesPerWeek: 0` (fail-closed:
every proactive candidate ineligible `touch_budget_reached`, reactive replies unaffected); the
reducer keeps recording stages passively — it sends nothing by itself, so journeys stay warm for
re-enable. Per-thread and per-tenant kill switches from modules 01/08 apply on top.

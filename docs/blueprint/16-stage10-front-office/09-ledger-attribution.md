# Module 09 — Ledger & Attribution: receipts, departments, metrics, achievements

**Phase:** 16 "Front Office" · **Depends on:** 02 (+05/06 verbs as they land) · **Feeds:** 10, 11, 12
**Repos touched:** dakio-api | nova-ai | dakio-merchant
**Founder requirements covered:** #26 (complete action logging), #27 (outcome-based measurement), #28 (department attribution), #29 (department achievements), plus the ledger-verified inputs half of #34 (trust formula and promotion mechanics live in module 11)

Dept-room visibility requires only correct `department` strings on `NovaAction`/`NovaActivity`
plus `minutesSaved`/`revenueInfluence` — the existing pipes do the rest. This module therefore
adds almost no new plumbing: it is the **authority for the values that flow through those pipes**
(the canonical MINUTES table, the `DEPARTMENT_BY_INTENT` map, receipt and revenue conventions,
the outcome-metric registry) plus two genuinely new pieces — the nightly inbox-attribution pass
that flips estimates to measured truth, and the `NovaAchievement` model (E-28) with its nightly
evaluator. Every founder-visible inbox number traces to rows written here or specified here.

---

## Already real vs to build

| Already real (recon evidence) | This module adds |
|---|---|
| `performAction → evaluateAuthority` verdict mapping; blocked/refused actions are **full receipted rows** with the fired rule as evidence (`actions.ts:93-204`, `:109-135`) | Nothing — inbox verbs inherit it; blocked rows render as `BLOCKED` chips in dept-room HISTORY for free |
| `MINUTES_BY_ACTION` is `Record<ActionType, number>` — TypeScript forces an entry per verb (`activity.ts:14-28`); `recordActivity` writes `{department, kind, minutesSaved, revenueInfluence, revenueBasis:'estimated', actionId, relatedId}` (`activity.ts:52-72`) | The 13 inbox entries with canonical values (D2 table — this doc is the value authority) |
| Department attribution to rooms = the `department` string on each row, nothing fancier (`activity.ts:84-118`; room slice at `novaDashboard.js:690-710`) | `DEPARTMENT_BY_INTENT` — the deterministic intent→department constant (D3) |
| Founder-approve path writes the activity via `runActionExecution` (`novaExecutors.js:288-307`); dakio-api `EXECUTORS` entries carry `activity:{department, kind, minutesSaved}` (`novaExecutors.js:41-88`) | Rule: approve-path activity values MUST equal the D2 table (one authority, two writers) |
| `ATTRIBUTABLE` map stamps `novaActionId` on door rows; unknown targetRef types are a silent no-op (`novaLedger.js:53-64`, `:72-81`) | `inbox_message` + `order` entries (D5) |
| `DOOR_OF` targetRef→door map powers presence dots (`novaDashboard.js:165-173`); sidebar pulses on `pending > 0` via `novaDoor` (`Sidebar.jsx:29`) | `inbox_message`/`inbox_conversation`/`case` → `'inbox'` entries + `novaDoor:'inbox'` on the Inbox nav item |
| `DEPT_KEYS` already includes support/sales/shipping/marketing/finance/inventory; `DEPT_ALIASES` maps agent strings to room keys (`novaDashboard.js:684-688`) | Nothing — verified no-op (all inbox departments are already room keys) |
| `NovaScoreMetric` rows fill dept-room scorecards, written atomically via POST `/agent-data/departments` (`schema.prisma:1617-1630`; `nova.js:1016-1045`; consumed at `useNovaRoom.js:43-62`) | The 12 v1 scorecard computations + the full metric-key registry (D7) — no new metric storage |
| Nightly estimate→actual precedent: cart recovery writes `revenueInfluence = cart.value * 0.25` ESTIMATE, "nightly attribution replaces it with actual" (`executors.ts:205-218`); rewrite path PATCH `/agent-data/activity` → `activity.updated` (`nova.js:563-578`); clients don't double-count updates (`novaDashboard.js:57-62`) | The inbox-attribution pass generalizing this pattern: delivered→measured, RTO→zeroed, cart credit, `rto_save` rows (D6) |
| `night_ops` job kind exists (`novaJobs.js:39`); dispatcher hands jobs to the internal channel (`dispatcher.ts:33-77`) | Deterministic pre-step in the night_ops handler calling the pass — the model session never computes a number |
| `enqueueNovaEvent` P2002-swallow idempotence pattern (`novaEvents.js:68-74`) | Reused verbatim for `NovaAchievement` once-ever inserts |
| `/nova/attribution` authorship split, measured-only, explicit `outcomeNote`, no lift claims (`novaDashboard.js:796-907`); `/nova/home` hours/revenue sums (`novaDashboard.js:759-794`) | `inbox` door + `{measured, estimated}` split on `revenueInfluencedToday` |
| `computeTrust` placeholder + `trustInputsFor` 30-day counts, isolated in `novaTrust.js` (`novaTrust.js:33-72`) | Nothing here — module 11 owns the formula; this module guarantees its inputs are queryable (D12) |
| Receipt enforcement at the API layer — evidence min 1, RECEIPT_REQUIRED errors (`nova.js:107-156`; `schemas.ts:31-48`) | Receipt shape conventions for inbox actions (customer text verbatim as first evidence, title grammar — D4) |
| Weekly report is client-computed over room data; no weekly endpoint (`NovaDeptRoomPage.jsx:152, 176-215`; `useNovaHours.js:8-11`) | `achievements[]` in the room payload → trophy strip + weekly achievement lines ride the same client computation |
| NDJSON ledger export (`novaDashboard.js:112-144`) | Nothing — `revenueProvenance` strings make every displayed figure reproducible from the export |
| `InboxMessage.novaActionId` / `actor` / `purpose` columns land in module 01 (`01-inbound-pipe.md` schema block); `Order.novaActionId` / `sourceConversationId` / `sourceChannel` land in module 05 (canonical §2.2) | The **indexes** on both (this module's only column-level migration work besides NovaAchievement) |
| OUT: `csat` — requires an in-chat rating ask; open founder question (bot-feel tension). Key named in the v2 registry, not built | — |
| OUT: `journey.reviews_collected` — dakio-store review submission carries no attributable token; ships as honest zero with `outcomeNote` (module 07 owns the flow) | — |
| OUT: server-side weekly rooms endpoint, `GET /nova/achievements` Command tile endpoint, NovaBenchmark network cohorts — v2 (module 12 tracks) | — |

---

## Objective

After this module ships, a founder opens any department room and sees Nova's inbox work as graded
tiles, receipted HISTORY rows containing the customer's actual Bangla text, and a trophy strip —
all computed from ledger and transition rows, never from model claims. Chat-order revenue starts
as a labeled estimate and becomes measured only when the parcel DELIVERs (zeroed on RTO); an
`rto_save` exists only when a flagged order was chat-confirmed and then actually delivered. The
Command MadeBySplit gains an honest inbox door, and hours-saved includes inbox minutes at
conservative per-verb constants. Every number is reproducible from the NDJSON export.

## Scope

**In:** the canonical MINUTES/attribution table for all 13 inbox verbs (values authoritative
here; registration mechanics live with each verb's owner module); `DEPARTMENT_BY_INTENT` +
`agent/lib/nova/inboxIntents.ts`; receipt conventions; plumbing edits (indexes, `ATTRIBUTABLE`,
`DOOR_OF`, sidebar `novaDoor`); the nightly inbox-attribution pass (`src/lib/novaInboxAttribution.js`)
inside night_ops — rewrites, metric computation, achievement evaluation; the full metric-key
registry (scorecard + `journey.*` + `case.*` + `inbox.promise.*` + `inbox.identity.*` +
`inbox.disclosure.*` + telemetry + module 05/07 contributed keys); `/nova/attribution` inbox door;
`/nova/home` measured/estimated split; `NovaAchievement` model + nightly evaluator + v1 rule
catalogue; `achievements[]` in the rooms payload; the dept-room trophy strip and weekly-report
achievement lines (dakio-merchant); trust-input queryability guarantees.

**Out (owner in parens):** verb registration mechanics — types.ts union, zod, RISK_CLASS,
TARGET_TEXT, executors (modules 02/03/04/05/06); `JourneyTransition` row production and the
reducer (module 04 — this module only counts its rows); `NovaCase`/`NovaPromise` row production
(modules 06/03); trust formula edits, promotion criteria, the seven trust-input predicates
(module 11 — this module makes them queryable); `FeedMilestoneRow`, `InboxTile`,
`DOOR_OUTCOME.inbox` client formatter, weekly INBOX verb-grouping, receipt-drawer UI (module 10);
morning-brief line rendering (module 10; data supplied here); `GET /nova/achievements` endpoint +
Command achievements tile, `csat`, `quote_to_order_rate`, `avg_replies_per_resolution`,
`broadcast_replies_handled`, milestone celebration chat message, NovaBenchmark cohorts,
per-conversation minutes cap (v2 — module 12 records).

---

## Design

### D1. Governing principle — values through existing pipes

One activity per executed action via the existing `recordActivity` path (agent execute) or
`runActionExecution`'s activity block (founder approve). No new activity plumbing, no new metric
storage, no live aggregation endpoint. Dept rooms, feed, `/nova/home` hours, presence dots, and
by:nova chips all light up from the `department` string + `minutesSaved`/`revenueInfluence` +
`novaActionId` stamps — the recon's core finding. Cross-cutting rule 7 binds everything below:
every founder-visible numeric traces to NovaAction/NovaActivity/JourneyTransition/NovaPromise/
NovaCase rows; estimates are labeled; **no surface may sum estimated and measured into one
figure**; revenue is estimated until DELIVERED and zeroed on RTO.

### D2. The canonical MINUTES + attribution table (the row-writing contract)

THE authoritative table for every inbox verb's attribution-bearing fields. Owner modules
implement registration; the **values** come from here, and the dakio-api `EXECUTORS` activity
blocks must carry identical numbers (one authority, two writers — a mismatch is a build error,
test-pinned in D13). Values are deliberately conservative vs `send_customer_message`'s 8: honest
hours-saved beats impressive hours-saved (conflict C-3: 3 beat 6 and 8).

| Verb (`NovaAction.type`) | dept | MINUTES | revenueInfluence at write | targetRef | undoable (inverse) | NovaActivity kind | relatedId |
|---|---|---|---|---|---|---|---|
| `send_inbox_reply` | `DEPARTMENT_BY_INTENT[intent]` (D3) | **3** | `0`; purpose `cart_recovery` → `cart.value * 0.25` estimated (existing convention, `executors.ts:205-218`) | `inbox_message:<firstMessageId>` | no (sent = sent) | `inbox_reply` | conversationId; cart-recovery replies → cartId (keeps the nightly cart join working) |
| `escalate_conversation` | tool param: support/sales/finance | **2** | 0 | `inbox_conversation:<id>` | no (the customer was told a human is coming) | `handover` | conversationId |
| `link_customer_identity` | support | **2** | 0 | `inbox_conversation:<id>` | yes (unlink) | `action` (generic) | customerId |
| `create_order_from_chat` | sales — **always**, regardless of opening intent | **12** | `Number(order.total)`, `revenueBasis:'estimated'`, `revenueProvenance:'chat_order:<orderId>'` | `order:<id>` | yes (cancel while PENDING) | `chat_order` | orderId |
| `verify_payment_slip` | finance | **4** | 0 (claim intake, never money) | `inbox_conversation:<id>` | no | `action` | orderId when linked, else conversationId |
| `offer_chat_discount` | sales | **10** | 0 (the order it enables is counted separately — never double-count) | `coupon:<id>` (existing `ATTRIBUTABLE` entry gives by:nova free) | yes (deactivate coupon) | `action` (approve path reuses `create_coupon` → `coupon_created`, `novaExecutors.js:41-88`) | couponId |
| `update_order_contact` | shipping | **5** | 0 | `order:<id>` | no | `action` | orderId |
| `cancel_order_from_chat` | support | **6** | 0 | `order:<id>` | no | `action` | orderId |
| `schedule_follow_up` | `DEPARTMENT_BY_INTENT[intent]` | **1** | 0 | `inbox_conversation:<id>` | yes (cancel job) | `followup_scheduled` | conversationId |
| `open_case` | case-kind map (module 06: delivery cases → shipping, `payment_unverified` → finance, `damaged_item` → support, `restock_wait` → inventory) | **3** | 0 | `case:<id>` | yes (close case) | `case_opened` | caseId |
| `flag_courier_issue` | shipping | **10** | 0 (ADVISORY — forced needs_approval always) | `case:<id>` | no | `action` | orderId |
| `confirm_order_intent` | shipping | **2** | 0 | `order:<id>` | no | `action` | orderId |
| `merge_customer_records` | support | **5** | 0 | `customer:<survivorId>` | no | `action` | survivor customerId |

System-authored rows (no verb — written by the nightly pass and case machinery, `actionId`
optional): `rto_save` (D6, department shipping, minutesSaved 0, revenueInfluence **always 0** —
a save is a count, never money), `achievement` (D9 projection, minutesSaved 0), `case_resolved`
(module 06's resolve path, department from the case-kind map).

**NovaActivity kinds are a closed set** (canonical §2.15): `inbox_reply`, `chat_order`,
`handover`, `rto_save`, `achievement`, `case_opened`, `case_resolved`, `followup_scheduled` —
plus the pre-existing generic kinds (`action`, `coupon_created`, `undo`). Founder-experience's
`chat_reply`/`chat_handover`/`chat_recovery`/`milestone` do not exist. Proactive pings, cart
nudges, review asks, holding lines, and loop-closer updates are all `send_inbox_reply` with a
`purpose` value — they write `inbox_reply` activities, never new kinds.

`escalate_conversation` executes at low risk (triage, not commerce) and ALSO authors a
`NovaDecision {kind:'escalation', tag:<DEPT>, actionId}` (module 08's transaction) so the
handover lands on all five decision surfaces for free — one decision per action holds
(`NovaDecision.actionId @unique`). Blocked and refused verbs write receipted rows with the fired
rule as evidence (`actions.ts:109-135`) and render as `BLOCKED · <rule>` chips in dept-room
HISTORY at zero UI cost — the founder sees Nova respecting the leash.

### D3. `DEPARTMENT_BY_INTENT` — one exported constant, never model-adjustable

Lives in **`nova-ai/agent/lib/nova/inboxIntents.ts`** next to `INBOX_LOW_CONFIDENCE = 0.55`
(canonical §2.5; module 02 consumes both). The classifier picks the intent; the map is
deterministic given the intent — model output proposes, never authorizes (same invariant as
`authority.ts:10-19`). Department strings are real `NOVA_DEPARTMENTS` members only
(`types.ts:513-524`).

```ts
export const DEPARTMENT_BY_INTENT: Record<InboxIntent, NovaDepartment> = {
  // sales
  price_query: "sales", product_question: "sales", availability_check: "sales",
  checkout_help: "sales", cart_recovery: "sales", lead_followup: "sales",
  upsell: "sales", winback: "sales",
  // support — `general` is the FALLBACK, never a guess
  order_status: "support", complaint: "support", return_refund: "support",
  general: "support", review_ask: "support",
  // shipping
  delivery_eta: "shipping", delivery_issue: "shipping",
  address_confirm: "shipping", cod_confirm: "shipping",
  // finance
  payment_claim: "finance",
  // marketing — Click-to-Messenger ad / boosted-post origin (Meta referral payload)
  ad_reply: "marketing",
};
```

Split rationale, documented in code: order placed but not shipped → support owns "is it
confirmed"; parcel with courier → shipping owns "where is it"; `delivery_issue` (courier
problems, failed attempts) → shipping; `payment_claim` → finance. `create_order_from_chat` is
always `sales` — closing revenue is a sales act even if the thread opened as support. The
case-kind→department map (module 06, `src/lib/novaCase.js`) is the sibling constant for
`open_case`; both are deterministic tables the model cannot edit.

### D4. Receipt conventions (E-8 compliant, renders in the existing drawer)

Same `receiptSchema` (`schemas.ts:31-48`) — no schema change. Conventions so dept-room receipt
drawers read well:

- **First evidence entry is always the customer's actual message, verbatim, Bangla preserved**:
  `{source:"inbox_message", metric:"customer_text", value:"eta dam koto vai?", note:"Inbound m_abc123 at 14:02, Messenger"}`.
  The founder opening any receipt sees what the customer said and what Nova knew, in one glance.
- Standard `source` values (min 2 chars enforced): `inbox_message`, `product_catalog`,
  `order_record`, `cart_record`, `customer_record`, `courier_status`, `conversation_history`,
  `assessment` (module 11's entry), `authority_gate` (auto-appended on blocked rows).
- Fixed title grammar — titles are the HISTORY line: `"Replied to <senderName> — <intent label>
  (<language>)"` · `"Created COD order #<orderNumber> from Messenger — ৳<total>"` ·
  `"Handed over to you — <senderName>, <reason short>"` · `"Confirmed COD intent — order
  #<orderNumber>"` · `"Opened case — <kind label>, order #<orderNumber>"`.
- Every ৳ amount, stock count, and ETA in a reply must appear in evidence with a tool source —
  the API refuses evidence-free receipts (`nova.js:107-156`); the fact-grounding CI eval
  (module 12) regexes reply text against evidence values.

### D5. Plumbing edits (dakio-api, exact)

1. **Indexes** (this module's migration; columns land in modules 01/05):
   `InboxMessage @@index([conversationId, novaActionId])` (ByNovaChip + first-reply latency) ·
   `InboxMessage @@index([conversationId, sentAt])` (first-reply/quiet-satisfied timestamp math —
   module 11's trust predicates share it) · `Order @@index([tenantId, novaActionId])` (chat-revenue
   joins, `/nova/attribution` inbox door).
2. **`ATTRIBUTABLE`** (`novaLedger.js:53-64`) — add
   `inbox_message: (tenantId, id, novaActionId) => prisma.inboxMessage.update(...)` and
   `order: (tenantId, id, novaActionId) => prisma.order.updateMany({where:{id, tenantId}, data:{novaActionId}})`.
3. **`DOOR_OF`** (`novaDashboard.js:165-173`) — add `inbox_message: 'inbox'`,
   `inbox_conversation: 'inbox'`, `case: 'inbox'` (module 06's linking section references this
   registry; the entry ships once, here). `order:` already maps to `orders` — a chat order lights
   BOTH doors, correctly: two doors were genuinely touched. Never a bare `'conversation'` key
   (canonical §2.17).
4. **Sidebar**: `novaDoor: 'inbox'` on the Inbox nav item (`Sidebar.jsx:29`) — pulses when a
   prepared reply/order awaits approval, via the existing 60s presence poll.
5. **`DEPT_ALIASES`**: verified no-op — `support`, `sales`, `shipping`, `marketing`, `finance`,
   `inventory` are already both agent department strings and room keys (`novaDashboard.js:684-688`).

### D6. The nightly inbox-attribution pass (the honesty engine)

**Where it runs — decision.** The pass is deterministic code in dakio-api:
`src/lib/novaInboxAttribution.js` exporting `runInboxAttribution(tenantId, day)`, exposed as
`POST /api/v1/inbox/attribution/run {day?}` (service token + requireTenant, `w()`-idempotent,
key `inbox_attr:<day>`). The nova-ai `night_ops` job handler (internal channel) calls
`client.runInboxAttribution()` as a **code pre-step before the model session composes anything**
— canonical §2.8's "night_ops (+inbox attribution pass, +achievement evaluator)" with the
arithmetic kept out of the model's hands. Order within the pass: (1) rewrites, (2) metric
computation + `POST /agent-data/departments` scorecard writes, (3) achievement evaluation (D9) —
so achievements always evaluate over current measured values. Day boundary is tenant-local
midnight (novaCron civil math, `novaDashboard.js:759-794` precedent).

**Rewrite table** (mirrors the documented cart pattern — PATCH `/agent-data/activity` →
`activity.updated`, `nova.js:563-578`; internally the lib updates rows directly and emits):

| Trigger (real DB state) | Rewrite |
|---|---|
| Chat order (`Order.novaActionId` set) reached `DELIVERED` | Its `chat_order` activity: `revenueBasis:'estimated'` → `'measured'`, `revenueInfluence` = final `order.total`, provenance `'chat_order:<id>:delivered'` |
| Chat order reached `RETURNED` (RTO) / `CANCELLED` / `FAILED` | Same activity → `revenueInfluence: 0`, basis `'measured'`, provenance `'chat_order:<id>:rto'` (or `:cancelled`). Chat revenue that came back is not revenue |
| Cart-recovery reply's cart CONVERTED to an order that reached DELIVERED within the 7d window | Estimate replaced by the actual recovered order total; `kind` stays `'inbox_reply'`; provenance `'cart_recovery:<cartId>:<orderId>'` |
| A `cod_confirm`/`address_confirm` conversation's order — flagged RTO-risk **before** the chat — reached `DELIVERED` | Write a NEW `NovaActivity {department:'shipping', kind:'rto_save', minutesSaved:0, revenueInfluence:0, revenueBasis:'measured', relatedId:orderId, actionId:<the confirm reply's actionId>, detail:'Order #1042 (৳1,850) delivered after chat confirmation — was flagged RTO-risk'}` |

**`rto_save` strict three-condition definition** (RTO is BD's #1 profit killer; this number will
be scrutinized): (a) counted only when the order actually DELIVERs — a confirmation chat on an
order that still RTOs counts nothing; (b) only on orders carrying a **pre-existing risk flag** —
`fakeProtectionAction` set, `customerRisk` level RISK, a courier flag, or an open
`failed_attempt`/`delivery_stuck` NovaCase (module 06's addition to the flagged list — the
definition's owner remains this module); (c) `revenueInfluence: 0` always — the order's value is
already counted (or not) under sales chat revenue; a save is a count, never money. Founder-facing
copy states it: *"orders that were flagged at risk, chat-confirmed by Nova, and actually
delivered — counted, not valued."* The word "prevented" appears only as "**potential** RTOs
prevented" and never with a ৳ value attached (module 11 D11 pins the phrasing platform-wide).

**Attribution windows** (pinned jointly with module 11 D11 — one set of numbers): cart recovery
≤ **7d** from the recovery message with the `recoveryState:'message_sent'` chain intact;
`rto_save` confirmation reply ≤ **72h** before courier handover; repeat-nudge credit ≤ **7d**,
product-matched; lead conversion ≤ **14d** from first inbound. Later conversions are organic and
claim nothing.

**Idempotence**: each rewrite targets a specific activity found via `relatedId`/`actionId` join
and fires only on basis `estimated`; `rto_save` writes are guarded by a per-order dedupe check on
existing `{kind:'rto_save', relatedId:orderId}` rows; achievements insert under
`@@unique([tenantId, key])` with P2002-swallow. Re-running the pass for any day is a no-op.
Rewrites emit `activity.updated`, which clients already exclude from "new tasks today" counts
(`novaDashboard.js:57-62`).

### D7. The outcome-metric registry (req #27/#28 — exact keys and computations)

Two storage layers, matching what exists. **Nightly `NovaScoreMetric` rows** (measured-only,
always) fill the dept-room scorecards; **live "today" numbers** ride existing surfaces unchanged
(`/nova/home` sums, feed + SSE, presence). No new live aggregation endpoint in v1.

**Scorecard keys** (the 12 v1 tiles; `metricKey` names the nightly computation, stored with the
human label in `NovaScoreMetric.label`):

| metricKey | Room | Definition (exact) | Tile (label · value · targetText) |
|---|---|---|---|
| `conversations_handled` | Support | Distinct `InboxConversation`s in window with ≥1 outbound `InboxMessage.novaActionId` | "Conversations handled" · `23` · "all inbound within 24h" |
| `median_first_reply_seconds` | Support | Per handled conversation: first inbound after ≥6h silence (session start) → first outbound with `novaActionId`; median of deltas — pure InboxMessage timestamp math | "First reply (median)" · `38s` · "under 60s" · tone `good` <60 |
| `handover_rate` | Support | Executed `escalate_conversation` actions ÷ conversations_handled | "Handed to you" · `9%` · "under 20%" — **tone never rewards 0%**: below 3% renders `warn`, targetText "suspiciously low — check escalation rules" |
| `resolved_without_handover_pct` | Support | 1 − handover_rate over conversations reaching ≥6h quiet after Nova's last reply | "Resolved solo" · `87%` · "customer went quiet satisfied" |
| `chat_orders_count` | Sales | Executed `create_order_from_chat` actions in window | "Orders closed in chat" · `5` |
| `chat_revenue` | Sales | Σ `revenueInfluence` of `kind:'chat_order'` activities with basis `'measured'` (delivered only); pending COD shown in targetText, **never added in** | "Chat revenue (delivered)" · `৳9,400` · "৳5,550 more pending delivery" |
| `carts_recovered_via_chat` | Sales | Recovery activities whose provenance flipped to `cart_recovery:<cartId>:<orderId>` | "Carts recovered" · `3` · "via Messenger nudge" |
| `leads_converted` | Sales | `JourneyTransition {toStage:'ordered'}` rows whose journey had no prior DELIVERED order (module 04's binding refinement — replaces the ad-hoc conversation→customer→orders join; same meaning, sturdier source) | "New customers from DM" · `2` |
| `rto_saves` | Shipping | Count of `kind:'rto_save'` activities (D6 strict definition) | "RTO saves" · `4` · "flagged orders delivered after chat confirm" |
| `addresses_confirmed` | Shipping | Executed `send_inbox_reply` with purpose `address_confirm` or `cod_confirm` | "Addresses/COD confirmed" · `11` |
| `delivery_questions_answered` | Shipping | Executed replies with purpose `delivery_eta` | "Delivery questions answered" · `7` |
| `ad_replies_handled` | Marketing | Handled conversations whose Meta referral marks a CTM ad/boosted-post origin | "Ad conversations handled" · `6` · "from Click-to-Messenger" |

**Registry unions** (this module stores and computes; definitions owned as noted — all counts of
real rows, computed in the same pass):

- `journey.*` (from `JourneyTransition` rows, definitions module 04 D11): `leads_qualified`,
  `leads_converted`, `negotiations_closed`, `orders_confirmed`, `deliveries_completed`,
  `retained`, `at_risk_recovered`, `repeat_orders`, `winbacks`, `reviews_asked`,
  `reviews_collected` (honest zero v1 + `outcomeNote`), `silences_chosen` (marker rows
  `cause:'nba.do_nothing'`), `unmapped_event`. Marker rows are excluded from stage-transition
  metrics by `toStage != fromStage` filters.
- `case.*` (from `NovaCase` + ledger joins, definitions module 06): `opened`, `resolved`,
  `median_resolution_hours`, `promises_kept_pct` (executor-stamped `keptAt` only),
  `stuck_orders_rescued`, `restock_waits_opened`, `restock_converts`,
  `address_changes_attempted`/`_succeeded` (succeeded = order later DELIVERED),
  `rescues_attempted`, `replacements_completed`.
- `inbox.promise.*` (from `NovaPromise` rows, definitions module 03): `made`, `kept`, `broken`,
  `released`, `blocked_window`; headline `inbox.promise.kept_rate = kept / (kept + broken)`.
- `inbox.identity.*` (module 03): `linked`, `proposed`, `verify_pass`, `verify_fail`,
  `merge_detected`, `merge_approved`.
- `inbox.disclosure.*` (module 02, renamed per C-19): `asked`, `given`.
- Module 05/07 contributed keys: `negotiations_held_at_list_price` (sales — chat orders whose
  conversation recorded a discount ask with no executed `offer_chat_discount`),
  `inbox.policy_gaps_surfaced` (support — founder-answered policy-gap Decisions),
  `inbox.return_intakes` (support — `damaged_item` cases opened via chat),
  `inbox.exchange_saves` (support — `damaged_item` cases resolved with a replacement, no refund),
  `discount_cost_bdt` (sales — Σ discountValue over executed `offer_chat_discount` actions whose
  coupon was redeemed, minor units; the cost side of the negotiation metrics so chat-discount
  ROI is computable as `chat_revenue` against it).
- Telemetry (counters, not tiles): `inbox.pacing.target_ms/actual_ms/model_ms`,
  `inbox.reply.bubbles`, `inbox.lang.detected`, `inbox.window.blocked_sends`,
  `inbox.c360.assembly_ms`, `inbox.memory.distilled`.

Honest-empty holds everywhere: a night with no inbox traffic writes value-`0` tiles or omits
them — never a fixture number (`useNovaRoom.js:9-17`). v2+ keys named now so names don't drift,
NOT built: `csat`, `quote_to_order_rate`, `avg_replies_per_resolution`,
`broadcast_replies_handled`.

### D8. `/nova/attribution` inbox door + `/nova/home` split

`GET /nova/attribution` gains an `inbox` door: NovaAction rows of types
`send_inbox_reply`/`create_order_from_chat`, nova-vs-founder split by `actor`, outcome block
`{replies, orders, codBooked, codDelivered}` where `codBooked` sums estimated chat-order
activities and `codDelivered` sums measured — returned separately, never totaled. `outcomeNote:
"Counts and delivered chat-order totals — not an attributed lift"` matches the existing
no-lift-claims contract (`novaDashboard.js:796-907`). Module 10 renders it via
`DOOR_OUTCOME.inbox` ("N replies · N orders · ৳N COD booked").

`GET /nova/home` `revenueInfluencedToday` becomes `{measured, estimated}` in the payload
(additive change; module 11 pins the platform no-summing rule; the endpoint change lands here).
UI shows "৳9,400 + ৳5,550 pending". Inbox minutes (3/12/2/…) roll into hours saved through the
untouched pipeline; every hours surface carries "estimated at N min/task" — time saved is a
modeled constant, never presented as measured.

### D9. `NovaAchievement` + the nightly evaluator (req #29)

A dedicated model (E-28), not an activity kind alone, because milestones need **once-ever
idempotence** and a stable key; the activity row is only the feed projection. Evaluated nightly
by the pass (canonical C-20 — founder-experience's immediate `maybeRecordInboxMilestone` and
`kind:'milestone'` do not exist). On successful insert the evaluator writes one
`NovaActivity {department, kind:'achievement', title, detail, minutesSaved:0, revenueInfluence:0,
relatedId:<achievementId>}` → `activity.created` SSE → LiveFeed/ticker/feed with zero UI change;
module 10's `FeedMilestoneRow` styles it.

**v1 rule catalogue** — every predicate is a ledger/DB query, nothing model-asserted; all
monetary rules use measured (delivered) values only; min-sample floors mirror the trust system's
MIN_SAMPLE ethic:

| key | Dept | Predicate (exact) | title / titleBn |
|---|---|---|---|
| `first_chat_reply` | support | first executed `send_inbox_reply` exists | "First customer answered in chat" / "চ্যাটে প্রথম কাস্টমারের উত্তর" |
| `first_chat_order` | sales | first executed `create_order_from_chat` exists | "First order closed in chat" / "চ্যাটে প্রথম অর্ডার" |
| `conversations_100` / `conversations_1000` | support | lifetime `conversations_handled` ≥ 100 / ≥ 1000 | "100 conversations handled" / "১০০টি কথোপকথন সামলানো" (etc.) |
| `fast_reply_week` | support | a Mon–Sun week with `median_first_reply_seconds` < 60 AND ≥ 25 handled conversations (floor prevents a 2-chat fluke week) | "Sub-60s reply week" / "সপ্তাহজুড়ে ৬০ সেকেন্ডের নিচে জবাব" |
| `chat_orders_10` / `chat_orders_100` | sales | lifetime executed chat orders ≥ 10 / ≥ 100 | "10 chat orders" / "১০টি চ্যাট অর্ডার" (etc.) |
| `chat_revenue_50k` / `chat_revenue_200k` / `chat_revenue_1m` | sales | lifetime Σ measured chat-order revenueInfluence ≥ ৳50,000 / ৳200,000 / ৳1,000,000 | "৳50,000 delivered from chat orders" / "চ্যাট অর্ডারে ৳৫০,০০০ ডেলিভারড" (etc.) |
| `carts_recovered_10` | sales | lifetime measured cart recoveries via chat ≥ 10 | "10 carts recovered in Messenger" / "মেসেঞ্জারে ১০টি কার্ট উদ্ধার" |
| `first_recovered_cart` | sales | first measured recovery (provenance `cart_recovery:<cartId>:<orderId>`) | "First cart recovered" / "প্রথম কার্ট উদ্ধার" |
| `rto_saves_10` / `rto_saves_50` | shipping | lifetime `kind:'rto_save'` activities ≥ 10 / ≥ 50 | "10 RTO saves" / "১০টি আরটিও রক্ষা" (etc.) |
| `first_ad_conversation_order` | marketing | first chat order in an `ad_reply`-origin conversation | "Ad click → chat → order, first time" / "বিজ্ঞাপন থেকে চ্যাটে প্রথম অর্ডার" |
| `first_night_shift` | support | first tenant-local night window (22:00–08:00) containing ≥1 executed `send_inbox_reply` | "First night shift covered" / "প্রথম রাতের ডিউটি" |
| `ten_conversations_day` | support | a tenant-local day with ≥10 distinct handled conversations | "10 conversations in one day" / "একদিনে ১০টি কথোপকথন" |

`detail` is always the receipts sentence — e.g. *"100th conversation handled on 24 Jul — 91%
resolved without handover, median first reply 42s over the last 30 days."* Every number in
`detail` must be reproducible from `evidence.sampleRefs`/window — the evaluator writes the query
result into `evidence`, and any surfaced claim traces there.

**Deliberately excluded, forever**: any "zero handovers" streak rule — it would incentivize Nova
(and bias future prompt-tuning) against escalating. Escalation is a feature; achievements must
never punish it (cross-cutting rule 15; test-pinned in module 12). **Achievements never feed
trust inputs** — a trophy and a promotion are separate currencies (module 11 anti-gaming rule 4).

### D10. Achievement surfacing

1. **Feed cards (free)**: the projected `kind:'achievement'` activity flows into `/nova/feed`,
   LiveFeed mono lines, the `novaStatus` ticker fallback, and dept-filterable feed entries;
   module 10's `FeedMilestoneRow` renders it distinctly.
2. **Dept-room trophy strip (this module's UI)**: `GET /nova/rooms/:key` response gains
   `achievements: [{key, title, titleBn, detail, achievedAt, value}]` — ≤5 latest for that dept
   (server change in the rooms handler, `novaDashboard.js:690-710`). UI: a compact "MILESTONES"
   strip under the scorecard using the ACTION_CHIP visual grammar — new small component
   `NovaMilestoneStrip` (~30 lines), honest-empty ("No milestones yet — Nova is earning them").
3. **Weekly report lines**: `WeeklyReportModal` is client-computed over room data; with
   `achievements` in the payload it appends "This week: Sub-60s reply week" for `achievedAt`
   within 7d — pure client filter, no endpoint. (The weekly INBOX verb-grouping section is
   module 10's.)
4. **Morning brief**: the pass persists a per-day summary (counts + new achievement rows) that
   the brief job's context builder reads **pre-labeled** ("chat revenue ৳9,400 (delivered) +
   ৳5,550 (pending COD — not yet real)") — the model cannot mislabel what arrives labeled;
   the rows are the anti-hallucination source. Module 10 renders the "While you slept" line.

### D11. Founder at-a-glance (which surface shows what, by which mechanism)

| Surface | What they see | Mechanism (all existing unless NEW) |
|---|---|---|
| Sidebar | Lime dot pulsing on Inbox when a prepared reply/order waits | `DOOR_OF` inbox entries + `novaDoor:'inbox'` (D5) |
| HQ ticker / statusLine | "Answering 3 customers in Messenger · 1 waiting on you" | server-written `NovaInstance.statusLine` (module 02's runner) |
| NovaDesk / Decision Desk | Overnight inbox replies in task counts; handovers + prepared chat orders as decision cards | activity counts + `NovaDecision {kind:'escalation'}`; one-decision-per-action, conditional-claim approve, untouched |
| Support room | Grade + 4 conversation tiles, HISTORY receipts with the customer's Bangla text, trophy strip | NovaScoreMetric + department strings + NEW `achievements[]`/strip |
| Sales room | Chat orders, delivered chat revenue (pending called out, never summed), recovered carts, DM-first customers | same |
| Shipping room | RTO saves (strict definition on the tile), addresses confirmed, delivery questions | same |
| Marketing room | Ad-origin conversations handled | same |
| Command MadeBySplit | "INBOX — N replies · N orders · ৳N COD booked", no-lift footer | NEW `inbox` door (D8) + module 10's formatter |
| HoursTile / `/nova/home` | Inbox minutes roll into hours saved; revenue split measured/estimated | `MINUTES_BY_ACTION` entries + D8 split |
| Morning brief | "Yesterday in the inbox: 23 conversations, 2 COD orders (৳3,700 pending delivery), 1 handover, first-reply median 41s" + new milestones | D10.4 pre-labeled context |
| Inbox page | BY NOVA chips on bubbles opening the ledger receipt | `InboxMessage.novaActionId` + `ATTRIBUTABLE` (module 10 owns the page) |

### D12. What this module supplies to trust progression (req #34 half)

Module 11 owns `computeTrust`, the seven input predicates, and promotion criteria. This module
guarantees their inputs are **queryable and honest**: `revenueProvenance` strings
(`chat_order:<id>:delivered`, `cart_recovery:<cartId>:<orderId>`) written only by the
deterministic pass; `rto_save` rows under the strict definition; the quiet-satisfied machinery
(`resolvedQuietConversations(tenantId, window)` exported from `novaInboxAttribution.js` so trust
and the scorecard share one implementation); the `InboxMessage(conversationId, sentAt)` index;
and measured/terminal-state-only labeling — estimates never enter any earn predicate. Founder
rejections/undos of inbox decisions already feed `computeTrust` (reject ×1.5, undo ×3) with no
special-case code. Volume (replies, conversations, minutes) appears nowhere in trust inputs.

---

## Data model

New model (full — E-28):

```prisma
model NovaAchievement {
  id           String    @id @default(cuid())
  tenantId     String
  key          String    // rule id, e.g. "first_chat_order" — stable, versioned catalogue (D9)
  department   String    // room that gets the trophy (real NOVA_DEPARTMENTS member)
  title        String    // "First order closed in chat"
  titleBn      String    // "চ্যাটে প্রথম অর্ডার"
  detail       String    // honest sentence incl. the numbers + window
  value        Decimal?  // the threshold-crossing value (100, 50000, ...)
  evidence     Json      // { metricKey?, window:{from,to}, count/sum, sampleRefs:[actionIds...] }
  achievedAt   DateTime  @default(now())
  activityId   String?   // the projected NovaActivity row

  @@unique([tenantId, key])   // once-ever idempotence — the evaluator upserts with P2002-swallow
  @@index([tenantId, department, achievedAt])
}
```

Changed models — this module adds indexes only (columns land in modules 01/05):

```prisma
model InboxMessage {
  // actor / novaActionId / metaTimestamp / attachmentType / purpose — module 01
  @@index([conversationId, novaActionId])  // NEW — ByNovaChip + first-reply latency
  @@index([conversationId, sentAt])        // NEW — reply/quiet-satisfied timestamp math (metrics + trust)
}

model Order {
  // novaActionId / sourceConversationId / sourceChannel — module 05
  @@index([tenantId, novaActionId])        // NEW — chat-revenue joins + attribution door
}
```

Migration notes: plain additive migration, no backfill (no inbox ledger rows exist before this
stage). `NovaAchievement` carries **no FK to conversation or message** — `evidence.sampleRefs`
are NovaAction ids — so Meta data-deletion hard-deletes (module 01's cascade) never touch
trophies or history. Deleted conversations shrink future `conversations_handled` windows but
never rewrite already-written `NovaScoreMetric` rows (point-in-time receipts). Tiered rules use
distinct keys (`chat_orders_10`, `chat_orders_100`) so each tier fires exactly once, forever.

---

## APIs & interfaces

**dakio-api (merchant JWT — `authenticate, requireTenant`):**

- `GET /api/nova/rooms/:key` — response gains `achievements: [{key, title, titleBn, detail,
  achievedAt, value}]` (≤5 latest for the dept; `[]` when none). Rest of the contract untouched.
- `GET /api/nova/attribution` — gains door `inbox`: `{door:'inbox', nova:{count}, founder:{count},
  outcome:{replies, orders, codBooked, codDelivered}, outcomeNote:"Counts and delivered
  chat-order totals — not an attributed lift"}`. Nova-vs-founder by `NovaAction.actor`.
- `GET /api/nova/home` — `revenueInfluencedToday` becomes `{measured, estimated}` (additive;
  clients reading the old scalar get `measured`).

**dakio-api (service token — `authenticateNovaService + requireTenant`):**

- `POST /api/v1/inbox/attribution/run` `{day?: "YYYY-MM-DD"}` → `{day, rewrites:{measured,
  zeroed, cartCredits, rtoSaves}, metrics:[{metricKey, dept, value}], achievements:[keys...],
  briefSummary:{...pre-labeled strings...}}`. Idempotent via `w()` (`src/lib/novaIdempotency.js`),
  key `inbox_attr:<day>`; safe to re-run (D6 idempotence). Route lives in
  `src/routes/novaInbox.js`. Scorecard rows are written internally through the same atomic
  upsert the existing POST `/agent-data/departments` uses.

**nova-ai:**

- `agent/lib/nova/inboxIntents.ts` (new) — exports `DEPARTMENT_BY_INTENT`,
  `INBOX_LOW_CONFIDENCE = 0.55`, and the `InboxIntent` closed union (canonical §2.6). Modules
  02/11 import from here; the map is never model-adjustable.
- `agent/lib/nova/activity.ts` — `MINUTES_BY_ACTION` entries per D2 (TypeScript forces each as
  its verb lands; the D2 values are authoritative).
- `agent/lib/store/client.ts` + `agent/lib/store/dakio.ts` — `runInboxAttribution(day?)` →
  the service route above.
- `agent/channels/internal.ts` — night_ops branch invokes `runInboxAttribution()` as a
  deterministic pre-step before the model session; the session receives the returned pre-labeled
  summary in its context. No new tools; the model cannot trigger or skip the pass.

**dakio-merchant:** no new routes consumed beyond the extended shapes above.

---

## Files touched

**dakio-api:**
- `prisma/schema.prisma` — `NovaAchievement` model; three indexes (InboxMessage ×2, Order ×1).
- `prisma/migrations/<ts>_nova_achievement_attribution/` (new) — the migration.
- `src/lib/novaInboxAttribution.js` (new) — `runInboxAttribution` (rewrites → metrics →
  achievements), `resolvedQuietConversations` export, rule catalogue table.
- `src/lib/novaLedger.js` — `ATTRIBUTABLE` entries `inbox_message`, `order`.
- `src/routes/novaDashboard.js` — `DOOR_OF` entries; rooms `achievements[]`; `/attribution`
  inbox door; `/home` measured/estimated split.
- `src/routes/novaInbox.js` — `POST /attribution/run` route (file created by module 01/02).
- `package.json` — add `src/tests/novaInboxAttribution.test.js` to the test list.

**nova-ai:**
- `agent/lib/nova/inboxIntents.ts` (new) — `DEPARTMENT_BY_INTENT`, `INBOX_LOW_CONFIDENCE`.
- `agent/lib/nova/activity.ts` — `MINUTES_BY_ACTION` inbox entries (values per D2).
- `agent/lib/store/client.ts`, `agent/lib/store/dakio.ts` — `runInboxAttribution`.
- `agent/channels/internal.ts` — night_ops deterministic pre-step.

**dakio-merchant:**
- `src/components/nova/NovaMilestoneStrip.jsx` (new) — trophy strip, honest-empty.
- `src/pages/nova/NovaDeptRoomPage.jsx` — render strip under scorecard; weekly-report
  achievement-line append.
- `src/components/Sidebar.jsx` — `novaDoor: 'inbox'` on the Inbox nav item.

---

## Testing

**dakio-api** — `src/tests/novaInboxAttribution.test.js` (node:test, added to the package.json
test list):

1. Given a chat order estimated at ৳1,850, when the order reaches DELIVERED and the pass runs,
   then the `chat_order` activity flips to `measured` with provenance `chat_order:<id>:delivered`.
2. Given the same order reaches RETURNED instead, then `revenueInfluence` is 0, basis `measured`,
   provenance `:rto` — and `chat_revenue` for the window excludes it.
3. Given a `cod_confirm` reply on an order with NO prior risk flag that delivers, then **no**
   `rto_save` is written; given the flag exists and the order delivers, exactly one is written;
   re-running the pass writes no second one (dedupe on `{kind, relatedId}`).
4. Given the evaluator crosses `chat_orders_10`, then one NovaAchievement + one projected
   `kind:'achievement'` activity exist; running the pass again inserts nothing (P2002-swallow);
   the rule catalogue contains no key matching `/handover|escalation/` (static assertion — the
   no-zero-handover invariant, pinned for module 12).
5. Given a window with zero inbox traffic, then scorecard writes are `0`-valued or omitted —
   never fixture numbers — and `GET /nova/rooms/support` returns `achievements: []`.
6. Given JourneyTransition rows `{toStage:'ordered'}` for a journey with a prior DELIVERED order,
   then `leads_converted` excludes it (transition-sourced, not join-sourced).
7. Given nova- and founder-actor inbox actions, `GET /nova/attribution` inbox door splits counts
   by actor, returns `codBooked` and `codDelivered` separately, and carries the `outcomeNote`.
8. `POST /api/v1/inbox/attribution/run` with a mismatched tenant token → 403; replay with the
   same Idempotency-Key returns the cached result (isolation + `w()` behavior).

**nova-ai** — repo suite additions: `DEPARTMENT_BY_INTENT` closed-set test (every canonical
intent slug mapped; every value ∈ `NOVA_DEPARTMENTS`; `general → support`); `MINUTES_BY_ACTION`
completeness is enforced by the compiler (`Record<ActionType, number>`); a table-equality test
asserting the dakio-api `EXECUTORS` activity minutes match the D2 values (fixture JSON shared via
the doc's table — drift fails the build).

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Founders read pending COD chat revenue as earned (BD COD reality: booked ≠ delivered) | high | Estimated-until-DELIVERED + RTO zeroing; measured-only tiles with pending confined to targetText; `/nova/home` split; no-summing rule test-pinned |
| `rto_save` reads 0 and looks broken when risk flags are sparse | medium | Honest zero beats a loosened definition — the tile's targetText states the three conditions every time; module 06's `failed_attempt` cases widen the flag base honestly |
| `minutesSaved` inflation on chatty threads (3 min × many replies) | medium | Values already conservative (C-3); monitor feed hours; per-conversation daily cap is a named v2 item |
| Wrong numbers via double-writes (webhook retries, pass re-runs, approve double-taps) | medium | Basis-guarded rewrites, per-order `rto_save` dedupe, `@@unique([tenantId, key])`, `w()` idempotency, one-decision-per-action — all test-pinned |
| The night_ops model session skips or hallucinates the pass | low | The pass is a code pre-step in the internal channel, not a model tool decision; the session only ever sees pre-labeled results |
| First evaluation over a backfilled history fires several trophies in one night | high (once) | Accepted: `achievedAt` is truthful, the burst happens once; rollout note in module 12's shadow-week plan |
| Single-instance SSE bus — achievement/feed events don't fan out on multi-replica deploys | low | Pre-existing platform constraint (`novaFeedBus.js:6-13`), not worsened here; polls remain the fallback |
| Worst customer-facing failure: none direct — this module sends nothing. Worst founder-facing failure is a wrong number that erodes trust in every other surface | — | Every displayed figure traces to rows via `revenueProvenance` + NDJSON export; reproducibility is the design, not an audit afterthought |

---

## Gate

**Scripted demo (non-builder, clean staging store):**

1. Send "dam koto?" from a test Messenger account; approve Nova's draft. Open the Support room:
   HISTORY shows "Replied to <name> — price query (banglish)" and the receipt's first evidence
   entry is the customer's exact text.
2. Complete a chat order. Sales room shows "Orders closed in chat · 1"; chat revenue tile shows
   ৳0 delivered with the order's total in targetText as pending.
3. Mark the order DELIVERED (staging courier webhook); run
   `POST /api/v1/inbox/attribution/run`. The tile now shows the total as delivered; the activity
   row's provenance reads `chat_order:<id>:delivered` in the NDJSON export.
4. Repeat with a second order and mark it RETURNED: revenue stays excluded (zeroed, measured).
5. Flag a third order RTO-risk, chat-confirm it, deliver it, run the pass: Shipping room shows
   "RTO saves · 1"; an unflagged confirmed-and-delivered control order adds nothing.
6. Cross `first_chat_order`: the feed shows the milestone row; the Sales room shows the
   MILESTONES strip entry with bn+en title; re-running the pass adds no duplicate.
7. Command → MadeBySplit shows the INBOX door with counts and the no-lift footer; sidebar Inbox
   dot pulses while a draft is pending.

**Measurable checks:** attribution-pass re-run is a byte-identical no-op on all counters; every
demo number reproduced from `GET /nova/ledger/export` rows by an independent script; scorecard
rows for a zero-traffic tenant contain no non-zero values; `DEPARTMENT_BY_INTENT` closed-set test
green; the EXECUTORS-vs-D2 minutes equality test green.

**Rollback (no deploy):** the pass is config-gated — `NovaJobDef(kind:'night_ops').config
{inboxAttribution:false}` skips rewrites/metrics/achievements entirely (rows already written
remain, honestly); the rooms handler serves `achievements: []` when the model table is empty and
the strip renders honest-empty; `DOOR_OF`/`ATTRIBUTABLE` entries are inert without inbox rows.
No customer-visible behavior exists in this module, so rollback risk is founder-display only.

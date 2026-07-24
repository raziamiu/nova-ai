# Module 06 — Delivery & RTO: cases, courier reality, and the RTO orchestra

**Phase:** 16 "Front Office" · **Depends on:** 01, 02, 04, 05 · **Feeds:** 07, 09, 10
**Repos touched:** dakio-api | nova-ai | dakio-merchant (CONFIRMED badge; conversation case chip)
**Founder requirements covered:** #1 (primary), #13, #14

This module ships `NovaCase` — the coordination object that lets one customer message trigger
work across shipping, finance, inventory, support, and operations and come back to the thread as
one coherent update — plus the three delivery verbs (`open_case`, `flag_courier_issue`,
`confirm_order_intent`), the two order-fix verbs the delivery flows need
(`update_order_contact`, `cancel_order_from_chat`), the `courier_intervention` /
`case_update` / `restock_check` job lanes, the loop-closer contract that stamps promises kept,
and the four-movement RTO-prevention orchestra. It also resolves the honest boundary once, in
code and in copy: Dakio can book a courier, poll its status, and receive its webhooks — nothing
else. Nova never pretends otherwise.

---

## Already real vs to build

| Already real (evidence) | This module adds |
|---|---|
| Courier booking: `POST /api/orders/:id/courier` (dakio-api `src/routes/orders.js:1596`) | Nothing — reused untouched. There is NO reschedule/redirect/hold/complaint API; v1 intervention = re-poll + structured findings + advisory founder card |
| Live courier status poll: `GET /api/orders/:id/courier/status` (`orders.js:1551`) | `POST /api/v1/inbox/cases/:id/courier-refresh` — service-token wrapper over the same internals, result appended to case `facts` |
| Inbound courier webhooks with status maps (Steadfast/RedX/Pathao) → `Order.status`/`courierStatus` + `emitOrderUpdated` (`src/routes/webhook.js:19-131`; `STEADFAST_MAP` at `:44`; `updateOrderByTracking` at `:73-92`) | Open-case lookup in the handler: order has an open delivery case → emit NovaInbox `case.updated`; failed-attempt/hold statuses → system-opened `failed_attempt` case |
| `Order.confirmedAt` / `confirmedBy` / `courierSentAt` columns (`prisma/schema.prisma:531-534`) | First writer: `confirm_order_intent` sets `confirmedAt = now`, `confirmedBy = 'nova:<actionId>'`; CONFIRMED / BY NOVA badge in dakio-merchant keyed on these fields |
| `Order.fakeProtectionAction` / `fakeProtectionReason` (`schema.prisma:527-528`) | Input signal to `computeRtoSignals` (+3 points) |
| `CourierConsignment` rows per booking (`schema.prisma:684-702`) | Quoted on `flag_courier_issue` cards (tracking id, expected COD) |
| `calculateCustomerRisk` NEW/RISK/POSITIVE/MEDIUM + `normalizePhone`/`phoneVariants` (`src/lib/customerRisk.js:36-45`, `:7-13`) | `computeRtoSignals()` extension in the same file — rule points over real columns, no ML claim |
| NovaJob machine: `JOB_KINDS` (`src/routes/novaJobs.js:39`), `PRIORITY_BY_KIND` with priorities 1–2 reserved (`:46-53`), `drainEventsToJobs` (`:134`), lease/fencing/MAX_ATTEMPTS; dispatcher claim loop (nova-ai `agent/schedules/dispatcher.ts:33-77`) | Three job kinds: `courier_intervention` (3), `case_update` (4), `restock_check` (5) + drain branch for `case.updated` (branch site wired by module 01, logic owned here) |
| Decision at-most-once claim: conditional `updateMany` (`src/routes/novaDashboard.js:430-441`); dept-room aggregation by department string (`novaDashboard.js:690-710`) | Case-born decisions link via `bundleRef:'case:<id>'`; case resolution auto-settles its open decisions as `expired`; every case action lights the owning dept room through the existing pipes |
| `ADVISORY` executor set — approve = acknowledged, incl. `suggest_restock` (`src/lib/novaExecutors.js:204-231`) | `flag_courier_issue` joins `ADVISORY`; `suggest_restock` reused verbatim for restock-demand cards |
| Humanized 7-step tracking map (`src/routes/publicTracking.js`) | All customer-facing status language in case updates uses this map — never raw courier strings |
| `emitOrderCreated` in-tx producers (`orders.js:808`, `store.js:729`) | Consumed by movement 1 (confirmation ping channel resolution); new producer `order.confirmed` emitted by the confirm writeback |
| SupportTicket is merchant↔Dakio-admin only — no shopper ticket store (`src/routes/novaStore.js:18-23`) | Confirmed OUT: NovaCase is coordination state, not a shopper ticket system; escalations stay NovaDecisions |
| OUT — courier reschedule/redirect/hold execution | No API exists at any courier. Ships as intake + advisory flag cards with honest copy; the `courier_intervention` job is the ready socket if an API ever lands (v2) |
| OUT — delivery ETA promises | No ETA column anywhere; Nova quotes the current step and holder only |

---

## Objective

After this module ships, a founder can watch one Messenger complaint ("order ekhono paini")
become: a truthful instant reply, an open shipping case, a courier re-poll, a flag card with the
phone-call homework pre-gathered, a tracked promise, and a customer who is proactively told the
truth when the parcel moves — without the founder touching anything except the one decision that
genuinely needs a human. They can also see every order Nova confirmed pre-dispatch (CONFIRMED /
BY NOVA badge), every open case ("customers needing attention"), and a kept-promise percentage
computed only from real outbound sends.

## Scope

**In:** `NovaCase` model + create-or-join dedupe + service surface + expiry sweep; verbs
`open_case`, `flag_courier_issue`, `confirm_order_intent`, `update_order_contact`,
`cancel_order_from_chat`; job kinds `courier_intervention`/`case_update`/`restock_check`;
`case.updated`, `order.confirmed`, `order.item_unfulfillable` event producers; the loop-closer
contract; delivery conversation flows (WISMO, pre-dispatch confirm/address-fix/cancel intake,
delivery-problem intake, post-dispatch address-change case); RTO orchestra movements 1–4 incl.
`computeRtoSignals`; restock-wait and damaged-item case machinery; concurrency rules;
`case.*` metric keys; CONFIRMED badge + conversation case chip + `GET /api/nova/cases`.

**Out (with pickup):** payment-claim intake verb `verify_payment_slip` (module 05; this module
supplies the `payment_unverified` case coordination around it) · aftersales copy/flows for
returns and complaints (module 07; `damaged_item` case machinery lives here) · rendering of the
open-cases list, promises panel, and case chip UI (module 10; server fields here) · `rto_save`
strict accounting definition + nightly pass (module 09; this module adds `failed_attempt` cases
to its "flagged" condition list) · wholesale inquiry = plain sales escalation with impactLabel,
no case in v1 (module 05) · v2+: `wholesale_inquiry` case kind, voice-call rescue lane,
MESSAGE_TAG out-of-window sends, real courier intervention APIs, auto-drafted ৳0-COD replacement
orders, dakio-ops badge/case column, case timeline UI, per-kind SLA watchdogs, cross-case
courier-spike detection (`flag_rto_spike`), case-aware NBA candidates (module 12 tracks the v2
list).

---

## Design

### 1. Ground rules

1. **Nova never pretends to have hands it doesn't have.** Against Steadfast/RedX/Pathao, Dakio
   has exactly: booking, live status poll, inbound webhooks. So v1 courier "intervention" =
   re-poll + structured findings + a founder flag card with everything pre-gathered — and the
   customer is told the truth about who does what.
2. **Ledgered per department, coordinated per case.** NovaAction/NovaActivity stay the receipts
   store, sliced by `department` exactly as today. `NovaCase` is coordination state only — it
   never duplicates ledger truth, it links to it. It is also not a journey: `CustomerJourney`
   owns stage; a case is an episode, a journey is a life. The reducer never reads cases; cases
   never move stages (drift between them is possible and acceptable — coupling the two machines
   was considered and rejected).
3. **A promise made in chat is tracked to keep.** "আপডেট পেলেই জানাবো" is a `NovaPromise` row
   (module 03's model) referenced by `NovaCase.promiseId`, with a `followup` job as its dead-man
   switch and a `keptAt` that only a real outbound send can stamp.
4. **Autonomy never travels.** Inbox tier T3 grants nothing to the shipping or finance lane;
   every dept action re-resolves authority for its own verb and door
   (`agent/lib/nova/authority.ts:147-165`). §11.3.
5. **Every dept touch is visible in that dept's room** via the existing department-string
   aggregation — zero new room plumbing.

### 2. The orchestration primitive — hybrid, and exactly where the line sits

Decision: hybrid. Rejected (a) inline dept subagents — a subagent-delegating turn approaches
3 minutes and the customer channel is deliberately a slim ~10-tool prompt; a human shop
assistant doesn't conference-call the warehouse while you stand there, they say "দেখে জানাচ্ছি"
and come back. Rejected (b) everything-as-jobs — a courier status check is one HTTP read;
forcing it through the job lane adds ≤60s dispatcher latency for nothing and makes WISMO
answers feel dead.

The hard line (module 02 carries it verbatim in the runtime instructions):

| Inline (same turn) | Job (promise + async) |
|---|---|
| Any single read: order, courier status, product/stock, case state | Anything needing a re-poll later (courier stuck) |
| Any single gated write that IS the reply's substance: reply, order create, confirm intent, open case, schedule follow-up, escalate | Anything waiting on a human (founder decision, supplier answer) |
| | Anything waiting on the world (webhook, restock, payment verification) |
| | Anything multi-step across departments (gather → flag → decide → update) |

`open_case` is deliberately inline **and** cheap — one insert + one job enqueue. The case is how
an inline turn hands work to the async lane without the customer ever seeing a seam.

New job kinds (extend `JOB_KINDS`/`PRIORITY_BY_KIND`, `novaJobs.js:39-53`; priorities 1–2 stay
the reserved inbound fast-lane band):

| kind | prio | cadence | dedupeKey | payload |
|---|---|---|---|---|
| `courier_intervention` | 3 | event — enqueued by the `open_case` executor for kinds `delivery_stuck` / `failed_attempt` / `address_change_postdispatch` | `courier_intervention:<orderId>` — one open intervention per order; on re-open after resolve, fresh case → key suffix `:r2`, `:r3`… | `{caseId, orderId, conversationId, courierType, trackingId, reason}` |
| `case_update` | 4 | event — drained from `case.updated` NovaInbox events | `case_update:<caseId>:<30min-bucket>` — courier webhooks can fire 3 statuses in a minute; the customer gets ONE coherent update per burst | `{caseId, conversationId, trigger}` |
| `restock_check` | 5 | event — enqueued by `open_case` kind `restock_wait` | `restock_check:<productId>:<dayBucket>` — many customers asking for one OOS product share one check | `{productId}` (open cases found by query) |

Dispatcher, lease/fencing, MAX_ATTEMPTS, per-tenant service tokens: untouched.

### 3. NovaCase — one minimal first-class model

Loose NovaActivity rows + targetRef conventions were considered and rejected for four reasons:
(1) the promise-kept loop needs durable mutable state spanning hours-to-days and several async
actors — replaying an append-only ledger on every touch to answer "is this still open? what did
we promise?" is the wrong tool; (2) concurrency dedupe needs a claimable row — you cannot
`@unique`-claim a convention (§11.1); (3) requirement 30's "customers needing attention" is a
query — `NovaCase WHERE status IN (open, waiting_founder)` IS that surface; (4) precedent —
`NovaAchievement` became a real model for exactly the once-ever-idempotence reason.

Semantics:

- **`activeKey` create-or-join**: `"<kind>:order:<orderId>"` (or `:product:<id>`, `:conv:<id>`)
  while open, NULLed on close. `@@unique([tenantId, activeKey])` — Postgres allows multiple
  NULLs, so closed cases free the key. `POST /cases` transactionally inserts; on P2002 it loads
  the open case, appends the caller's conversationId to `refs.conversationIds`, and returns it
  with `joined:true`.
- **`conversationId` is a plain string, no FK** — survives the Meta data-deletion hard-delete
  cascade (same rule as `Order.sourceConversationId`). Commerce and coordination records outlive
  the transcript.
- **`facts` is append-only** `[{at, source, note, data?}]` — what each actor learned; quoted in
  customer updates and founder cards. `PATCH /cases/:id` merges facts server-side, never
  replaces.
- **`promiseId` references `NovaPromise`** (module 03's ledger; built in wave 2, present before
  this module). There is ONE promise store. When a committing reply carries `payload.caseId`,
  the reply executor creates the NovaPromise (module 03 machinery) and sets
  `NovaCase.promiseId`; case executors stamp `keptAt`/`status:'kept'` on that row. The case
  never embeds promise state.
- **Status vocabulary**: `open | waiting_dept | waiting_founder | waiting_customer | resolved |
  closed_unresolved | expired`. `resolution` is one honest sentence.
- **Expiry sweep**: the daily `journey_sweep` job (module 04's cron) closes cases untouched for
  `case.expiryDays` (guardrail key, default 14) as `expired` with an honest resolution note — no
  immortal zombie cases. Missing key reads as absent ⇒ the sweep uses the shipped default; the
  sweep itself never sends (a closing customer ping is an open founder question, v1 closes
  silently).

Linking conventions (everything queryable, zero new columns elsewhere):

- NovaDecision → case: `bundleRef:'case:<caseId>'`. One case may hold several decisions
  (shipping flag + finance escalation) without violating one-decision-per-action.
- NovaJob → case: `payload.caseId` (Json-path filter, same pattern as followup cancels).
- NovaAction → case: verbs whose subject IS the case use `targetRef:'case:<caseId>'`
  (`open_case`, `flag_courier_issue`); door verbs keep their door targetRef
  (`send_inbox_reply` → `inbox_message:<id>`) and the case-aware executors append their
  actionIds to `refs.actionIds`. `DOOR_OF` gains `case: 'inbox'`.
- NovaActivity → case: `relatedId: caseId` on `case_opened` / `case_resolved` activities.

Case-kind → owning department (deterministic map in `src/lib/novaCase.js`, never model-chosen):

| kind | department | dept job spawned |
|---|---|---|
| `delivery_stuck`, `failed_attempt`, `address_change_postdispatch` | shipping | `courier_intervention` |
| `payment_unverified` | finance | none — module 05's verification Decision IS the dept work; the case tracks the waiting customer and closes the loop after the founder verifies or rejects |
| `damaged_item` | support (operations joins via `refs` when a replacement ships) | none in v1 — founder decision drives it |
| `restock_wait` | inventory | `restock_check` |
| `wholesale_inquiry` | — reserved kind string, v2 only (v1 = sales escalation, module 05) | — |

New duties under the existing doors: `shipping.delivery_cases` (minLevel 2),
`shipping.predispatch_confirms` (minLevel 2) — minLevel 2 so T0 Shadow can draft; the duty gate
explains bn+en for under-leveled tenants.

### 4. Verbs — full registration (both repos)

All five verbs follow the complete new-verb checklist: `ActionType` union
(`agent/lib/types.ts:529`), zod payload (`agent/lib/nova/schemas.ts`), `RISK_CLASS`
(`agent/lib/nova/autonomy.ts:52` — a missing entry silently reads "high", so entries are
mandatory), `TARGET_TEXT` extractor (`agent/lib/nova/authority.ts:61` — mandatory or no-touch
tenants blanket-refuse; extractors NFC-normalize Bangla), `MINUTES_BY_ACTION`
(`agent/lib/nova/activity.ts:14`, TS-forced), nova-ai executor + store-client method, dakio-api
`EXECUTORS`/`ADVISORY` entry, `DOOR_OF`, dutyRef.

| Verb | risk | MIN | undoable | dept | verdict behavior |
|---|---|---|---|---|---|
| `open_case` | low | 3 | yes (close case) | from kind map | **bookkeeping verb** (module 08's SS8 `verdictForLevel` carve-out) — zero customer-visible side effects, so it executes at every tier including T0 Shadow |
| `flag_courier_issue` | low | 10 (the phone call it replaces) | no | shipping | guardrail branch returns `needs_approval` **always** — a proposal by nature; dakio-api side joins `ADVISORY` (approve = acknowledged, minutesSaved 10, never a fabricated courier contact) |
| `confirm_order_intent` | low | 2 | no | shipping | auto at T1+ — writes `Order.confirmedAt` only after the customer literally said yes; `confirmedText` (the customer's verbatim confirming message) is evidence-grade in the payload |
| `update_order_contact` | low | 5 | no | shipping | pre-dispatch only (`courierSentAt` null); post-dispatch the executor refuses and the flow opens an `address_change_postdispatch` case instead |
| `cancel_order_from_chat` | low | 6 | no | support | `inbox.cancelAuto` guardrail key (default false ⇒ needs_approval; T3 flips it); pre-dispatch only; post-dispatch blocked ⇒ escalation |

Payload shapes: `openCasePayload {kind, orderId?, productId?, conversationId, title, factsNote}` ·
`flagCourierIssuePayload {caseId, orderId, courierType, trackingId, reason, recommendation}` ·
`confirmOrderIntentPayload {orderId, conversationId, confirmedText}` ·
`updateOrderContactPayload {orderId, conversationId, address?, city?, district?, phone?}` ·
`cancelOrderPayload {orderId, conversationId, reason}`.

All guardrail branches are fail-closed: a missing platform key reads `false` ⇒ `needs_approval`
(tested invariant, not a convention). Rule strings emitted with `explanation` + `explanationBn`:
`guardrail:inbox_cancel_auto_off`, plus the shared `concurrency:founder_active`,
`concurrency:stale_reply`, `duty:thread_off` from module 02's reply gate.

Tool exposure: `get_case`, `open_case`, `flag_courier_issue`, `confirm_order_intent`,
`update_order_contact`, `cancel_order_from_chat` are **job-session extras** — loaded for
dispatcher lanes (`internal.ts` case/courier jobs); the live customer session carries `open_case`
and `update_order_contact`/`cancel_order_from_chat` via its slim set only where the flows below
need them inline. `get_order_status` responses embed `openCase {id, status, kind, promiseText}`
when the order has one, so a second asker answers from the case without a tool round-trip.

### 5. The loop-closer contract

Named as a first-class contract because delivery, payment, restock, and damaged-item flows all
reuse it:

```
dept job / courier webhook / founder action
        │ (state actually changed)
        ▼
NovaInbox event  case.updated  {caseId, trigger}      dedupeKey case.updated:<caseId>:<source>:<key>
        │ drainEventsToJobs branch (module 01 wires the call site)
        ▼
NovaJob case_update (priority 4, 30-min bucketed)
        │ dispatcher next tick
        ▼
internal.ts → args.receive(customerChannel, …)        SAME customer:inbox:<convId> session —
        │                                             memory, register, tone continuity free
        ▼
get_case (fresh read) → compose → send_inbox_reply    full authority gate, fire-time window
        │                                             re-check, human timing
        ▼
reply executor stamps NovaPromise.keptAt / case resolution
```

Event producers (all idempotent via dedupeKey):
- **Courier webhook**: real status change on an order with an open delivery case → emit with
  key `case.updated:<caseId>:courier:<newStatus>`.
- **Founder action**: decision approve/reject executors and `recordFounderAction` gain an
  open-case lookup → key `…:founder:<actionId>`.
- **Job completion**: a dept job writing findings emits `…:job:<jobId>`.

Five guarantees (each test-pinned):
1. **Quote-at-send**: the customer message is composed from live state (`get_case`,
   `get_order_status` this turn), never from the triggering event — the event may be stale by
   delivery time.
2. **Still autonomy-gated**: a T0-shadow tenant's loop-closure lands as a tap-send draft,
   correctly. The whole orchestra runs at every tier; only the last inch (the send) varies.
3. **Closed 24h window** ⇒ `skipped_window` receipt + prepared founder card ("customer should
   be told; window closed — call them?"), never silence-with-no-record, never an illegal send.
4. **At-most-once per burst** via the bucketed dedupeKey.
5. **Locked / founder-held threads** (`novaLockedAt` set or `handledBy:'founder'`): the
   case_update session sees the lock and produces a **prepared draft** — "suggested update for
   Rafiq" — never talks over the founder.

Promise stamping is executor-internal: only the reply executor, seeing `payload.caseId` and an
open linked promise, stamps `keptAt` + `keptActionId` on the NovaPromise row — the model
cannot PATCH a promise, and `case.promises_kept_pct` is therefore ungameable. A `skipped_window`
draft later tap-sent by the founder stamps kept at THAT send — kept late is kept; the timestamp
shows the lateness honestly.

### 6. The canonical case — "order ekhono paini, 5 din hoye geche 😑"

This walkthrough assumes the tenant's founder has opted `delivery_issue` and `cod_confirm` into
`inbox.autoIntents` — the defaults stay draft-first, so out of the box these sends would be
drafts. Customer (Messenger, conversation identity-linked, journey `in_delivery`) writes at
14:02.

**Turn 1 — inline, seconds not minutes.** `get_conversation` → customerId; `get_order_status`
finds one active order **#KQ3-8FZM** — SHIPPED, Steadfast, `courierSentAt` 5 days ago,
`courierStatus` unchanged, COD ৳1,840. Two+ open orders → disambiguate by order number first;
unlinked conversation → verification gate first (§7.1) — never leak order contents to a bare
PSID. The response includes `stuck: true` computed server-side (stagnation rule: `courierSentAt
+ 4d` passed AND `courierStatus` unchanged ≥48h) — the model never decides "stuck" from prose.
Then `open_case {kind:'delivery_stuck'}` (bookkeeping verb — executes at every tier, enqueues `courier_intervention`,
emits SSE `case.opened`) and the truthful reply (`send_inbox_reply`, intent `delivery_issue`,
department shipping, full gate + human-timing pipeline):

> ভাইয়া sorry দেরির জন্য 😔 চেক করলাম — আপনার অর্ডার #KQ3-8FZM ৫ দিন আগে Steadfast-এ দেওয়া
> হয়েছে, কিন্তু ওদের দিক থেকে এখনো নতুন আপডেট আসেনি। আমি এখনই ব্যাপারটা দেখছি — কুরিয়ারের
> সাথে ফলো-আপ করে আজকের মধ্যেই আপনাকে জানাবো। Tracking: {link}
> *(Bhaiya sorry derir jonno — check korlam, apnar order #KQ3-8FZM 5 din age Steadfast-e dewa
> hoyeche, kintu oder dik theke ekhono notun update asheni. Ami ekhoni bapar-ta dekhchi —
> courier-er shathe follow-up kore ajker moddhei apnake janabo.)*

Truth audit: "দেওয়া হয়েছে" — real (`courierSentAt`). "নতুন আপডেট আসেনি" — real (unchanged
status). "ফলো-আপ করে জানাবো" — real: the case, job, and promise exist before this message
sends. No invented ETA; "kal peye jaben" is a banned utterance. The committing reply declares a
promise → NovaPromise created, `NovaCase.promiseId` set, and the server auto-enqueues the 24h
`followup` job (`payload.promiseId`) inside the same reply transaction (module 03 D8 — no
model-called verb) as the dead-man switch: if nothing moves, Nova still returns with an
honest *"এখনো নতুন খবর নেই, চাপ দিচ্ছি"* (Ekhono notun khobor nei, chap dicchi — "no news yet,
I'm pushing") rather than silence. Promise renewal caps at `chainCount ≤ 2`.

**Async — `courier_intervention` (minutes later, dispatcher lane).** (1) Fresh poll via
`/cases/:id/courier-refresh` — maybe the webhook was missed and it moved → case resolves,
skip to loop-close. (2) Still stuck → `flag_courier_issue` (always prepared): NovaDecision
`{kind:'proposal', tag:'shipping', priority:2, bundleRef:'case:<caseId>'}` — title
"Steadfast stuck 5d — #KQ3-8FZM (৳1,840 COD)", paramsLine with customer, last scan, tracking id,
consignment, the merchant's Steadfast panel link, and the recommended move ("Call Steadfast
merchant line about SF123…; if lost, rebook via RedX"). The card states the honest v1 boundary:
*"I can't contact Steadfast directly — no courier API for this. Everything you need is above."*
(3) Refund-lane gate (deterministic): customer demanded money back OR stuck ≥
`case.refundReviewDays` (default 10) OR prepaid claim exists → `escalate_conversation
{department:'finance'}` with the module 08 brief; refund execution stays FOUNDER_ONLY forever.
Day 5, COD, no demand ⇒ not yet — Finance stays quiet until warranted. (4) Findings appended to
`facts`, case → `waiting_founder`.

**The world moves** — courier webhook, founder action, or the 24h dead-man follow-up — all
converge on `case.updated` → loop-closer (§5):

> ভাইয়া আপডেট! আপনার পার্সেল Steadfast-এর হাব থেকে বের হয়েছে — আজ ডেলিভারির জন্য বের হবে।
> COD ৳1,840 রেডি রাখবেন প্লিজ 🙂
> *(Bhaiya update! Apnar parcel Steadfast-er hub theke ber hoyeche — aj delivery-r jonno ber
> hobe. COD ৳1,840 ready rakhben please.)*

— only if the raw status genuinely maps out-for-delivery via the publicTracking maps; otherwise
the accurate step. The reply executor stamps the promise kept and, if the order state is
terminal-good, sets `status:'resolved'`, `resolution:'Delivered after Steadfast follow-up;
customer informed.'`; the pending followup job is superseded.

Every ledger row written (the founder-audit table — module 09 renders these through existing
pipes):

| # | Record | type / kind | dept | status | MIN | targetRef / relatedId |
|---|---|---|---|---|---|---|
| 1 | NovaAction+Activity | `send_inbox_reply` / `inbox_reply` | shipping | executed | 3 | `inbox_message:<id>` |
| 2 | NovaAction+Activity | `open_case` / `case_opened` | shipping | executed | 3 | `case:<caseId>` / caseId |
| 3 | NovaAction (prepared) + NovaDecision | `flag_courier_issue` | shipping | prepared | 10 on approve | `case:<caseId>`, bundleRef `case:<caseId>` |
| 4 | NovaActivity | `followup_scheduled` — written by the server followup enqueue inside the reply tx (module 03 D8), no separate verb call | shipping | — | 1 | `inbox_conversation:<id>` |
| 5 | *(conditional)* NovaAction + NovaDecision | `escalate_conversation` (finance) | finance | executed — escalation is never gated | 2 | bundleRef `case:<caseId>` |
| 6 | NovaAction+Activity | `send_inbox_reply` (the update) / `inbox_reply` | shipping | executed | 3 | `inbox_message:<id>` |
| 7 | NovaActivity (nightly, only if DELIVERED) | `case_resolved` | shipping | — | 0 | relatedId caseId |

Row 7 follows module 09's rescue ethic: counted only when the order actually DELIVERS,
revenueInfluence 0 always — the order's money is already counted under sales; a rescue is a
count, never money.

### 7. Delivery conversation flows

**7.1 WISMO status quotes.** Verification gate first: identity-linked conversation → direct
order lookup; else ask order number + phone, verify by last-10-digit match server-side.
Unverified → generic help only. Quote the humanized 7-step timeline (`displayStatus`,
`statusStep`) + courier name + COD amount + public tracking link — `courierStatus` stays live
via webhooks, no poll needed. **No ETA promises ever**: no ETA column exists; Nova names the
step and the holder, and says "kal peye jaben" only when the raw status literally maps
out-for-delivery today.

**7.2 Pre-dispatch confirm + address fix + cancel intake.** Confirmation readback ping
(movement 1, §8) → explicit yes → `confirm_order_intent`. Address change while `courierSentAt`
null → `update_order_contact` (district change recomputes shipping server-side; total changed ⇒
re-confirm with the customer before writing). Cancel ask pre-dispatch → one soft save attempt
("why?" — address fix? delivery-charge objection → module 05's free-delivery-equivalent coupon),
never pushy, then `cancel_order_from_chat` (gated by `inbox.cancelAuto`). A pre-dispatch cancel
of a fake/uncertain order is a WIN — it kills an RTO before it costs courier fees.

**7.3 Delivery-problem intake ("courier phone dhore na").** Pull live status, explain in the
humanized map's language, record the request. Dakio has no reschedule API, so the copy is
honest: *"শপ ওনারকে জানিয়ে দিয়েছি, উনি কুরিয়ারের সাথে ব্যবস্থা করবেন"* (Shop owner-ke janiye
diyechi, uni courier-er shathe bebostha korben — "I've told the owner; he'll arrange it with the
courier") — never "রিশিডিউল করে দিয়েছি" ("I've rescheduled it").

**7.4 Post-dispatch address change → case.** `update_order_contact` refuses post-dispatch;
instead `open_case {kind:'address_change_postdispatch'}` → `courier_intervention` variant:
gather current courier status and whether the parcel is out-for-delivery TODAY (timing matters
enormously), then a prepared shipping card: "Rafiq wants delivery to Uttara instead of Mirpur —
parcel is with Steadfast, last scan {x}. Call SF: {tracking}. If undeliverable, let it RTO and
re-book? (re-book costs ৳120)". The customer is told the truth immediately, inline, before the
case work:

> পার্সেলটা এরই মধ্যে কুরিয়ারে চলে গেছে ভাইয়া — ঠিকানা বদলাতে পারি কিনা কুরিয়ারের সাথে কথা
> বলে জানাচ্ছি। যদি না হয়, ডেলিভারি ম্যানের নাম্বার পেলে সরাসরি বলে নিতে পারবেন।
> *(Parcel-ta eri moddhe courier-e chole geche bhaiya — thikana bodlate pari kina courier-er
> shathe kotha bole janacchi. Jodi na hoy, delivery man-er number pele sorasori bole nite
> parben.)*

No promise of success — a promise of follow-up. This flow's RTO stake is why
`courier_intervention` runs priority 3: an unreachable-address parcel IS tomorrow's RTO.

### 8. The RTO orchestra (requirements 13–14, four movements)

**Movement 1 — pre-dispatch confirmation, the highest-value ping in the product.**
`order.created` (producers exist for merchant, storefront, and chat orders) → deterministic
channel resolution in the drain: `Order.sourceConversationId` (chat orders — always) → else a
`CustomerChannel {kind:'messenger'|'instagram'}` row for the customer → a conversation with
`windowExpiresAt > now`, `handledBy` nova-or-null, `novaEnabled:true`. Channel + open window ⇒
module 04's trigger #2 fires the readback ping:

> অর্ডার কনফার্ম? {items} — {address} — COD ৳{total}। সব ঠিক আছে? 👍
> *(Order confirm? … Shob thik ache? — "Order confirmed? … everything correct?")*

Customer's explicit yes → `confirm_order_intent` → `PATCH /api/v1/store/orders/:id` sets
`confirmedAt = now`, `confirmedBy = 'nova:<actionId>'`, and emits NovaInbox `order.confirmed`
(dedupeKey `order.confirmed:<orderId>`) so the journey advances `ordered → confirmed`. Customer
corrects the address instead → `update_order_contact`, then re-confirm. **No channel / closed
window ⇒ nothing fake happens** — no SMS pretense, no synthetic ping; the order stays on the
merchant's normal confirm workflow. If `computeRtoSignals` says high AND no channel exists →
prepared card: "High-RTO order #… can't be reached in Messenger — call before dispatching?"
(voice stack is v2). **Badge**: `confirmedAt` non-null renders a CONFIRMED chip, + BY NOVA when
`confirmedBy` starts `nova:`, on the dakio-merchant orders list — additive UI keyed on existing
fields. Unconfirmed ≠ blocked: the badge informs dispatch, v1 never withholds it (founder open
question, module 12).

**Movement 2 — `computeRtoSignals` (extends `src/lib/customerRisk.js`).** Rule points over real
columns — no ML claim, no invented score:

| Signal | Source | Points |
|---|---|---|
| `riskLevel` RISK | existing `calculateCustomerRisk` | +3 |
| Prior RETURNED orders (phone-variant matched) | `Order.status:'RETURNED'` count | +2 each, cap 6 |
| `fakeProtectionAction` set on this order | fake-order guard fields | +3 |
| Unconfirmed at dispatch time (`confirmedAt` null when booking attempted) | Order columns | +2 |
| First-ever order AND outside-Dhaka district | ordersCount + district | +1 |
| Address under 20 chars ("mirpur" is not an address) | `customerAddress` length | +1 |

`rtoRisk = 'high'` ≥5, `'medium'` 3–4, else `'low'`. Consumers: confirmation-ping priority, the
`inbox.rtoShadowThreshold` chat-order draft rule (module 05), the no-channel high-risk card, and
the NBA block's risk field. Sparse signals ⇒ honest `low` — better honest-zero than loosened
definitions.

**Movement 3 — in-delivery monitoring.** Courier webhooks keep `courierStatus` live and emit
`order.updated`; the journey reducer maps SHIPPED → `in_delivery`; the stagnation sweep rule
(`courierSentAt + 4d`, status unchanged 48h) enters `at_risk {riskReason:'courier_stagnation'}`.
This module's addition: that entry auto-opens the `delivery_stuck` case + `courier_intervention`
job — the same machinery whether the customer complains first (§6) or the system notices first;
whichever fires second joins the existing case via activeKey. The proactive delay apology
(trigger #5) quotes `facts` and makes the tracked promise; window closed → prepared card.

**Movement 4 — failed-attempt rescue.** Webhook maps a failed-attempt/hold status → `at_risk
{riskReason:'failed_attempt'}` → system-opened `open_case {kind:'failed_attempt'}`
(`openedByActionId` null, facts seeded from the webhook) → if window open, immediate rescue
ping (trigger #6, support lane):

> ভাইয়া কুরিয়ার আজ আপনাকে ফোনে পায়নি 😟 কখন ডেলিভারি নিলে সুবিধা হয়? ঠিকানা বা নাম্বারে
> কোনো পরিবর্তন লাগলে বলুন।
> *(Bhaiya courier aj apnake phone-e payni — kokhon delivery nile shubidha hoy? Thikana ba
> number-e kono poriborton lagle bolun.)*

Customer responds with a time/correction → inline `update_order_contact` (pre-terminal statuses
only) + facts note the preferred slot → flag card for the merchant ("Rafiq says deliver after
6pm Thursday — tell Steadfast on the redelivery") — honest: the courier coordination is the
merchant's call. Two rescue pings unanswered → journey heads toward `lost`, case →
`closed_unresolved`, and the nightly pass writes nothing celebratory — a failed rescue counts in
`case.rescues_attempted`, not as a save. Save accounting: case resolved + order DELIVERED → the
`rto_save` activity fires under module 09's strict three-condition definition; this module adds
`failed_attempt` cases to its "flagged" condition list — the definition's owner remains
module 09.

### 9. Restock-wait machinery (`restock_wait` → inventory)

Module 05's honest OOS answer offers alternatives; customer insists ("na vai, oitai lagbe") →
`open_case {kind:'restock_wait', productId}` → `restock_check` job. The job reads what actually
exists: open Purchase/PO rows for the product + dropship warehouse inventory. **Honesty fork**:
a PO with a real expected date → facts get `{restockEtaSource:'purchase_order:<id>',
expectedAt}`; nothing on order → `{restockEtaSource:null}` AND a prepared inventory card via the
existing `suggest_restock` advisory ("৩ জন কাস্টমার এই প্রোডাক্টটা চেয়েছে — restock করবেন?" —
*3 jon customer ei product-ta cheyeche — restock korben?* — demand count as evidence).
Loop-close (a), dated: *"স্টকে আসছে ইনশাআল্লাহ {week} — আসা মাত্রই আপনাকে জানাবো!"* (Stock-e
ashche inshallah {week} — asha matroi apnake janabo) — dated promises ONLY from a real PO date,
else "শীঘ্রই" (shighroi — "soon") plus the truthful we'll-ping-on-arrival. Loop-close (b): stock
flips 0→positive — module 04's trigger #9 detects it; **one-ping coordination rule
(test-pinned): the open case suppresses the generic restock ping — trigger #9's send resolves
the case and stamps the promise. One ping, not two.** One product, many askers: the shared
dedupeKey fans one job out to N open cases → N individual in-window, in-register updates. The
restock ping that converts is a sales act (ledgered sales, 3); `case.restock_converts` = case
resolved → order within 7d under module 04's direct-cause rule.

### 10. Damaged-item case (`damaged_item` → support)

Module 07 owns the intake conversation (verify order, collect reason + photo). This module adds
the coordination: `open_case {kind:'damaged_item'}` + a prepared replacement decision
`{tag:'support', bundleRef:'case:<caseId>'}` carrying the photo link, order facts, a live stock
check for the replacement variant, exchange-first recommendation, and the cost line
("replacement cost ৳480 vs refund ৳1,840"). Founder approves replacement → **honest reverse-
logistics boundary**: no reverse-pickup courier API exists, so execution = a structured ops task
in `facts` + a founder checklist (book return pickup; new order manually drafted) — v1 does NOT
auto-create a ৳0-COD replacement order (v2, once the approval pattern proves out). The ops task
activity (operations, 5, relatedId caseId) is the operations room's first inbox-born row.
Loop-closer on approval: *"নতুনটা পাঠানোর ব্যবস্থা হয়ে গেছে ভাইয়া! পুরনোটা কুরিয়ার এসে নিয়ে
যাবে — আজ-কালকের মধ্যে ডিটেইলস জানাবো।"* (Notun-ta pathanor bebostha hoye geche bhaiya!
Purono-ta courier eshe niye jabe — aj-kalker moddhe details janabo.) Refund chosen instead →
founder-only path; Nova only relays what the founder decided.

Also wired here: the `order.item_unfulfillable` producer (dedupeKey
`unfulfillable:<orderId>:<itemId>`) emitted where the merchant/ops flow marks an order item
unavailable (the orders item-PATCH handler) — module 04's trigger #7 consumes it
(prepared-at-all-levels stock-issue card; bad news + alternatives = founder judgment early on).

### 11. Concurrency + authority limits

**11.1 Two conversations, one order.** FB thread + IG thread (same human self-identified on
both, or a spouse asking about the same parcel): `POST /cases` create-or-join under the
activeKey unique claim ⇒ one case, one `courier_intervention` job, one flag card — the founder
is never asked twice. The loop-closer fans out to EVERY conversation in
`refs.conversationIds`, each send individually window-checked, register-matched, gated. The
second asker's inline turn sees the embedded `openCase` on its order read and answers from it:
*"হ্যাঁ, এটা নিয়ে কাজ চলছে — কুরিয়ারের সাথে ফলো-আপ করছি, আপডেট পেলেই জানাবো"* (Hae, eta niye
kaj cholche — courier-er shathe follow-up korchi, update pelei janabo) — coherent company, not
two bots.

**11.2 Dept job racing a founder manual action.** Every dept job's first step re-reads order +
case (fire-time re-check discipline). Order already moved / case resolved / founder acted since
enqueue → complete as `skipped:founder_handled`, facts note it — and the customer update
**still goes out** via `case.updated`: the founder's fix IS the resolution, Nova relays it —
*"মালিক নিজে দেখে নতুন কুরিয়ারে বুক করে দিয়েছেন ✅"* (Malik nije dekhe notun courier-e book
kore diyechen — "the owner looked at it himself and re-booked with a new courier"). Case
resolution auto-settles its open `bundleRef` decisions as `expired` with note "resolved outside
the card" (generalizing the founder-manual-reply settle pattern); double-execution stays
impossible via the existing conditional `updateMany` claim.

**11.3 No autonomy inheritance.** Every dept action — inline or job — re-resolves
`performAction → evaluateAuthority` with its own verb, duty, and door mode. Inbox T3 does not
make `flag_courier_issue` auto-execute (forced-prepared regardless) and lifts nothing in the
finance lane (refunds FOUNDER_ONLY). Job sessions run `principalType:'runtime'`, customer
sessions `principalType:'customer'` — both structurally denied the trust plane; no path exists
where customer pressure or job automation approves a decision. The one thing that DOES flow:
customer-facing sends produced by dept work route through `door:inbox` like any reply. At T0
Shadow the orchestra genuinely runs — cases open (bookkeeping verbs execute at every tier per
module 08's SS8 carve-out), jobs poll, ledger rows and cards land — EXCEPT customer-visible
sends, which surface as drafts: identical orchestra minus customer-visible sends (drafted).
This is why the module ships safely at T0. Escalation is never gated at any tier.

**11.4 Loop-closer vs new inbound.** A customer double-texting while a `case_update` is in
flight is serialized onto the same session by the channel's busy-409 queue — the model sees the
case update AND the new message in order and composes one coherent reply. The `InboxOutbound`
cancel-on-inbound rule (`cancelReason:'new_inbound'`) covers the already-queued-send window.

### 12. Metrics + founder surface contract (rendered by 09/10)

Metric keys (all derived from NovaCase + ledger joins, nightly, measured-only): `case.opened`,
`case.resolved`, `case.median_resolution_hours`, `case.promises_kept_pct` (only from
executor-stamped `keptAt`), `case.stuck_orders_rescued` (shipping), `case.restock_waits_opened`
/ `case.restock_converts` (inventory/sales), `case.address_changes_attempted` / `_succeeded`
(succeeded = order later DELIVERED, strict), `case.rescues_attempted` (support),
`case.replacements_completed` (support). Existing keys (`rto_saves`, exchange/payment families)
keep their module 09/05/07 owners.

Founder surfaces (server contract here, UI in module 10): `GET /api/nova/cases?status=` — the
"customers needing attention" list (req 30) with each row linking its decisions + conversation;
`waiting_founder` counts badge the sidebar inbox dot via existing DOOR_OF plumbing; conversation
header case chip keyed on `openCaseId` added to the meta.js conversation response; the promises
panel (module 03/10) includes case promises with `case.promises_kept_pct`; morning-brief lines
come from rows, never model memory ("Yesterday: 2 delivery cases opened, 1 resolved, 1 waiting
on you 14h").

---

## Data model

New model (one additive migration):

```prisma
model NovaCase {
  id               String    @id @default(cuid())
  tenantId         String
  kind             String    // delivery_stuck | failed_attempt | payment_unverified |
                             // damaged_item | address_change_postdispatch | restock_wait
                             // ('wholesale_inquiry' reserved, v2)
  status           String    @default("open")
                             // open | waiting_dept | waiting_founder | waiting_customer |
                             // resolved | closed_unresolved | expired
  department       String    // owning lane: shipping|finance|support|inventory|operations|sales
  activeKey        String?   // "<kind>:order:<orderId>" (or ":product:<id>", ":conv:<id>")
                             // while open; NULLED on close. The @@unique claim IS the dedupe.
  conversationId   String?   // origin thread. PLAIN STRING, no FK — survives the Meta
                             // data-deletion hard-delete cascade (rule 17, canonical-decisions)
  orderId          String?
  customerId       String?
  journeyId        String?
  title            String    // "Order #KQ3-8FZM stuck with Steadfast 5 days"
  facts            Json      @default("[]")  // append-only [{at, source, note, data?}]
  refs             Json      @default("{}")  // {actionIds[], decisionIds[], jobIds[], conversationIds[]}
  promiseId        String?   // -> NovaPromise.id (module 03's single promise store; no
                             // embedded promise Json — one store, executors stamp keptAt there)
  openedByActionId String?   // null when system-opened (webhook / sweep)
  resolvedAt       DateTime?
  resolution       String?   // one honest sentence
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([tenantId, activeKey])   // Postgres: multiple NULLs allowed → closed cases free the key
  @@index([tenantId, status, kind])
  @@index([tenantId, orderId])
  @@index([tenantId, conversationId])
}
```

Changed models: **none in this module.** `Order.confirmedAt`/`confirmedBy` already exist (this
module is their first writer, `'nova:<actionId>'` convention); `Order.novaActionId` /
`sourceConversationId` / `sourceChannel` land in module 05's migration; InboxConversation
columns land in modules 01/03/08/11. Guardrail platform keys consumed here (flat namespace,
fail-closed): `case.refundReviewDays` (10), `case.expiryDays` (14), `inbox.cancelAuto` (false),
`inbox.rtoShadowThreshold` (2).

Migration notes: additive only; no backfill. `promiseId` is a plain string reference (no
relation clause needed — NovaPromise itself uses plain-string conversationIds for the same
Meta-deletion reason). Cases are intentionally NOT in the Meta data-deletion cascade: the
transcript dies, the operational record survives with a dangling conversationId (module 01
executes the deletion path).

---

## APIs & interfaces

**dakio-api — service surface** (mounted on the module-01 `/api/v1/inbox` router:
`authenticateNovaService + requireTenant`, writes idempotent via `w()` / `Idempotency-Key`):

| Route | Purpose / shape |
|---|---|
| `POST /api/v1/inbox/cases` | create-or-join. Body `{kind, orderId?, productId?, conversationId, title, factsNote?}` → tx insert with activeKey; P2002 → load open case, append conversationId to `refs.conversationIds`, return `{case, joined:true}`. Enqueues the kind-mapped dept job in the same tx |
| `GET /api/v1/inbox/cases?status=&kind=&orderId=` · `GET /cases/:id` | reads for `get_case` and sweeps; caseOut = full row + derived `ageHours` |
| `PATCH /api/v1/inbox/cases/:id` | facts append (server merges, never replaces), status transitions, resolution. Promise stamping is executor-internal — NOT PATCH-able by the model |
| `POST /api/v1/inbox/cases/:id/courier-refresh` | live courier re-poll (wraps the `orders.js:1551` internals); writes result into `facts`, returns it |
| `PATCH /api/v1/store/orders/:id` (extended — this module owns the FULL extension) | gains `confirm:true` writeback → sets `confirmedAt`/`confirmedBy`, emits `order.confirmed`; gains `address`/`city`/`district` fields. A district change recomputes the shipping fee server-side (dhaka vs outside, tenant defaults). Re-confirm rule: any address change resets `confirmedAt` to null — re-confirmation with the customer is required before dispatch |

**dakio-api — merchant surface** (JWT): `GET /api/nova/cases?status=open|waiting_founder` →
`[{id, kind, status, department, title, ageHours, orderNumber?, conversationId?, decisionIds[]}]`;
`/api/meta/conversations(/:id)` responses gain `openCaseId String?`.

**Events produced** (NovaInbox, minimal-id payloads — message content never rides the bus):
`case.updated` (`case.updated:<caseId>:<source>:<key>`; sources `courier|founder|job`) ·
`order.confirmed` (`order.confirmed:<orderId>`) · `order.item_unfulfillable`
(`unfulfillable:<orderId>:<itemId>`). SSE: `case.opened` on the existing merchant bus.

**nova-ai — tools** (job-session extras for dispatcher lanes; inline exposure per §4):

| Tool | inputSchema (summary) | Verb / risk |
|---|---|---|
| `get_case` | `{caseId}` → caseOut + facts | read-only |
| `open_case` | `{kind, orderId?, productId?, conversationId, title, factsNote}` | `open_case` · low, bookkeeping — executes at every tier |
| `flag_courier_issue` | `{caseId, orderId, courierType, trackingId, reason, recommendation}` | `flag_courier_issue` · low, forced-prepared ADVISORY |
| `confirm_order_intent` | `{orderId, conversationId, confirmedText}` | `confirm_order_intent` · low, auto T1+ |
| `update_order_contact` | `{orderId, conversationId, address?, city?, district?, phone?}` | `update_order_contact` · low, pre-dispatch only |
| `cancel_order_from_chat` | `{orderId, conversationId, reason}` | `cancel_order_from_chat` · low, `inbox.cancelAuto`-gated |

Channel/instruction changes: `agent/channels/internal.ts` gains the `case_update` /
`courier_intervention` / `restock_check` job branches (case_update re-joins the customer session
via `args.receive(customerChannel, …)` — the module-01 cross-channel mechanism);
`agent/instructions/50-customer-inbox.ts` gains the inline-vs-job hard table (§2) and the case
rules ("open cases before promising follow-ups; quote case facts, never event payloads");
`agent/lib/jobs/prompts.ts` gains the three job prompt renderers with the fire-time re-check
preamble.

---

## Files touched

**dakio-api**
- `prisma/schema.prisma` — NovaCase model (new block).
- `src/lib/novaCase.js` (new) — create-or-join tx, kind→department map, facts merge, expiry
  close, bundleRef decision auto-settle, `case.updated` emit helpers.
- `src/routes/novaInbox.js` — cases routes (§ APIs) mounted on the module-01 router.
- `src/lib/customerRisk.js` — `computeRtoSignals()` added beside `calculateCustomerRisk`.
- `src/routes/webhook.js` — open-case lookup on status change → `case.updated`; failed-attempt
  statuses → system-opened `failed_attempt` case + rescue-trigger event.
- `src/routes/novaJobs.js` — `JOB_KINDS` + `PRIORITY_BY_KIND` additions;
  `drainEventsToJobs` `case.updated` branch + movement-1 channel resolution on `order.created`.
- `src/lib/novaEvents.js` — `emitCaseUpdated`, `emitOrderConfirmed`, `emitItemUnfulfillable`.
- `src/lib/novaExecutors.js` — `EXECUTORS.open_case` / `confirm_order_intent` /
  `update_order_contact` / `cancel_order_from_chat`; `ADVISORY` += `flag_courier_issue`;
  reply-executor promise-stamp hook for `payload.caseId`.
- `src/routes/novaDashboard.js` — `GET /api/nova/cases`; decision-settle on case resolution.
- `src/routes/novaStore.js` — full `PATCH /api/v1/store/orders/:id` extension: `confirm`
  writeback + `order.confirmed` emit; `address`/`city`/`district` fields with district-based
  shipping-fee recompute (dhaka vs outside, tenant defaults) and the address-change →
  `confirmedAt` reset (re-confirm before dispatch).
- `src/routes/orders.js` — item-unfulfillable emit in the items-PATCH handler.
- `src/routes/meta.js` — `openCaseId` on conversation responses.

**nova-ai**
- `agent/lib/types.ts` — ActionType union += the five verbs.
- `agent/lib/nova/schemas.ts` — five zod payloads.
- `agent/lib/nova/autonomy.ts` — RISK_CLASS entries + fail-closed guardrail branches
  (`flag_courier_issue` forced needs_approval; `inbox.cancelAuto`; pre-dispatch checks).
- `agent/lib/nova/authority.ts` — TARGET_TEXT extractors (Bangla NFC).
- `agent/lib/nova/activity.ts` — MINUTES_BY_ACTION entries (3/10/2/5/6).
- `agent/lib/nova/executors.ts` + store client — five executors + `get_case` read.
- `agent/tools/` — `get_case.ts`, `open_case.ts`, `flag_courier_issue.ts`,
  `confirm_order_intent.ts`, `update_order_contact.ts`, `cancel_order_from_chat.ts` (new).
- `agent/channels/internal.ts` — three job branches incl. `args.receive` loop-closer.
- `agent/lib/jobs/prompts.ts` — job prompt renderers with fire-time re-check preamble.
- `agent/instructions/50-customer-inbox.ts` — inline-vs-job table + case rules.

**dakio-merchant**
- orders list — CONFIRMED / BY NOVA chip component keyed on `confirmedAt`/`confirmedBy`.
- inbox conversation header — case chip keyed on `openCaseId` (render detail in module 10).

---

## Testing

dakio-api (node:test, files ADDED to the package.json `test` list):
- `src/lib/novaCase.test.js` — model/coordination unit tests.
- `src/routes/novaInbox.cases.test.js` — route + race tests.
- `src/lib/customerRisk.rto.test.js` — `computeRtoSignals` rule table.

Highest-value cases:
1. **Create-or-join race**: two concurrent `POST /cases` with the same activeKey → exactly one
   row, second gets `joined:true`, exactly one `courier_intervention` job.
2. **Promise ungameable**: `PATCH /cases/:id` with promise fields → rejected; only the reply
   executor with `payload.caseId` + real send stamps `NovaPromise.keptAt`.
3. **Fail-closed guardrails**: `cancel_order_from_chat` with `inbox.cancelAuto` missing from
   platform keys → verdict `needs_approval`; `flag_courier_issue` at inbox T3 → still prepared
   (the no-inheritance pin).
4. **Skipped-founder-handled relay**: founder resolves the order while `courier_intervention` is
   queued → job completes `skipped:founder_handled`, `case.updated` still emitted, open
   bundleRef decisions settle `expired`.
5. **One-ping coordination**: open `restock_wait` case + stock 0→positive → trigger #9's send
   resolves the case; no second generic restock ping (assert single outbound row).
6. **Webhook → loop-close idempotence**: replayed courier webhook with the same status → one
   `case.updated` event (dedupeKey), one `case_update` job per 30-min bucket.
7. **Post-dispatch refusal**: `update_order_contact` on an order with `courierSentAt` set →
   executor refuses; `address_change_postdispatch` case path opens instead.
8. **Confirm writeback**: `confirm_order_intent` → `confirmedAt` set, `confirmedBy`
   `nova:<actionId>`, `order.confirmed` emitted once (dedupe on replay).

nova-ai: repo suite additions — verb registration completeness (every new ActionType present in
RISK_CLASS / TARGET_TEXT / MINUTES_BY_ACTION — the missing-entry-reads-high trap), loop-closer
branch test (case_update job → `args.receive` into `customer:inbox:<id>` → reply flows through
`performAction`, never raw send), plus the isolation suite for the case routes (tenant A cannot
read tenant B's cases — tenancy is touched).

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Triple-ping bot-smell** — case_update + lifecycle trigger + dead-man followup all speak about the same parcel (worst customer-facing failure with double-sends) | medium | Coordination rules each test-pinned: open case suppresses generic pings; one open followup per conversation; 30-min bucketed case updates; `InboxOutbound` cancel-on-inbound |
| Stale truth in updates — customer told an event that has since been superseded | medium | Quote-at-send re-read (guarantee 1) is the invariant; test-pinned |
| Job sprawl on a courier-meltdown day starves the 10-jobs/tenant/tick budget | low-medium | Bucketed dedupe (one update per case per 30min), priority ordering (inbox replies stay 1), claim-queue depth alarm in module 12's perf gate |
| `promises_kept_pct` gaming | low | Only executors stamp `keptAt`, only on real sends; founder tap-send of a skipped_window draft stamps kept-late honestly |
| Case/journey drift confusing founders | medium | Hard boundary documented + enforced: journey = lifecycle stage, case = operational episode; reducer never reads cases, cases never move stages; divergence acceptable by design |
| Advisory fatigue — founder stops reading flag cards | medium | v1 keeps card sources few (stuck, failed-attempt, restock demand, replacement, no-channel high-risk); every card carries a real ৳ or customer-waiting stake in impactLabel; monitor approve/ignore rates |
| Wrong-person leak via unverified WISMO | low | Verification gate before any order detail (identity link or order#+last-10 phone match); generic help otherwise — test-pinned in module 02's route guards, exercised here |

---

## Gate

Scripted demo (non-builder, clean staging store, Nova at T1):
0. Precondition: the demo tenant's founder opts `delivery_issue` and `cod_confirm` into
   `inbox.autoIntents` (Settings → Nova → Inbox) — defaults stay draft-first for real tenants.
1. Book a staged order to a sandbox courier; simulate 5 days stuck. DM "order ekhono paini" from
   a linked test conversation → within 90s: truthful Bangla reply (no ETA), a case visible in
   `GET /api/nova/cases`, a shipping flag card on the Decision Desk stating the honest no-API
   boundary, and a commitment row in the promises panel.
2. Simulate the courier webhook flipping to out-for-delivery → within one dispatcher tick +
   pacing, the SAME thread gets one (and only one) update quoting live state; the promise shows
   kept; the case shows resolved; shipping room shows every row from the §6 audit table.
3. Place a chat order → confirmation readback ping → reply "hae thik ache" → CONFIRMED · BY
   NOVA badge appears on the merchant orders list; `order.confirmed` visible in the journey.
4. Simulate a failed-attempt webhook → rescue ping arrives (window open); reply with a new
   address → `update_order_contact` executes pre-dispatch; repeat post-dispatch → refusal +
   `address_change_postdispatch` case + prepared card, and the customer got the honest line.
5. Flip the tenant to T0 Shadow, repeat step 1 → the orchestra genuinely runs (the case opens,
   the job polls, ledger rows write) EXCEPT customer-visible sends, which surface as drafts —
   identical orchestra minus customer-visible sends (drafted).

Measurable checks: create-or-join race test green; fail-closed guardrail tests green (missing
key ⇒ needs_approval); one-ping coordination test green; `case.promises_kept_pct` on staging
computes only from executor stamps; zero raw courier status strings in any customer-visible
send (grep the InboxOutbound corpus against the publicTracking vocabulary).

Rollback without deploy: pause the lanes by flipping the three job kinds' NovaJobDef rows to
disabled (jobs stop being claimed; cases persist harmlessly) · `PATCH door:inbox` mode back to
`assisted` (everything drafts) · per-thread `novaEnabled:false` · guardrail flips
(`inbox.cancelAuto:false` etc.) take effect on next verdict — all config, no code path removed.

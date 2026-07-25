# Module 03 — Customer Identity & Memory: AS BUILT

**Status:** built, tests green, human verification pending (F-18…F-24 in
[`docs/HUMAN-VERIFICATION-REQUIRED.md`](../../HUMAN-VERIFICATION-REQUIRED.md)).
**Commits:** dakio-api `536f69e` (prologue) → `2df95a5` (streams) → `34612ba` (cross-stream fixes) →
`6bcec58` (review fix pass) → `+1` (verifier fix pass); nova-ai `9e6c3f7` → `8878d8a` → `79d5d83` →
`fc383d1` (review fix pass) → `+1`. Branch `feat/front-office` in both.

> **Why this file exists.** The module doc ([`03-customer-identity-memory.md`](./03-customer-identity-memory.md))
> is the plan and stays LAW on intent. This is what actually got built — the deltas, the decisions, and the
> contracts modules 04–12 will call. It exists because building module 03 cost an hour of recon rediscovering
> that the plan's "already real" column was wrong in 37 places. **Read this before trusting any module doc's
> claim that something already exists.** Write one of these for every module.

---

## 1. What a fresh reader most needs to know

The module-03 doc's **"Already real (recon evidence)" column is not reliable**, and neither are the file:line
coordinates anywhere in the Stage-10 module docs — every one checked was stale. The docs were written before
modules 01/02 landed and were never re-synced. **Navigate by reading and grepping, never by their line numbers.**

Concretely, module 03's doc claimed five things that were false: that module 01 added an index on
`InboxConversation.customerId` (it did not), that a `PATCH /conversations/:id` route existed (it did not), that
`customerSummaryOut` existed to be replaced (it never existed), that the `followup` job kind was registered
(it was cancelled in two places and registered in none), and that `CustomerChannel` needed doc-comment updates
(module 01 had already written all of them). Assume module 04's doc has the same class of error.

---

## 2. What shipped

### Identity linking — `dakio-api/src/lib/customerLink.js`

The confidence ladder of D2, with the design bias that **ambiguity resolves to "unknown customer"**.

| Rung | Trigger | `customerLinkSource` |
|---|---|---|
| HIGH (a) | order created in-thread | `order_created` — path exported as `linkConversationToCustomer`, **no caller yet** (module 05 wires it) |
| HIGH (b) | customer states their own phone, matching exactly ONE Customer | `phone_stated` |
| HIGH (c) | a `CustomerChannel` spoke already carries a customerId | `channel_backref` — at ingest, zero model involvement |
| HIGH (d) | founder links manually | `founder_manual` |
| MEDIUM | name + one context signal | proposal only — `proposedCustomerId`/`proposedBasis`, **grants zero data access**. ⚠️ **NO PRODUCER** — see below |
| NEVER | name alone, avatar, style, third-party phone, >1 variant match | no link, no proposal |

⚠️ **The MEDIUM rung is built but unreachable.** `proposedCustomerId` is written only by
`patchConversationHandler`, and no StoreClient method or tool sends that field — so Nova cannot author a
proposal, and `linkByDigitCheck` therefore never has a candidate to verify against. The whole digit-verification
flow (the question scripts, the one-attempt burn, the zero-leak fallback) is implemented and tested but can only
be exercised by a hand-crafted PATCH. **This is why gate step 2 cannot pass.** Whoever needs it must decide
whether to ship a propose path or defer the rung; do not assume it works because the code exists.

Three things a later module must not undo:

- **The verify candidate is the server's, not the caller's.** `verify.customerId` arrives on the wire but is
  *not* what selects the row — the only candidate ever tested is the conversation's own `proposedCustomerId`.
  A caller who could name the candidate could walk the customer table two digits at a time. The zod field is
  `.optional()` and documented as advisory.
- **One verification attempt per candidate per conversation**, enforced by a receipted `blocked` NovaAction
  burn row (`{conversationId, candidateId}`, no digits/name/phone). `verifyBurned` fails **closed**. This is
  the one mechanism invented beyond the doc — there was no schema column for a burn list.
- **Link only, never create.** Customers materialize through orders. A phone matching zero Customers is stored
  as `claimedPhone` and the join materializes later.

### Customer-360 — `dakio-api/src/lib/customer360.js`

`buildCustomer360(tenantId, conv)` → the block injected above the transcript. **One assembly point, therefore
one redaction point.** Full phone masked (`017••••••89`); street address never present (`hasAddressOnFile` +
city/district only); caps enforced in code (`MAX_OPEN_ORDERS` 3, `MAX_PROMISES` 5, `MAX_PREFERENCES` 5 × 120
chars); `C360_TOKEN_BUDGET` 530 with a **documented degradation ladder** that trims preferences first (leaving
a `+N more withheld` marker so a shortened list can't read as complete) and never amputates a promise.
Measured fill: 468 realistic / 492 maximal.

Everything it says about an order goes through `src/lib/orderDisplayStatus.js`, **the same humanizer the public
tracking page uses** — extracted from `publicTracking.js` and re-pointed in the same commit, so Nova cannot
name a courier, amount or tracking code that differs from the link the customer can open.

Fields that honestly emit `null` because nothing sources them: `identity.callName`, `profile.languagePref`,
`profile.addressForm`, `journeyStage` (module 04). `flags.repeat_window` is **never emitted** (no definition
anywhere — module 04's `stageData.medianGapDays` is the intended input). `openComplaints[].status` never
emits `'resolved_recent'` — it has no source.

### Promise ledger — `dakio-api/src/lib/novaPromises.js`

`NovaPromise` stores what Nova **owes** (as distinct from memory, which stores what it believes).

- Co-created inside the reply `$transaction`, **deleted with the send if that send is ever cancelled** — an
  unsent promise was never made. Every cancel path reaches `deletePromisesForOutbound`: the seven callers of
  `inboxSender.js`'s `settle`, the zero-delivery exit that bypasses `settle`, and four sites in `meta.js`, each
  reading outbound ids *before* its `updateMany` (an `updateMany` returns no ids).
- **`kept` only on a Graph-confirmed send**, via a two-phase claim/proof, because nothing on the wire says
  "this reply fulfils promise X" until the model sets `promiseId`:
  - the CLAIM is recorded by whichever lane approved the reply — nova-ai's executor on the live lane,
    `claimKeptBy` in `novaExecutors.send_inbox_reply` on the **Decision Desk** lane. Both are needed: the Desk
    is the only lane that exists in shadow mode, and for a while it was missing, so approving the very draft
    that answered a debt left it open for the sweep to card as broken.
  - the PROOF is `onOutboundSent`, when Graph confirms a bubble.
  Never call `stampKept` from an approve path — a 200 from `enqueueInboxReply` means QUEUED, and that
  function's comment records what claiming delivery there cost last time. Use `claimKeptBy`.
- Nightly sweep: `runPromiseSweep` → break overdue → recovery card → `runPromiseWindowLadder` →
  `purgeSettledPromises` (24-month retention, purge runs **last** so tonight's break is carded first).

### Privacy — `dakio-api/src/lib/novaMemoryGuard.js`, `conversationDistill.js`, `meta.js`

The guard **rejects rather than scrubs**, at both memory write routes, so the model is told why and does not
retry. Bengali digits are latinized and BD phones exempted *before* the deny list runs — a `+880` number is
exactly 13 digits, which is also an old-format NID.

`conversation_distill` **cannot distill and says so** — in the header, in its return value
(`distilled: 0, factSource: null`) and in a live counter `inbox.memory.distill_unavailable`. Extraction is a
language judgement and the sweep lane is deliberately model-free. The write half (`applyDistilledFacts`) is
built, guarded, capped at 3, correctly keyed and tested, so **wiring a fact source is one call.**

---

## 3. Frozen contracts later modules call

**dakio-api routes** (all `/api/v1/inbox`, `authenticateNovaService + requireTenant`, writes `w()`-idempotent):
`PATCH /conversations/:id` · `POST /conversations/:id/link-customer` · `GET /promises` ·
`PATCH /promises/:id` · `POST /customers/merge`.

**Functions a sibling module is expected to call:**

| Signature | Who calls it |
|---|---|
| `linkConversationToCustomer(tenantId, conversationId, customerId, source, db?)` | **module 05** — the HIGH(a) link after `create_order_from_chat` |
| `createFounderPromise(tenantId, {conversationId, customerId, channelKind, text, kind, dueAt, graceHours?}, db?)` | **module 08** — the hand-back sheet's quick-picks (accepts module 08's `tx`) |
| `openPromisesForCustomer(tenantId, customerId)` | the 360 block; module 08's brief |
| `promiseKeptRate(tenantId, opts?, db?)` | **module 09** — computed from rows, never counters |
| `authorDecision(tenantId, input, db?)` | any module needing the `action.create + decision.create` pair |
| `humanizeOrderStatus({status, courierStatus, dropshipFulfillment, tenantActiveCourier})` | **module 06** — do not write a second status map |
| `guardMemoryValue({namespace, key, value})` | any new memory write path |
| `applyDistilledFacts(tx, {tenantId, conv, now, facts})` | whoever wires a distillation fact source |
| `mergeCustomerRecordsInTx(tx, tenantId, {customerIdA, customerIdB})` | the merge executor + the route |

**nova-ai:** verbs `link_customer_identity` (in `NEVER_GATED`) and `merge_customer_records` (in the new
`ALWAYS_DRAFT`); job kinds `followup`, `promise_sweep`, `identity_merge_sweep`, `conversation_distill`;
`StoreClient` methods `linkCustomer` / `unlinkCustomer` / `mergeCustomers` / `listPromises` / `settlePromise`;
tool `link_customer` (customer-plane); instruction rules **16** and **17** (15 still reserved for module 11).

---

## 4. Decisions that bind later modules

The full 40 are in the session record; these are the ones a later module will trip over.

1. **`followup` is registered by module 03, owned by module 04.** Module 04 must EXTEND, not replace — and its
   supersede-on-inbound rule **must skip rows carrying `payload.promiseId`** (a customer coming back
   supersedes a nudge, but does not discharge a debt). The cancel site in `meta.js` carries this comment.
2. **`NEVER_GATED` returns before the guardrail check AND the level ceiling.** `link_customer_identity` runs at
   every tier including T0 Shadow. Safe only because the *server* decides the link. Duty-pause still wins.
3. **`ALWAYS_DRAFT` is a new mechanism**, not a checklist row. `riskClass:"high"` does NOT always-draft —
   level 4 returns `execute`; `FOUNDER_ONLY` returns a refusal + escalation, not a draft.
4. **`remember` stays founder-only** — diverges from the doc's D9. Reopening it re-opens the injection hole
   module 02 closed and two shipped evals pin. `conversation_distill` is the sole customer-memory writer.
5. **Promise kind enum is the doc's nine values**, byte-equal in `NovaPromise.kind` and nova-ai's
   `PROMISE_KINDS`. Module 08's quick-picks use a strict subset.
6. **The 360 matches the public tracking page exactly**, including its non-fallback courier ternary. Module 06
   must not introduce a second source of delivery truth.
7. **"Terminal" for `openOrders` is `customerRisk.js`'s `TERMINAL_STATUSES` (includes `DELIVERED`)**, not
   `publicTracking`'s `step < 0`. Two disagreeing definitions exist on purpose; a test pins which.
8. **LTV is delivered-basis everywhere** (`src/lib/customerLtv.js`), shared by the 360 and `novaStore.js`'s
   `customerOut`. Counts and dates stay booked-basis.
9. **Metrics: `recordMetric` has no label dimension** — bake labels into the key
   (`inbox.identity.linked.<source>`). It is an in-process Map, wiped on restart and per-replica; anything
   founder-facing must come from rows.

---

## 5. Known-not-built, with owners

| Gap | Owner | Note |
|---|---|---|
| `conversation_distill` has no fact source | unassigned | write half done + tested; one call to wire |
| `journeyStage` is always `null` | module 04 | guarded on `prisma.customerJourney` so it survives 04 landing mid-flight |
| `flags.payment_claim_pending` proxies `lastIntent` | module 05 | real predicate is an open `verify_payment_slip`, which exists nowhere |
| `flags.high_value` is history-only | module 05 | live-cart half needs quote state |
| `flags.repeat_window` not emitted | module 04 | no definition exists; do not guess a window |
| `openComplaints` synthesized from `InboxConversation` | module 06 | `NovaCase` does not exist |
| Founder promise capture has no route | module 08 | function shipped; module 08 owns the handover state machine |
| `inbox.promise.kept_rate` not on the Support room | module 09 | function shipped; needs 09's roll-up |
| Cross-platform merge review UI | v2 | detection + Decision shipped |
| The MEDIUM proposal rung has no producer | unassigned | code + tests exist; nothing can author a proposal, so digit verification is unreachable (gate step 2) |
| Merchant Inbox does not render the link | module 10 | `GET /api/meta/conversations` returns no `customerId` and no customer name, so a linked thread looks identical to an unlinked one (gate step 1) |
| `inbox.c360.assembly_ms` P95 not computable | module 09 | `recordMetric` keeps a running SUM in an in-process Map — no histogram, no percentile, no HTTP read surface |
| `keptRate` unreachable from nova-ai | module 09 | the server returns it on `GET /promises`; no nova-ai code reads it |
| No out-of-window delivery route | — | `src/lib/sms.js` is OTP-only; broadcasts are prepared and held. **Do not build an sms lane and do not pretend one exists.** |

---

## 6. Baselines and how to check them

```bash
cd dakio-api && npm test            # 1125 tests, 1124 pass, 1 skipped, 0 fail
cd nova-ai   && npx tsc --noEmit    # 0 errors
cd nova-ai   && npm run test:inbox  # 518 checks (identity 58 · c360 32 · promises 96 · privacy 33 + 299 base)
cd nova-ai   && npx eve info        # 0 errors, 0 warnings
cd nova-ai   && npm run check:undo  # 16 verbs
```

Two standing traps:

- **`dakio-api/package.json` enumerates test files explicitly and `node --test` SILENTLY tolerates a missing
  one.** A typo means zero coverage with a green build. Re-run a wired-vs-disk diff after adding tests. ~30
  tracked test files are still unwired, including `src/routes/nova.test.js`.
- **nova-ai `npm test` is RED** at the isolation step (founder context 3085 > 2500) and has been since before
  this module — recorded as **F-20**. It is an `&&` chain, so everything after that step never runs. Run
  suites individually against the baselines above. **Do not report `npm test` as green.**

---

## 7. If you are starting module 04

Module 04 (lifecycle & NBA) is the next unblocked module. It depends on 01, 02, 03 — all shipped.

What is already yours: the `followup` job kind and its dispatcher branch (promise-backed follow-ups rejoin
`customer:inbox:<id>`; yours will too), `PLATFORM_JOB_DEFS` for the nightly lane, `authorDecision` for cards,
and `journeyStage` already threaded into the 360 block awaiting your reducer.

What you must not break: the promise-backed `followup` skip rule (§4.1), the 360's field contract (adding
`CustomerJourney` must fill `journeyStage` through the existing guard, not bypass the serializer), and the
`repeat_window` flag that module 03 deliberately left unemitted — define it before emitting it.

Start by re-deriving your doc's "already real" column against the code. Budget an hour; it will find things.

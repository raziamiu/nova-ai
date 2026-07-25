# Module 04 — Lifecycle & NBA: AS BUILT

**Status:** built, tests green, human verification pending (F-29…F-35 in
[`docs/HUMAN-VERIFICATION-REQUIRED.md`](../../HUMAN-VERIFICATION-REQUIRED.md)).
**Commits:** dakio-api `00ae69c` → `b4b8c8d` → `7babd1a` → `c4bf548`;
nova-ai `4920a23` → `87a70db` → `c3ae57f` → `a1f5e9d`. Branch `feat/front-office`.

> Read [`AS-BUILT-03.md`](./AS-BUILT-03.md) first if you are new — its §1 explains why these files exist and
> why no Stage-10 module doc's "already real" column or file:line coordinate can be trusted.

---

## 1. The thing that nearly shipped

Three adversarial reviewers filed 25 findings; 20 survived independent verification. The worst was
**reproduced six ways against the real router**: Nova would have messaged customers at 3 a.m.

The fire-time re-check bounded how many follow-ups it *examined*, not how many the claim could *lease*. Past
the ceiling the claim reached straight past the examined set — and it only reaches past when the first batch
was blocked, i.e. exactly when quiet hours are on or the touch budget is spent. Two of the five checks (quiet
hours, touch budget) have no other backstop anywhere in the system. The documented tenant-wide "never send
anything proactive" lever, `inbox.maxProactiveTouchesPerWeek: 0`, leaked sends every tick and did not
self-correct.

**The lesson for module 05+:** a bound on work examined is not a bound on work performed. If a check gates a
customer-visible action, make "unchecked ⇒ never acted on" a property of the *query*, not an arithmetic
coincidence between two numbers.

Second: **opt-out was not checked on the fire path at all** — a nudge booked before someone opted out still
fired. Opt-out is absolute here; that is a compliance failure, not a UX one. It is now step 0, above
everything.

---

## 2. What shipped

### The reducer — `dakio-api/src/lib/novaJourney.js`

A deterministic stage machine. **Stage is code, never model output**: the model classifies an intent, the
table transitions. `advanceJourney(tx, tenantId, event)` is a pure function of (current row, event) with all
writes in the caller's transaction; every move writes a `JourneyTransition`, and that log is the **sole**
source of every `journey.*` metric — a missing row is a missing number, so nothing recomputes history from
the journey's current state.

- Forward skips are legal and skipped stages are **never backfilled** (a fabricated transition is a
  fabricated metric). Backward moves happen only via the defined interrupts.
- `stageRank` for an interrupt carries the rank it interrupted, so `at_risk` from `in_delivery` keeps rank 6
  and a later DELIVERED still promotes it, without special-casing `resumeStage` everywhere.
- Unknown courier strings and order statuses **never guess** — they no-op and write a
  `journey.unmapped_event` marker, so drift surfaces as a number instead of stranding customers mid-stage.
- The merge **repoints the loser's transition rows before deleting it**. `JourneyTransition.journey` is
  `onDelete: Cascade`, so the doc's literal "delete the loser" would have silently shrunk every metric.

### The NBA engine — `dakio-api/src/lib/novaNba.js`

The honest split: the server computes which candidates are *legal* with machine-readable reasons, the model
chooses among them and composes, and `evaluateAuthority` remains the only thing that authorizes. A model
picking an ineligible candidate gets a receipted refusal — correct behaviour, not a failure.

Two invariants are **test-pinned across all 13 stages**, because they are gate criteria: `escalate` and
`do_nothing` are eligible in every block (asserted with opt-out, founder-held, locked, disabled, closed
window, quiet hours and a spent budget all true at once), and **a reactive reply is never budgeted** — the
caps bind Nova-initiated sends only, because budgeting reactive replies silently starves answers to a waiting
customer.

The block projects from the already-assembled 360 rather than re-querying, so a turn costs one assembly.

### Follow-ups and the timing conscience — `dakio-api/src/lib/novaFollowups.js`

One outstanding follow-up per conversation, superseded on reschedule — **except rows carrying `promiseId`**,
which are module 03's debts and are never superseded by a nudge. Delays come from a closed list so the model
cannot invent "in 10 minutes" pressure loops. `chainCount` is derived from the conversation, so a customer
writing back genuinely resets the chain.

`recheckBeforeFire` is now six steps, opt-out first, and each skip is receipted.

---

## 3. Frozen contracts later modules call

**Routes** (`/api/v1/inbox`, service token + `requireTenant`): `GET /nba/:conversationId` ·
`POST /followups` · `POST /followups/:jobId/cancel` · `POST /journeys/:id/intent-observed`.
**Merchant plane** (JWT): `GET /api/nova/followups` · `POST /api/nova/followups/:jobId/cancel`.

| Signature | Who calls it |
|---|---|
| `advanceJourney(tx, tenantId, event)` | the journey pass; **module 05/06** for new event types |
| `resolveJourneySubject(tx, tenantId, {conversationId, phone, customerId, channel})` | **every** journey key lookup — P-01 |
| `runJourneySweep(tx, tenantId, now)` | the nightly `journey_sweep` server lane |
| `buildNbaBlock(tenantId, conv, c360)` | `GET /conversations/:id`; **module 07** for the review flow |
| `recheckBeforeFire(tx, tenantId, job, now)` | the claim lane — **any new proactive lane must call it** |
| `isQuietNow(timezone, quietHours, now)` / `shiftOutOfQuiet(...)` | anything Nova-initiated |
| `wasProactiveFire(db, tenantId, conversationId, at)` | the `proactive` marker producer |
| `STAGE_GOALS`, `FORWARD_CHAIN`, `CHAIN_RANK` | the **single** stage vocabulary — `novaNba.js` imports it |

**nova-ai:** verb `schedule_follow_up` (undoable, inverse `cancel_followup`); job kind `journey_sweep`;
`StoreClient.getNba` / `scheduleFollowup` / `cancelFollowup` / `postIntentObserved`; tool
`schedule_follow_up`; hard rule **18** (NEXT BEST ACTION). Rule 15 is still module 11's and still absent.

---

## 4. Decisions that bind later modules

1. **P-01 (founder, 2026-07-25): identity maps across every available identifier** — email, phone, Facebook,
   Instagram, WhatsApp — not phone alone. `CustomerChannel` already models this; it needed no schema change.
   Journeys resolve `customerId` → verified spoke → normalized phone → conversation, through
   `resolveJourneySubject`. **Never merge on an unverified identifier**; module 03's floor is unchanged.
   `Customer @@unique([tenantId, phone])` is deliberately untouched — its own PR.
2. **`schedule_follow_up` is NOT in `NEVER_GATED`** (OD-6), diverging from the module doc. It books a future
   customer touch, so it is not pure bookkeeping like `link_customer_identity` (where the *server* decides).
   Consequence: the Decision Desk is the lane that runs it in shadow mode.
3. **Neither new model carries a `@@unique`.** The reducer runs inside `meta.js`'s ingest transaction and a
   P2002 there would abort the customer's inbound message. Duplicates are a state the sweep collapses.
4. **Journey phones use `normalizePhoneForStorage`, not `normalizePhone`** — the latter ends in an
   unconditional 11-char slice, so two different international numbers would collide onto one journey.
5. **`journeyAt` is the journey pass's own cursor**, decoupled from `processedAt`, because order events are
   also nova-ai's pulse payload and the two would race for the same rows — losing transitions *load-
   dependently*, the worst kind to find later. The migration backfills it so deploy does not replay the
   entire commerce backlog into fresh journeys.
6. **The claim transaction is bounded at 30s**, not the sweeps' 120s: it is what the dispatcher's HTTP call
   blocks on, and that ticks every 60s.

---

## 5. Known-not-built, with owners

| Gap | Owner | Note |
|---|---|---|
| `do_nothing` reporting (`journey.silences_chosen`) | unassigned | Deliberately NOT implemented. `do_nothing` is the one candidate declared by calling nothing, so a silent turn is indistinguishable from one whose tool call failed validation. Counting it would be a fabricated metric. `DO_NOTHING_REPORTING` is exported and asserted. |
| `offer_discount`, `create_order`, `request_address`, `confirm_order_intent` | module 05 | Their verbs exist in **neither repo**, so 4 of 14 candidates cannot execute. The block marks them ineligible honestly rather than offering a capability that is not there. |
| `causedByActionId` on `→ordered` | module 05/06 | Always null — the direct-cause rule licenses it only from verbs that do not exist. |
| `at_risk → lost` on unanswered contact attempts | module 06 | The rescue-ping machinery owns the increment. Live `lost` rules: opt-out and 180d dormant. |
| `payment_reminder`'s positive half | module 05 | COD is now correctly excluded; "only if an online-payment claim is pending" needs `verify_payment_slip`. |
| `journey.*` written to `NovaScoreMetric` | module 09 | Computations specified and emitted as transition rows; the nightly write is 09's. |
| `getNba` route has no caller | module 07 | The block ships inline via `get_conversation`. Kept and tested as a reserved surface, labelled as one. |
| Journey pass not decoupled from the claim tx | module 05 | Bounded and metered instead. Decoupling would contradict a pinned assertion that a reducer failure rolls the cursor back. |
| `→ confirmed` when the two emits straddle a tick | — | A same-stage marker row carries the datapoint. **Module 09 must count `eventType = 'order.confirmed'`, not `toStage = 'confirmed'`.** |

---

## 6. Baselines

```bash
cd dakio-api && npm test            # 1328 tests, 1327 pass, 1 skipped, 0 fail
cd nova-ai   && npx tsc --noEmit    # 0 errors
cd nova-ai   && npm run test:inbox  # 607 checks
cd nova-ai   && npx eve info        # 0 errors, 0 warnings
cd nova-ai   && npm run check:undo  # 17 verbs
```

Standing traps, unchanged from module 03: dakio-api's `package.json` enumerates test files explicitly and
`node --test` tolerates a missing one **silently**; nova-ai's `npm test` is RED at the isolation step
(founder context 3085 > 2500, **F-20**) and is an `&&` chain, so everything after never runs. Run suites
individually. `evals/inbox/identity.ts` has a known ~2% flake in its leak check — **do not weaken it.**

---

## 7. If you are starting module 05 (Selling & Conversion)

Module 05 needs 02, 03 and 08. **Module 08 has not shipped** — 05's selling verbs resolve against its
guardrail-key registry and autonomy-tier encoding, which is why the build order puts 08 first. Check that
before starting.

What is waiting for you: four NBA candidates that name verbs you own (`offer_chat_discount`,
`create_order_from_chat`, `confirm_order_intent`) — the block already marks them ineligible, so wiring the
verb is what makes them real; `linkConversationToCustomer` for the HIGH(a) identity link after a chat order;
`claimedPhone` seeded by module 03 for find-or-create; the `negotiating` stage ENTER that currently fires
only on intent because the discount-ask half has no producer.

What you must not break: the `promiseId` exemption in follow-up supersession, the two pinned NBA invariants,
and `recheckBeforeFire` — **any new proactive send lane must call it**, or it inherits the 3 a.m. bug this
module just fixed.

Budget an hour to re-derive your doc's "already real" column. It will find things.

# Phase 06 — Stage 0: Spine · capability report

- **Status:** engineering complete; **the PRD §15/§16 gate is NOT signed off** (needs a
  non-builder demo on staging — see *Gate* below)
- **Branch / commit:** `main` @ `d4f6e60` (nova-ai) · `main` @ `3ee099e` + `develop` @ `599375b` (dakio-api) · `develop` @ `a80dbd0` (dakio-merchant)
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/06-stage0-spine.md`

> Before this phase, Nova could act but couldn't be held to account: an action
> recorded a short justification, nothing linked the thing it changed back to
> the reason it changed, and an approved action silently lost its undo right.
> Stage 0 makes one rule real end to end — **every write Nova makes carries a
> receipt, lands somewhere the founder already works, and is reversible for 24
> hours.** A founder can now open the Coupons page, see a "BY NOVA" chip on a
> coupon, click it, and read exactly what Nova saw, what it expected, what
> changed, and how long they have to undo it — then export the whole ledger as
> a file.

## Gate

**Standing engineering gates — all green:**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx eve build` | ✅ clean |
| `npx eve info` diagnostics | ✅ 0 errors, 0 warnings |
| This phase's suite | `evals/spine/run.ts` — **33 checks** |
| Prior suites still green | isolation **44** · memory **40** · jobs **39** |
| §16.3 undo-coverage CI | `scripts/check-undo-coverage.ts` — **11/11 verbs** |
| Receipt enforcement (dakio-api) | `nova.receipts.integration.test.js` — **8/8** |
| Grow actor seam (dakio-api) | `growService.integration.test.js` — **9/9** |
| Money re-denomination | `scripts/money-audit.ts` — **72/72 gate verdicts identical** |
| Merchant build | ✅ `npm run build` clean; changed files lint-clean |

**PRD gate — NOT met yet.** §15 requires the scripted demo on a clean staging
store, run by *someone who did not build the phase*, with the recording and the
NDJSON ledger export filed. The machine half is automated in
`scripts/stage0-gate.ts`, but without `NOVA_GATE_MERCHANT_JWT` it **skips**
(loudly) the SSE ≤3s check, the door-attribution check, and the merchant export
— three of the gate's load-bearing assertions. Tracked as **H-1/H-2** in
`docs/HUMAN-VERIFICATION-REQUIRED.md`. This report does not claim Stage 0 is
signed off; it claims the code is ready to be gated.

## New capabilities this phase

- **A write without a receipt is a failed write** — `dakio-api/src/routes/nova.js`
  (`validateReceipt`, 422 `RECEIPT_REQUIRED`) — enforced on every status
  *including* `blocked`: a refusal must also say what rule fired.
- **PRD E-8 receipt shape** — `agent/lib/nova/schemas.ts` (`receiptSchema`,
  min-1 evidence) on all 11 action tools; `agent/lib/nova/actions.ts`
  (`buildReceipt`) — the model must argue with evidence, not assert.
- **Before/after snapshots + `targetRef`** — `agent/lib/nova/executors.ts` — all
  11 executors return what the record looked like on both sides.
- **Undo is a right with a clock** — 24h `undoDeadline` stamped on execution; a
  past-deadline undo **persists its own explained refusal** and throws
  (`actions.ts`) — the refusal is itself a receipted ledger event.
- **Append-only ledger** — transition whitelist `{prepared→executed|rejected,
  executed→undone}` + frozen-field 409s (`nova.js`).
- **The founder's own copy** — `GET /api/nova/ledger/export` streams NDJSON
  (`novaDashboard.js`) — the §16 gate artifact.
- **by:nova attribution** — `novaLedger.js` (`attributeDoorRecord`) +
  `novaActionId` on Coupon and all four Grow models; stamped post-write by the
  pipeline (`actions.ts`) because the action id doesn't exist at mutation time.
- **Founder writes join the ledger** — `recordFounderAction` on Coupons and all
  14 Grow mutations, `actor:'founder'` — so a brief sees the whole picture, not
  just Nova's half.
- **One Grow write path, two actors** — `dakio-api/src/lib/growService.js` — the
  merchant router and (from Stage 3) Nova's pipeline call the same 14 mutations;
  only `opts.actor` differs. Nova's writes deliberately do **not** append a
  second ledger row: the pipeline already wrote their receipt.
- **Nova can see Grow Lab** — `/api/v1/store/grow/*` + StoreClient
  `listGrowCampaigns/Posts/Broadcasts/Ideas` + `getGrowGoal`.
- **The receipt is visible where the founder works** —
  `dakio-merchant/src/components/NovaReceipt.jsx` (chip + drawer) and
  `GET /api/nova/presence` → sidebar dots.
- **Nova speaks ৳** — `agent/lib/nova/format.ts` (`money()`, lakh grouping) and
  the demo data itself re-denominated.

### Two real bugs found and fixed en route

- **Approved actions could never be undone.** `approveAction` never set
  `undoable` from the execution result, so anything routed through approval was
  stored `undoable:false` forever — the exact actions a cautious founder would
  most want to reverse. Fixed in `actions.ts`; pinned by spine checks
  "approved execution is undoable" + "approved-then-undone round-trips".
- **Subagent sessions had no tenant.** eve subagent contexts carry no auth, so
  `requireStore` fell through to the dev fallback — meaning a delegated task
  could resolve to the *wrong store*. Now resolved via a server-written
  session→tenant registry (`agent/lib/tenancy/registry.ts`) that **fails closed
  even with `NOVA_DEV_STORE_ID` armed**; the spine suite asserts that
  adversarially.

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| §16.2 receipts | ⬜ planned | ✅ done | Enforced at the API, not just modelled |
| §16.3 engineered inverses | ⬜ planned | ✅ done | CI fails a verb merged without its undoer |
| E-8 action record | 🟡 partial | ✅ done | receipt/actor/targetRef/undoDeadline/undoneAt |
| §14 doors write into the ledger | ⬜ planned | 🟡 partial | Coupons + all Grow mutations; other doors pending |
| Attribution (by:nova) | ⬜ planned | 🟡 partial | Chip + drawer on Coupons; Grow rows carry the column, no Nova writer until Stage 3 |
| §15 Stage 0 gate | ⬜ | 🟡 **awaiting non-builder demo** | Machine half automated; human half outstanding |
| Currency (৳) | 🟡 partial | ✅ done | Formatter + data + seeded prose |

## Scenario walkthroughs

### Scenario 1 — "Why is there a coupon I didn't make?"

A founder opens **Coupons** and sees `WINBACK10` with a lime **BY NOVA** chip.
They click it. The drawer says Nova created a 10% winback because *38 customers
last ordered 60–90 days ago and none have been messaged inside the cool-off
window*, cites two pieces of evidence with their metrics (`lapsed_60_90 = 38`,
`aov = 6340`), shows the before→after diff of the coupon row, states 72%
confidence, and ends with *"Reversible until 23/07/2026, 20:58. Ask Nova to undo
it."*

The mechanism: `performAction` gated the write, the executor returned
before/after + `targetRef`, the receipt was persisted (a write without one would
have 422'd), and `attributeDoorRecord` stamped `novaActionId` onto the coupon
after the fact. The drawer reads the same row the NDJSON export contains — so
what the founder reads equals what an auditor reads.

*Today vs vision:* the drawer states the undo window but doesn't offer a button
— that read-only router has no write path, and inventing one would have meant a
button that lies. Undo runs through Nova (chat/harness) until the Decision
service lands.

### Scenario 2 — "Show me everything, including my own edits"

The founder exports the ledger (`GET /api/nova/ledger/export`) and gets one JSON
object per line: Nova's actions **and** their own coupon and Grow edits, tagged
`actor: 'nova' | 'founder'`. Because founder rows are `NovaAction` only and never
`NovaActivity`, they appear in the audit trail without inflating Nova's
"tasks today" or hours-saved numbers — the picture is complete without being
flattering.

### Scenario 3 — "Where has Nova been working?"

The sidebar shows a small lime dot on **Coupons**. It pings only when something
in that door is `prepared` — waiting on the founder — otherwise it's a quiet
presence mark. `GET /api/nova/presence` groups the last 7 days of `actor:'nova'`
ledger rows by the door their `targetRef` names; a founder's own edits never
light it up, and an unmapped `targetRef` type is skipped rather than bucketed
into the wrong door.

## Known limitations / not yet

- **Stage 0 is not signed off.** The non-builder staging demo (H-1) and the
  JWT-gated live gate run (H-2) are outstanding. Everything above is
  engineering-complete, not gate-complete.
- **Nova cannot write to Grow Lab yet.** The shared `growService` seam, the
  `createdBy`/`novaActionId` columns, and the read projection all exist; the
  Nova-side write router arrives with the Stage 3 vertical (Phase 09).
- **`maxAutoRefundTotal` is enforced nowhere.** Owner-configurable, read by no
  guardrail branch, with no refund action to apply it to. Labelled as such in
  `autonomy.ts` rather than quietly re-denominated and left looking real.
- **Attribution covers Coupons + Grow only.** Products, orders, and purchase
  orders have `targetRef` values but no `novaActionId` column yet.
- **The chip is proven headless, not on a human's screen.** Judgement at real
  widths is H-6.
- **Nothing is deployed.** All Nova work now lives on `develop` in each repo
  pending review; the dakio-api phase-06 backend and its migration went to
  `main` before that policy existed (H-3).

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Stage 0 / Phase 06 build-status
row; receipts (§16.2); engineered inverses (§16.3); E-8 action record;
attribution; ledger export; currency.

# Phase 08 — Stage 2 "Consent": The Decision Service

**PRD stage:** Stage 2 (PRD §15) · **Prereqs:** 06 (E-8 receipts, SSE, export), 07
(authority seam, `frozen` status, founder-only verbs, NovaInstance fields).
Self-contained. This phase splits the PRD's **Decision (E-9)** out of the shipped
prepared-action rows, gives it desk semantics (FIFO, Approve / Later / freeze), fans one
record out to every surface with zero drift, wires the merchant Decision Desk to reality,
and ships the hire ritual (FR-1) plus trust meter v1 (§11).

## Already real vs to build

| Capability | Today (repo audit) | This phase |
|---|---|---|
| Prepared queue | REAL — `status:'prepared'` NovaAction + `approve_action`/`reject_action`/`undo_action` owner-only tools; `pendingApprovals` read-only in `GET /api/nova/home` | Split into `NovaDecision` (E-9): one decision record linking the action; queue semantics |
| Merchant desk | MOCK — `NovaContext.jsx` `DECISIONS` d1–d5 in localStorage; approve/later purely local; **no dashboard approve/reject/undo endpoints exist** (`novaDashboard.js` read-only by scope note) | Real decision APIs + Desk/room/module wiring; mock cards deleted |
| Decision push | Feed SSE shipped (`novaFeedBus.js`, `activity.*`/`action.*` events) | `decision.*` events on the same bus; ≤3s NFR extended to decisions (§14) |
| Freeze-on-lock | 07 bridge: matcher freezes prepared NovaActions | Migrate freeze onto NovaDecision (same matcher/transaction, new target table) |
| Trust | `earnedLevel`/`trustScore` schema fields reserved (07); no computation | Trust meter v1 (placeholder formula §18) + L3→L4 promotion offer (FR-3) |
| Hire | `hired` flag in merchant localStorage (mock); NovaInstance rows backfilled by 07 migration | FR-1 hire API + onboarding wiring: L3 default, seeded guardrails ৳5,000/day + 15% + empty no-touch, `hiredAt`, presence markers on |
| Expiry | none (old-07 planned TTLs for prepared actions) | Decision expiry TTLs by risk class (canon §5) + expiry job kind |

## Objective

One Decision record, authored with the §13 contract (why, evidence window, before/after,
guardrail result, reversibility, expected impact, confidence), rendered on the desk, its
department room, its door module, and (later) chat/voice — approve anywhere executes the
linked action atomically and clears it **everywhere** in one transaction; Later requeues;
a no-touch lock freezes it. PRD Stage 2 gate: one record, four surfaces, zero drift.

## Scope

**In:** `NovaDecision` model + lifecycle (canon §5: `queued → approved | later(requeue) |
rejected | frozen | expired`); decision authoring in `performAction` (draft/suggest
verdicts create decisions); FIFO queue + desk ≤3 cards (FR-2.2); `surfaced_in[]` fan-out
+ atomic clear over SSE; merchant approve/later/reject/undo endpoints + Desk/room-stub
wiring; `bundle_ref` schema reserved (executor in 14); trust meter v1 + promotion offer;
hire flow FR-1; decision expiry TTLs + job kind; escalation cards (07's stub becomes a
real card).
**Out:** PlanItem flips (09 — gate step bridges to a stubbed plan row, stated below);
room UI full anatomy (09); chat/voice approve paths (11/13 — same records by design);
bundle executor + per-agent trust (14).

## System architecture

```
night job / chat tool → performAction
   ├─ evaluateAuthority (07) ─ verdict draft|suggest ─► NovaAction(prepared, receipt)
   │                                                    └─► authorDecision() ─► NovaDecision(queued)
   │                                                          tag·impact_label·params_line·why·surfaced_in[]
   └─ verdict refuse ──────────────────────────────────► escalation Decision card (kind:'escalation')
                                                              │
              novaFeedBus: decision.created/updated ─ SSE ≤3s ┴─► desk · room plan · door badge · (chat/voice later)
founder: POST /api/nova/decisions/:id/approve ──► one transaction:
   execute linked action (executors) → action executed + receipt/undo_deadline
   → decision approved (decidedBy) → plan-item flip (09; stub row this phase)
   → decision.updated fan-out clears every surfaced_in — one record, zero drift
```

## Design decisions

1. **Decision ≠ Action, one link each way (E-9 ↔ E-8).** The shipped prepared NovaAction
   stays the executable half (payload, receipt, undo). `NovaDecision` owns presentation +
   consent state: `tag` (department), `impact_label`, `title`, `params_line`, `why`,
   `surfaced_in[]`, `bundle_ref`, queue position. `authorDecision()` derives the card from
   the action's receipt — the §13 authoring contract is a projection, never a second
   source of truth. Migration backfills one decision per existing prepared action.
2. **Approve is one transaction, fan-out is events (FR-3).** Approve executes the linked
   action via the shipped executor path, stamps `undo_deadline`, flips both rows, and
   emits `decision.updated` — every surface renders from the same record, so "clearing"
   is just re-render. 409 on already-decided (optimistic-lock; UI reconciles — salvaged
   from archived 06). Undo of an approved decision undoes the action (06 window) and
   marks the decision `undone` for surface truth.
3. **Later ≠ Reject (canon §5, resolves the v1 conflict).** `Later` requeues to the back
   (`queuePos = max+1`) and writes **nothing** to memory — deferral is not disagreement;
   mapping it onto v1 reject would corrupt preference learning. `Reject(reason)` is kept
   (chat/desk overflow menu) and keeps its Phase-04 `learnFromRejection` fast path. Desk
   primary verbs are Approve / Later per FR-3.
4. **FIFO with a small pinned head.** Desk shows ≤3 (FR-2.2): escalation cards (07) and
   `priority:1` risk cards pin first, then FIFO by `queuePos`. No model-side ranking —
   deterministic, explainable ordering.
5. **Freeze moves to decisions (07 bridge closes).** The 07 matcher/transaction retargets
   `NovaDecision` (`queued|later → frozen`, unfreeze restores prior status). Frozen cards
   stay visible with the lock named (FR-4 explainability) — hidden cards would be silent
   authority.
6. **Expiry TTLs by risk class (canon §5):** low 7d · medium 72h · high 24h, stamped at
   authoring (`expiresAt`), swept by a new `decision_expiry` job kind (dispatcher,
   Phase 05 infra). Expired decisions notify the next brief (09 lists expiring-today
   first). Distinct clock from the action undo window (06).
7. **Trust meter v1 (§11, §18).** `trustScore ∈ [0,1]` recomputed nightly (reflection
   job step) and on decision events, from the ledger only: placeholder formula
   `approvals/(approvals+rejections) weighted by recency, minus undo-rate and refusal-
   pressure penalties` — **the formula is an open product decision (PRD §18, due this
   phase); the seam isolates it** (`computeTrust(ledgerSlice) → {score, inputs}`; inputs
   persisted so the number is auditable, §11 "earned from the ledger, not asserted").
   Threshold + empty queue → Nova authors a **promotion offer decision** (verb
   `promotion_accept` — founder-only per 07, so approval executes the level bump through
   the same consent machinery it grants).
8. **Hire is a server ritual, not a flag (FR-1).** `POST /api/nova/hire` (owner JWT):
   sets `hiredAt`, `autonomyLevel=earnedLevel=3`, guardrails v1 (৳5,000/day cap, 15%
   discount, empty no-touch), seeds `NovaJobDef`s in the store's timezone, activates nav
   presence markers (06), returns the instance. Merchant onboarding (`/nova/onboarding`,
   built as mock) calls it and drops the localStorage flag. Idempotent; re-hire after
   pause is a no-op with the instance returned.
9. **Desk wiring replaces exactly one mock vein** (nova-ui-build-01 discipline):
   `NovaContext.jsx` decisions/`applyApproval` swap to the APIs + `decision.*` SSE;
   autonomy panel wiring rides the 07 authority APIs in the same pass; chat/voice/rooms
   stay mock until their phases.

## EVE features to use (exact surface)

- No new eve capabilities required — consent is deliberately server-side business logic.
  The chat `approve_action` tool family is retargeted to decisions (`approve_decision`,
  `later_decision`, `reject_decision`; owner-only pattern from `approve_action.ts`), so
  Stage 5 chat and Stage 7 voice approve the **same records** (FR-3 cross-surface rule).
- `defineTool` approval fns: trust-plane decision tools keep the `ownerOnly()` denial of
  scheduled/background principals.
- Dispatcher job kinds (Phase 05 `NovaJobDef`): add `decision_expiry` (hourly) and the
  nightly trust recompute step appended to the shipped `reflection` prompt template.
- SSE: reuse `novaFeedBus` (`decision.created|updated` alongside `activity.*`) — same
  single-instance caveat, LISTEN/NOTIFY upgrade stays phase 15.

## External services

None new. Postgres, existing SSE bus, existing dispatcher.

## Data models

```prisma
model NovaDecision {                      // E-9 (§12) — per-tenant, timestamped, deletedAt soft delete
  id String @id @default(cuid())
  tenantId String
  tag String                              // department key
  kind String @default("proposal")        // proposal | escalation | promotion
  impactLabel String                      // e.g. "+৳12,400/wk est."
  title String; paramsLine String; why String
  actionId String @unique                 // linked E-8 row (payload, receipt, undo live there)
  bundleRef String?                       // reserved; executor in 14 (E-19)
  status String @default("queued")        // queued|approved|later|rejected|frozen|expired|undone
  queuePos Int
  surfacedIn Json                         // ["desk","room:marketing","door:campaign_manager"] — appended as surfaces render it
  priority Int @default(5)                // 1 = pinned risk/escalation
  frozenByLock String?                    // no-touch lock text that froze it (explainability)
  expiresAt DateTime?
  decidedBy String?; decidedAt DateTime?
  createdAt DateTime; updatedAt DateTime; deletedAt DateTime?
  @@index([tenantId, status, queuePos])
}
// NovaInstance: trustScore now written (+ trustInputs Json for auditability)
// NovaAction: no change (07 added frozen/escalation; frozen status retired from actions after migration)
```

## APIs & interfaces

Merchant JWT (`routes/novaDashboard.js`; owner/admin for verbs, per 03 role rules):
- `GET /api/nova/decisions?status=queued&limit=` — FIFO + pinned head; card payload joins
  the action receipt (evidence window, before/after, guardrail rule, reversibility).
- `POST /api/nova/decisions/:id/approve` → transaction of D2; 409 if not `queued/later`.
- `POST /api/nova/decisions/:id/later` → requeue; `POST .../reject {reason}` → learning
  fast path; `POST .../undo` → within the action's undo window.
- `GET /api/nova/trust` → `{score, inputs, earnedLevel, promotionEligible}`.
- `POST /api/nova/hire` → D8. All verbs idempotent-with-409 + `decidedBy` recorded.

Service surface: `authorDecision` inside `performAction` (nova-ai) via
`POST /api/v1/agent-data/decisions`; expiry sweep + trust recompute via service routes.
SSE: `decision.created|updated` frames carry `{id, status, surfacedIn}` only — clients
re-fetch the card (no stale payload drift).

nova-ai: `approve_decision`/`later_decision`/`reject_decision` tools; `authorDecision()`
projection (tag/impact/params/why derived from receipt); L2 context layer now renders the
queue digest with canonical statuses. Card strings bn+en; money via `money()` ৳.

## Implementation steps

1. Prisma migration + backfill (one decision per live prepared action; retire `frozen`
   from NovaAction after freeze retarget).
2. `authorDecision` projection + `performAction` wiring (draft/suggest/escalation paths);
   decision tools replace raw approve/reject tools (kept as deprecated aliases one cycle).
3. Decision routes + transaction semantics + SSE events + integration tests (approve race,
   later ordering, freeze/unfreeze, expiry).
4. Freeze retarget from 07 bridge (same matcher fns; tests move tables).
5. `decision_expiry` job kind + TTL stamping; trust recompute in reflection + `computeTrust`
   seam + promotion-offer authoring.
6. Hire endpoint + onboarding wiring + localStorage-flag removal; presence markers read
   server `hired` state.
7. Merchant Desk + Autonomy panel wiring (mock DECISIONS deleted; optimistic UI + 409
   reconcile; `decision.*` SSE consume); bn+en strings.
8. Stage-2 gate script + staging demo (non-builder), artifacts filed.

## Dependencies

06 + 07 shipped. Product decisions due: **trust formula** (§18 — placeholder shippable,
decision recorded before gate) and desk copy for Later vs Reject. dakio-api refund
endpoint (07 flag) only if the gate store seeds a bulk-refund escalation card.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Two sources of truth (action vs decision) drift | decision is a projection + FK unique on actionId; invariant test walks every pair; card payload always joins live receipt |
| Approve race vs expiry/freeze | single UPDATE … WHERE status IN ('queued','later') guard; 409 → UI refetch |
| Requeue starvation (Later forever) | expiry TTLs bound queue age; brief surfaces expiring-today first (09) |
| Promotion offer feels pushy | offered only at threshold + empty queue (FR-3), as a normal card, founder-only verb — declining is `later`/`reject`, no nagging re-offer for 14d |
| Backfilled decisions lack authored why/params | derived from receipt (`migrated:true`); acceptable — same data the founder saw before |
| Mock-to-real UI regressions | one-vein rule + build gate + scripted browser check on staging (nova-ui-build-01 pattern) |

## Testing strategy

Integration (real Postgres): full lifecycle matrix (approve/later/reject/freeze/expire/
undo × race pairs), fan-out event capture, hire idempotency, trust recompute from a
seeded ledger slice, backfill correctness. nova-ai suite `evals/consent/run.ts`:
authorDecision projection golden tests, tool role-denials, L2 queue digest. Merchant:
build + scripted browser check — approve on desk clears the room-stub and door badge
without reload (SSE), frozen card names its lock. Prior suites green (isolation/memory/
jobs + 06/07 suites).

## Performance

Desk read = one indexed query + receipt join (target <100ms p95). Approve transaction
touches 3 rows + 1 executor call — sub-second (old-06 approval p95 <1s kept as the NFR).
SSE frames are id-only (re-fetch pattern) — no payload fan-out amplification. Decision
push ≤3s measured at the gate (§14 NFR now covers decisions, not just feed).

## Security

Verbs require owner/admin merchant JWT; service tokens can author but never decide
(approval ≠ authorization — re-checked inside the transaction against authority state,
03 rule). `decidedBy` + `auth.current` recorded on every transition (natural audit pair).
Escalation/promotion cards execute through the same founder-only verb classification
(07) — the consent machinery cannot be used to bypass it. Frozen reasons and lock text
render as data, not instructions.

## Success & exit criteria

**PRD §15 Stage 2 gate (near-verbatim):** one authored decision appears on desk + room +
module *(room/module = the 08 stubs: room plan list + door pending badge; full room
anatomy is 09)*; approve on desk → executes, flips the plan item *(stub plan row this
phase — 09 owns PlanItems; the flip is real data, the board UI lands next phase)*, logs
feed; skip (Later) requeues to back; freeze on lock. **One record, four surfaces, zero
drift, zero manual DB pokes.**
**Standing gates:** tsc · eve build · eve info 0 diagnostics · phase suite · prior suites
· breach evals still hard-gating (§16.4).
**§16 discipline:** clean staging store, non-builder runner, demo recording + ledger
export filed.
**Phase-specific:** decision push ≤3s measured · approve p95 <1s · trust inputs
reproducible from the ledger export · hire ritual creates L3 instance with FR-1 seeds ·
zero localStorage decision/hire state left in merchant code.

## Deliverables

`NovaDecision` model + migration/backfill; `authorDecision` + decision tools; decision
routes + transactions + SSE events; freeze retarget; expiry job kind; `computeTrust` seam
+ promotion offers; hire endpoint + onboarding wiring; Desk + Autonomy panel live;
`stage2-gate` script; demo recording + ledger export artifacts; capability report
`phase-08-stage2-consent.md` + matrix updates.

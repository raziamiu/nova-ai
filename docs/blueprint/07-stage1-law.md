# Phase 07 — Stage 1 "Law": Authority Engine v2 + Duty Registry

**PRD stage:** Stage 1 (PRD §15) · **Prereq:** Phase 06 (Spine: receipt reshape, ৳ minor
units, ledger export, §16.3 verb-checklist CI).

> **Baseline correction (2026-07-22): read [`grow-lab-reconciliation.md`](./grow-lab-reconciliation.md).**
> The six Nova-module doors shipped as live Grow Lab modules — the duty seed's
> `DOORS` registry marks them `doorExists:true` at seed time (door_module keys = grow
> module keys); broadcast *send* duties stay honest prepare-only until 12's channel.
> Only the 4 sub-view doors remain NEEDS DOOR. Self-contained: everything the founder's
"one rule" needs before consent (08) — who may do what, through which door, and what a
refusal looks like. Absorbs the archived `07-trust-safety-scale.md` guardrails-v2 +
`policy.ts` single-seam design; the rest of that doc lands in phase 15.

## Already real vs to build (repo audit)

| Capability | Today | This phase |
|---|---|---|
| Autonomy gate, levels 0–4 | REAL — `agent/lib/nova/autonomy.ts` `gateAction` (execute/prepare/block), persisted per tenant in `NovaConfig.autonomy` via GET/PUT `/api/v1/agent-data/config` | Reshape into `evaluateAuthority` seam; canonical L0–L4 names; distinct L1/L2 |
| Six numeric guardrails | REAL — `checkGuardrails` (discount/price+margin/budget/PO caps; block vs needs_approval) | KEEP as "platform guardrails" superset under the same seam |
| Refusal persistence | REAL — `blocked` ActionRecord with explanation (`actions.ts`) | Add escalation stub + feed event + API-layer enforcement |
| Owner-only trust plane | REAL — `agent/tools/approve_action.ts` `ownerOnly()` denies non-owner principals | Reuse pattern for `set_no_touch_lock` |
| Departments | REAL but wrong keys — `supplier_manager`/`courier_manager` in `agent/lib/types.ts:303` + subagent dirs | Rename to `operations`/`shipping` + ledger data migration; `ceo` dir merges into root |
| Duty registry / no-touch / per-door mode / daily_spend_cap / earned_level / bulk_refund verb | ABSENT — duty lists exist only as mock `dakio-merchant/src/context/novaData.js` `DEPT_ROOMS`; all shipped caps are per-action deltas; `maxAutoRefundTotal` is inert (no refund verb) | BUILD (E-5, E-2 trio, E-3, E-1 fields, new propose-only verb) |
| Breach evals | PARTIAL — `evals/nova/autonomy-gating.eval.ts` | Grow corpus; make CI hard gate (§16.4) |
| Merchant Autonomy panel / duty roster / no-touch UI | MOCK — localStorage (`NovaContext.jsx` scope note) | APIs shipped here; UI wiring rides 08's desk work |

## Objective

Every action Nova attempts is judged by one server-side seam — **level × mode ×
guardrails × no-touch × founder-only verb × per-duty min level** (PRD §4 Authority, §5) —
and every refusal is itself a logged, explainable, founder-visible event. The 65-duty
registry (§4 Duty, §6, E-5) makes Nova honest about what it does and doesn't claim.
Milestone = PRD Stage 1 gate: bulk-refund refused + escalated; over-cap campaign
downgraded to a decision; a no-touch lock freezes a pending decision — all server-enforced.

## Scope

**In:** `evaluateAuthority` seam; ladder rename L0–L4 with distinct L1/L2 semantics;
default-at-hire L3 + `earned_level`/`trust_score` schema (E-1 fields; formula is 08's);
versioned `NovaGuardrails` (E-2 trio + platform superset); `NovaAgentMode` per-door +
store-wide (E-3); founder-only verbs incl. NEW `bulk_refund` (§5.4); `NovaDuty` + 65-duty
seed + coverage rollups (E-5, §6); department rename + data migration; refusal→escalation
stub; breach evals as CI hard gates (§16.4).
**Out:** Decision entity + freeze-on-Decision, trust formula, hire ritual UI (08); duty
UI in rooms (09); per-agent modes/trust (14); budgets/red team/audit hardening (15).

## System architecture

```
chat / job session (nova-ai)                     founder (merchant JWT, owner role)
   │ action tool call                                │ PUT level · POST guardrails/no-touch
   ▼                                                 ▼
performAction ──► evaluateAuthority(ctx, req)     dakio-api /api/nova/authority routes
   │        1 founder-only verb class  ──refuse──►  writes NovaGuardrails vN+1 + ledger action
   │        2 no-touch matcher         ──refuse──►  lock add → freeze matcher over prepared rows
   │        3 duty check (enabled, min_level, door)
   │        4 mode ceiling (door → store, default assisted)
   │        5 level semantics (L0 refuse-all … L4)
   │        6 guardrails (trio incl. cumulative ৳ day-spend + platform six)
   ▼
executed | prepared(draft) | prepared(suggestion) | frozen | blocked(+escalation)
   ▼                                    ▼
NovaAction + receipt (06 shape)     NovaActivity kind=refusal → SSE feed ≤3s
```

Defense in depth: the same classification tables run in dakio-api `routes/nova.js`
POST/PATCH `/actions` — a row claiming `executed` for a founder-only verb, or written by a
service principal above the stored authority state, is a **failed write** (extends §16.2).

## Design decisions

1. **One seam, no second gate.** `gateAction` grows into `evaluateAuthority(ctx, request)
   → AuthorityVerdict` (the archived-07 `policy.ts` idea, pulled forward). Every verdict
   names the exact rule that fired (`rule: "founder_only:bulk_refund"`,
   `"guardrail:daily_spend_cap"`, `"no_touch:saree pricing"`, `"duty:min_level"`) —
   owner-safe, reproducible, and the string the escalation card shows. eve's approval
   mechanism stays a UI gate, never authorization (archived-07 ruling; canon §4.5).
2. **Ladder rename with real L1/L2 split (§5.1).** Numeric storage stays 0–4; code
   constants + UI get L0 Observe / L1 Suggest / L2 Draft / L3 Operator / L4 Acting CEO.
   Shipped "1–2 both prepare" collapse is fixed: **L1 → `prepared` with
   `stage:"suggestion"`** (recommendation record only, no draft artifacts behind doors);
   **L2 → `prepared` with `stage:"draft"`** (full draft lands behind its door). 08's
   Decision authoring consumes both stages.
3. **Default at hire = L3 Operator (FR-1), caution via earned_level.** New instances:
   `autonomy_level=3, earned_level=3` (L4 locked until trust threshold — formula in 08).
   Existing tenants keep their configured level (no silent promotion); new default applies
   at hire. `PUT /authority/level` rejects `level > earned_level` (403, rule named).
4. **Mode is a ceiling, not a second level (§5.2).** Effective capability =
   `min(mode, level)`: `manual` → suggestions only, drafts held; `assisted` (default) →
   everything lands as a draft; `autonomous` → level semantics apply. Resolution order:
   `door:<module>` row, else `store` row, else assisted. Mode changes take effect
   immediately on the next evaluation — pending-item re-evaluation arrives with 08's
   Decision fan-out.
5. **Canonical guardrail trio + platform superset (E-2, §5.3).** `NovaGuardrails`
   versioned rows (current = max version, history immutable): `daily_spend_cap` (**minor
   units**; display ৳500–20,000 step ৳500), `max_discount_pct` (0–50 step 5), `no_touch[]`.
   The shipped six caps move in as `platform` JSON — same seam, evaluated after the trio;
   a tenant can tighten, loosening beyond platform bounds is a plan feature (archived-07).
   `daily_spend_cap` is **cumulative**: today's (store-tz) executed spend from the ledger +
   requested delta; spend extractors are a per-verb registry column (`create_campaign` →
   budget/day, `update_campaign` → budget increase; extensible under §16.3). Summation
   runs inside a per-store advisory-locked transaction so two concurrent in-cap actions
   can't jointly breach.
6. **No-touch matcher is deterministic and conservative (§5.3).** Each ActionType declares
   a `targetText` extractor (product/campaign/supplier/courier names + price fields —
   §16.3 gains this column). A lock matches when every significant token (NFC-normalized,
   case-insensitive, Bangla-aware) appears in `targetText`. Ambiguity resolves toward
   refusal/freeze — a false freeze is a founder tap; a false pass is a broken promise.
   Lock strings are data, never instructions (rendered via untrusted framing in prompts).
7. **Founder-only verbs are a classification, not a role check (§5.4, §13).**
   `FOUNDER_ONLY = {bulk_refund, guardrail_edit, promotion_accept, contract_sign}` —
   propose-only at every level including L4, on every path. NEW `bulk_refund` ActionType
   (riskClass high, `undoable:false`, no spend extractor): agent path always refuses;
   founder execution arrives with 08's approve transaction (and needs a dakio-api refund
   endpoint — flagged dependency). `guardrail_edit`/`promotion_accept`/`contract_sign`
   are classified now; their executable surfaces land in 07 (guardrails, founder API
   only), 14, 14 respectively.
8. **Refusal = ledger event + escalation stub.** A refusal persists the `blocked`
   ActionRecord (shipped) **plus** `escalation` JSON `{kind, rule, proposed_payload}` and
   a `NovaActivity kind:"refusal"` line → SSE feed ≤3s (FR-2.3). 08 turns the stub into a
   real escalation Decision card; 13 adds push. Skipped duties log the same way
   (`kind:"duty_skipped"`, §13 non-negotiables).
9. **Freeze bridges on prepared actions until 08.** E-9 Decision doesn't exist yet, so
   "lock freezes related pending decisions" is implemented against prepared NovaActions:
   adding a lock runs the matcher over all `status:'prepared'` rows in one transaction —
   matches flip to NEW status `'frozen'` (+ activity event); removing the lock restores
   `'prepared'`. 08 migrates frozen semantics onto NovaDecision verbatim; the matcher and
   transaction are reused, only the target table changes. **This bridge is deliberate and
   temporary — stated here so 08 doesn't re-derive it.**
10. **Duties are checked-in data, mirrored to rows (E-5, §6).** `agent/lib/duties.ts`
    exports the 65-duty seed + `DOORS` registry (door → exists/build_phase). Mined from
    merchant `novaData.js` `DEPT_ROOMS` (which totals exactly 65) + PRD §6 charters, with
    three curation edits to honor PRD §6's four named NEEDS DOOR duties: merge the mock's
    two P&L rows into one `pnl_reports` duty (Finance); merge `quote_comparison` +
    `supplier_scorecards` into one `rfq_compare` duty and add `supplier_switching`
    (Operations — grounded in the shipped `switch_supplier` verb); add
    `delay_prediction` (Shipping, PRD §6 charter); re-door `review_responses` → Inbox and
    the mock's door-less Marketing ad duties → Campaign Manager. Per-dept counts:
    ceo 6 · marketing 10 · sales 8 · support 6 · product_research 7 · inventory 5 ·
    shipping 5 · finance 7 · operations 5 · growth 6 = **65**. Exactly 4 duties bind to
    unshipped sub-view doors — Rate Compare, RTO Analytics, P&L Reports, RFQ Compare
    (NEEDS DOOR until phase 12). Duties bound to Nova modules that ship in 09–12 carry
    `door_exists:false` honestly until their phase lands (PRD §6's "61/65" is the
    steady state, not day one). Status is computed, never stored: `!door_exists →
    NEEDS DOOR`, `min_level > effective level → LOCKED Lx`, `!enabled → PAUSED`, else
    `ACTIVE`. Coverage rollups replicate `deptCoverage`/`dutyRosterSummary` server-side.
11. **Department rename is a data migration, not a refactor (§6, §17).**
    `supplier_manager→operations`, `courier_manager→shipping`: subagent dirs (dir name =
    delegation tool name — CEO routing table changes), `NOVA_DEPARTMENTS`, plus SQL
    UPDATE over existing `NovaAction`/`NovaActivity` department keys, capability matrix
    and evals. The `ceo` subagent dir merges INTO root instructions (root = CEO-Nova
    identity; canon §6); `ceo` stays in `NOVA_DEPARTMENTS` as a ledger attribution key.
    `performAction` gains `dutyKey`; every action tool names its duty → `duty_ref`
    starts populating (E-8 column reserved in 06).

## EVE features to use (exact surface)

- **Declared subagents** (`agent/subagents/<id>/agent.ts`, `defineAgent({ description })`):
  bare dir path = model-visible tool name — renaming dirs renames the CEO's routing tools;
  `description` fields are the routing table (update for operations/shipping). Dir-name ↔
  tool-name collisions are build rejections. Subagents inherit nothing: the authority seam
  lives in shared `lib/` (`performAction`), which every dept tool already imports — the
  enforcement point survives delegation (canon §4.5).
- **Tool approval, owner-only pattern**: `set_no_touch_lock` copies
  `agent/tools/approve_action.ts` `ownerOnly()` (denies scheduled/background principals +
  non-owner roles) — §5.3 "addable from panel or chat" without waiting for Stage 5 chat.
- **defineDynamic instructions** (shipped L1–L3 context layers): level constants renamed;
  L2 live-ops layer now renders canonical level names + mode map + current guardrail
  version so the model narrates authority truthfully.
- **Evals as CI hard gates**: `defineEval` + `defineEvalConfig`; breach corpus via
  `loadYaml("evals/data/breach.yaml")` fan-out (array default-export); deterministic
  **`mockModel` fixture agent** force-calls guarded tools (scripted `toolCalls`) so the
  gate matrix runs with zero model spend; assertions `t.calledTool(name, { status:
  "rejected" })` for refusals, `t.notCalledTool` for founder-only executes,
  `turn.outputMatches(zodVerdict)` for verdict shape. CI: `eve eval --strict --junit`
  — one breach fails the build (§16.4). NEVER model-vigilance as enforcement.

## External services

None new. Postgres (dakio-api Prisma migrations); existing Anthropic via eve for
non-fixture evals. No Redis yet — day-spend counters are ledger queries (budget counters
arrive in 15).

## Data models (dakio-api Prisma, per-tenant, timestamped, `deletedAt` soft delete — canon §4.11)

```prisma
model NovaInstance {            // E-1 (§12); absorbs nova_tenants identity + NovaConfig.level
  tenantId       String  @id
  hiredAt        DateTime?     // set by 08's hire flow; migration backfills createdAt
  autonomyLevel  Int     @default(3)   // L3 Operator default at hire (FR-1)
  earnedLevel    Int     @default(3)   // L4 locked until trust threshold (§5.1, §11)
  trustScore     Decimal?              // computed in 08 (formula = open product decision)
  statusLine     String?               // "Nova is now…" (FR-2.1)
  onDutySince    DateTime?
}                                       // tasks_today stays computed (GET /api/nova/home)

model NovaGuardrails {          // E-2, versioned; current = max(version); rows immutable
  tenantId String; version Int
  dailySpendCapMinor BigInt    // ৳ minor units; display ৳500–20,000 step ৳500
  maxDiscountPct     Int       // 0–50 step 5
  noTouch            Json      // string[] freeform locks, e.g. ["SAREE PRICING"]
  platform           Json      // shipped six caps: maxDiscountPct*, maxPriceChangePct,
                               //   maxBudgetChangePct, minMarginPct, maxAutoPurchaseOrderTotal,
                               //   maxAutoRefundTotal — platform superset, same seam
  setBy String; createdAt DateTime
  @@id([tenantId, version])
}

model NovaAgentMode {           // E-3; per-door + store-wide now, per-agent in 14
  tenantId String; scope String  // "store" | "door:<module>"  (14 adds "agent:<dept>")
  mode String @default("assisted")   // manual | assisted | autonomous
  @@unique([tenantId, scope])
}

model NovaDuty {                // E-5; mirrored per tenant from agent/lib/duties.ts seed
  tenantId String; key String    // e.g. "shipping.rate_compare"
  department String; name String; nameBn String?   // bn+en roster (founder-facing)
  doorModule String; doorExists Boolean; minLevel Int
  enabled Boolean @default(true); lastActionRef String?
  @@unique([tenantId, key])
}

// NovaAction: ALTER — status gains 'frozen'; escalation Json?; duty_ref begins populating.
// FR-1 seed at hire/migration: guardrails v1 = ৳5,000/day, 15%, seeded no-touch [].
```

## APIs & interfaces

`agent/lib/nova/authority.ts` (renamed seam, replaces direct `gateAction` calls):
`evaluateAuthority(ctx, req: { storeId, department, type, dutyKey, payload, origin }) →
{ verdict: "execute"|"draft"|"suggest"|"refuse", riskClass, rule, explanation,
guardrailsVersion, escalation? }` — order: founder-only → no-touch → duty → mode → level →
guardrails; first refusal wins; fail-closed on any lookup error.

dakio-api, merchant JWT owner role (`routes/novaDashboard.js` grows `/api/nova/authority`):
- `GET /api/nova/authority` — level (canonical name + number), earnedLevel, mode map,
  current guardrails (+version), founder-only verb list.
- `PUT /api/nova/authority/level {level}` — 403 above earnedLevel (FR-4 locked ladder).
- `PUT /api/nova/authority/mode {scope, mode}` — upsert (§5.2 switch surfaces).
- `POST /api/nova/guardrails {dailySpendCapMinor, maxDiscountPct}` — writes vN+1 + ledger
  action (verb `guardrail_edit`, actor founder — the only path that executes it).
- `POST /api/nova/guardrails/no-touch {lock}` / `DELETE .../no-touch/:index` — vN+1 +
  freeze/unfreeze transaction over prepared actions (decision 9) + activity events.
- `GET /api/nova/duties[?department=]` — duties with computed status + `{active,total}`
  rollups per department; `PUT /api/nova/duties/:key {enabled}` (E-5 founder toggle).

Service surface (`/api/v1/agent-data`, novaAuth): `GET /authority` (composed state the
agent reads each turn; `GET/PUT /config` becomes a compat shim over it, removed in 08).
Agent tools: NEW `bulk_refund` (action tool → always refuses via seam), NEW
`set_no_touch_lock` (ownerOnly). Refusal explanations ship en with `explanationBn`
alongside (bn+en, §14 NFR).

## Implementation steps

1. Prisma migrations + backfill (NovaInstance from nova_tenants/NovaConfig; guardrails v1
   from DEFAULT_GUARDRAILS + FR-1 trio defaults; modes `store=assisted`).
2. Department rename: subagent dirs, `NOVA_DEPARTMENTS`, ceo→root instruction merge, SQL
   migration over ledger department keys, evals/capability-matrix sweep.
3. `duties.ts` seed (65) + `DOORS` registry + per-tenant mirror job + rollup queries;
   parity fixture asserts seed ↔ curated `DEPT_ROOMS` mapping.
4. `evaluateAuthority`: verb classification table, no-touch matcher + per-verb extractors,
   mode resolution, L1/L2 stage split, cumulative day-spend check (advisory-lock tx);
   rewire `performAction`; add `frozen` status + freeze/unfreeze transactions.
5. `bulk_refund` + `set_no_touch_lock` tools; refusal escalation stub + activity kinds
   (`refusal`, `duty_skipped`) into the SSE feed.
6. dakio-api authority/guardrails/duties routes + POST `/actions` defense-in-depth
   validation (founder-only + authority-state checks on direct writes).
7. §16.3 CI check extended (founder-only column, spend + targetText extractors); breach
   eval corpus + mockModel fixture agent; wire `eve eval --strict` as merge-blocking.
8. Stage-gate demo script + staging seed; run by non-builder; file artifacts.

## Dependencies

Phase 06 shipped (receipt schema enforcement §16.2, ৳ `money()`, ledger export, verb-
checklist CI base, tenant-registry subagent fix). Product: trust formula decision due
before 08 ships (PRD §18) — 07 only reserves the fields. dakio-api refund endpoint needed
before 08 can execute an approved `bulk_refund` (propose/refuse path has no dependency).

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| No-touch matcher false negatives (lock evaded by phrasing) | Conservative AND-token match, per-verb extractors reviewed in §16.3 checklist, breach corpus incl. Bangla/mixed-script vectors; ambiguity → refuse |
| Mode×level composition confuses founders (L3 but assisted = drafts) | `min(mode, level)` documented in one place; every verdict names the binding rule; FR-4 UI copy (08) states the effective behavior |
| Dept rename breaks shipped consumers mid-deploy | Code + data migrate in one release; migration idempotent; feed/report readers take keys from `NOVA_DEPARTMENTS` only |
| Cumulative spend check races | Per-store advisory lock around sum+verdict+write; indexed `(tenantId, executedAt)` partial index on spend verbs |
| Freeze-bridge rework in 08 | Matcher + transaction are table-agnostic functions; 08 swaps target table, keeps tests |
| Duty seed drifts from merchant mock/prototype | Seed is authoritative (checked-in); parity fixture documents each curation edit; prototype updated via 08+ UI wiring |
| More than 4 NEEDS DOOR early stages reads as regression | Rollup API returns door build_phase; roster copy says "door ships Stage N" — honesty is the feature |

## Testing strategy

Unit: matcher vectors (bn NFC, token order, near-miss), mode resolution, L1/L2 stage
split, cumulative-cap math + concurrency (two tx race), duty status matrix, migration
(dept keys before/after). Integration: authority routes (owner vs service vs staff 403s),
freeze/unfreeze end-to-end over seeded prepared rows, POST `/actions` defense-in-depth
rejections. Evals (CI hard gates): breach corpus — 35% discount, over-cap campaign
(downgrade not block), bulk_refund at L4 (refuse), no-touch hit, duty below min_level
(skip logged) — via mockModel fixture agent + `t.calledTool({status:"rejected"})`;
prior suites (isolation 44, memory 40, jobs 39) stay green post-rename.

## Performance

`evaluateAuthority` adds ≤3 queries per action: authority state cached per session turn
(invalidated by version bump), duty lookup by key (unique index), day-spend sum only for
spend verbs (partial index). Verdict is pure function after reads — target p95 <50ms
added over shipped `gateAction`.

## Security

All enforcement server-side, twice (nova-ai seam + dakio-api route validation); model
output can propose, never authorize. Guardrail/level/mode/no-touch writes require
merchant-JWT owner role — never service tokens, never agent tools (except ownerOnly
`set_no_touch_lock`, which is founder-principal-gated). `earned_level` has no write API
this phase. Lock strings and duty names render as untrusted data in prompts. Guardrail
history rows immutable (no UPDATE path); every change is itself a ledger action.

## Success & exit criteria

**PRD §15 Stage 1 gate (near-verbatim):** on a clean staging store — a bulk-refund
attempt is **refused + escalated** (blocked ledger row + escalation stub + refusal feed
event); an over-cap campaign is **downgraded to a decision** (prepared draft, rule
`guardrail:daily_spend_cap`, not blocked); adding a no-touch lock **freezes a pending
decision** (seeded prepared reprice → `frozen`, unfreezes on lock removal) — **all
server-enforced, zero manual DB pokes** (verified by replaying the same attempts as raw
API writes — all rejected). *Bridge note: "pending decision" = prepared NovaAction until
08's Decision entity (decision 9).*
**Standing gates:** tsc clean · `eve build` clean · `eve info` 0 diagnostics · phase
suite green · prior suites green · breach evals green under `--strict` (one breach fails
CI, §16.4).
**§16 discipline:** scripted demo on a clean staging store run by a non-builder; artifact
= demo recording + the ledger export from that store, filed with the stage.
Plus: 65 duties seeded with honest statuses + rollups served; ledger rows carry renamed
department keys + `duty_ref`; L1 vs L2 produce observably different records.

## Deliverables

`agent/lib/nova/authority.ts` seam + verb classification/extractor tables; canonical
ladder constants; `agent/lib/duties.ts` (65) + `DOORS`; renamed subagent dirs + ceo→root
merge + ledger migration; Prisma models NovaInstance/NovaGuardrails/NovaAgentMode/
NovaDuty + `frozen`/`escalation` ALTERs; authority/guardrails/duties APIs + defense-in-
depth checks; `bulk_refund` + `set_no_touch_lock` tools; refusal/duty-skip feed events;
breach eval corpus + CI wiring; gate demo script + filed artifacts.

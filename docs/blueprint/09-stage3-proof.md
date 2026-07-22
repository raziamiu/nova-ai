# Phase 09 — Stage 3 "Proof": Campaign Vertical + Night Shift v2 + Brief v2

**PRD stage:** Stage 3 (PRD §15) — **the company milestone: we don't call Nova "working"
until this passes.** · **Prereqs:** 06 (receipts), 07 (authority/duties), 08 (decisions).

> **Baseline correction (2026-07-22): read [`grow-lab-reconciliation.md`](./grow-lab-reconciliation.md) first.**
> The campaign/content doors shipped as Grow Lab (`GrowCampaign`/`GrowPost` +
> **real organic FB publish**). This phase's "Campaign model BUILD" rows become
> EXTEND; the Stage 3 live mutation runs organic-first over `/grow/posts/:id/publish`
> (engineered inverse = Graph post delete); the paid-ads spike (§18) stands but is no
> longer gate-blocking; stat ingestion wires Reports' existing `ads_read` insights
> fetcher into `CampaignDayStat`.
Self-contained. One vertical, end-to-end and unattended: the night shift analyzes every
department, files a scale decision into the 06:00 brief, the founder approves it, the
campaign goes live in the Campaign Manager door with a receipt, and undo reverts it —
twice, on two stores, with no engineer touching anything after "run night shift."

## Already real vs to build

| Capability | Today (repo audit / 02-findings) | This phase |
|---|---|---|
| Campaign data | **HARD GAP** — no stored Campaign model in dakio-api; Meta connection is `ads_read` only (spend/impr/clicks; **no revenue/ROAS/CPA**); `DakioStoreClient.createCampaign/updateCampaign` throw `NotImplementedError`; PRD §14's "Autopilot executes ads" PARTIAL verdict is contradicted by `02-findings` §C | `Campaign` + `CampaignDayStat` models; write path **or** designed propose-only fallback (§18 spike, D1); wizard + templates + calendar APIs |
| Night jobs | REAL — `night_ops`/`weekly_strategy`/`reflection` kinds fire per tenant in local tz (Phase 05, live-verified) | Night shift v2: per-department fan-out inside the night session, typed outputs, CEO merge |
| Night outputs | Markdown `NovaReport` rows only | `NovaPlanItem` (E-7), `NovaDepartment` grades + `NovaScoreMetric` (E-4/E-6), per-dept memos |
| Morning brief | REAL — `morning_report` kind + skill + `NovaReport` (dedupeKey) at store-local time | Structured `NovaBrief` (E-16): narrative + tiles + decision refs + `opened_at`; share card (FR-2.6) |
| Rooms | MOCK — `DEPT_ROOMS` in `novaData.js` (grades, plan board, hist) | Real room APIs: grade/scorecard/plan board/dept-filtered action history/memo |
| Desk→plan flip | 08 stub plan row | Real PlanItem flip on approve (closes the 08 bridge) |

## Objective

Prove the whole operating loop on the hardest vertical (§13 campaign optimization +
§9 night shift + FR-2.4 brief): unattended nightly analysis → authored decisions with
receipts → structured 06:00 brief → one-tap approve → live door mutation → undo. PRD
Stage 3 gate, run twice on two stores.

## Scope

**In:** week-1 Meta write-scope **discovery spike** (§18) + decision record; `Campaign`/
`CampaignDayStat` in dakio-api + StoreClient wiring (kills the `NotImplementedError`s);
Campaign Manager door API (FR-6.1: rows/statuses/pause/resume/duplicate/templates ×6/
calendar) + wizard API (FR-6.2: goal→channels→audience reach→budget w/ **live guardrail
check**→creatives→schedule→review, campaign `owner:'you'`); attribution v1 (roas/revenue
fields fed by order-attribution heuristic, honestly labeled); night shift v2 (per-dept
fan-out, typed outputs, CEO merge — the merge also writes `NovaInstance.status_line`,
the FR-2.1 rotating "Nova is now…" vital, from the live job/plan state); E-4/E-6/E-7
entities + room APIs + room UI wiring (grade + scorecard + plan board + dept-filtered
action history + memo + the 07 duty roster with founder toggles, FR-5);
`NovaBrief` + brief APIs + brief UI (away tiles §8 with per-figure ledger links, read
state, share card); PlanItem↔Decision linkage (`WAITING ON YOU`).
**Out:** creative *generation* (10 — wizard accepts uploads/library now, "Nova ×3" slots
land with Content Studio); tonight's-plan cadence + planned-vs-done (13); voice brief
(13); broadcasts/research/growth doors (12).

## System architecture

```
02:00 store-tz dispatcher → night_ops job → receive(internal) → night session (root = CEO-Nova)
   ├─ per-department delegation ×9 (marketing…growth), each with outputSchema:
   │    { grade, metrics[3], memoDelta, planItems[], proposedActions[] }   ← typed, no prose parsing
   ├─ CEO merge: in-guardrail actions → performAction (executed + receipts)
   │             over-authority   → decisions (08) with §13 authoring
   │             persists NovaDepartment/NovaScoreMetric/NovaPlanItem rows
   └─ 06:00 job: assembleBrief(ledger + decisions + plan) → NovaBrief (tiles link evidence)
founder 08:00: GET /api/nova/brief → narrative + tiles + top decisions → approve scale decision
   → campaign transition via action pipeline → Campaign Manager door row (by: nova) → undo reverts
```

## Design decisions

1. **Week-1 discovery spike settles the campaign write question (§18, resolves PRD §14 vs
   02-findings).** Timeboxed 5 days against the live Meta connection: can `ads_management`
   scope + budget writes be obtained for merchant ad accounts? Outcome A (writes):
   executors mutate Meta through dakio-api with Idempotency-Keys. Outcome B (no writes):
   **propose-only Marketing** — Nova authors the decision + a ready-to-run wizard draft;
   the founder is the executor (approve opens the prefilled wizard; completing it marks
   the linked action executed with the founder as actor). **Both outcomes pass the gate**
   — the §15 loop demands consent + door + receipt, not a Meta API. The spike's outcome
   is itself filed as a decision record in the repo.
2. **Campaign state lives in Dakio, stats are ingested (E-10).** `Campaign` rows are the
   door's source of truth (`transitions only via actions` — every status change goes
   through `performAction`); `CampaignDayStat` ingests Meta insights daily (read scope is
   confirmed) + order-attribution revenue (D3). Demo backend keeps its in-memory twin for
   evals.
3. **Attribution v1 is honest, not precise.** ROAS/revenue per campaign = attributed
   orders (UTM/coupon-code/landing heuristics available in Dakio today) with
   `basis:'estimated'` labeling (same convention as `revenueBasis`, Phase 04). No number
   without a named basis (§2.4); measured upgrades ride 15's grounding work.
4. **Night shift v2 = one job, typed fan-out (§9, §13).** The shipped `night_ops` slot
   stays the scheduler unit (one session per tenant per night — cost-bounded, lease-fenced).
   Inside it, CEO-Nova delegates to the 9 department subagents **with `outputSchema`**
   (eve task-mode structured returns — canon §4.3): each returns
   `{grade, metrics[3], memoDelta, planItems[], proposedActions[]}`. CEO merges:
   guardrail-passing actions execute with receipts; the rest become decisions; entities
   persist via service routes. Model tiering: departments on the cheap tier, CEO merge on
   the core tier (dispatcher job-kind hint, shipped 05). Fan-out is plain multi-tool
   delegation (subagent batch) — eve's `Workflow` tool is reserved for 14's map-reduce.
5. **Grades are computed narratives over persisted metrics (E-4/E-6).** Each department's
   3 `ScoreMetric` rows (label/value/target/pct/tone) are written nightly from
   analytics + ledger; `grade` (A–F) derives from metric pcts by fixed weights —
   deterministic input, model narrative on top (`memo`). "Explain grade" (FR-7, Stage 5)
   will cite these persisted rows — receipts for grades.
6. **PlanItems close the 08 bridge (E-7).** Night shift authors `SCHEDULED`/`IN PROGRESS`
   items; over-authority items are born `WAITING ON YOU` with `decision_ref` — approving
   the decision flips them `IN PROGRESS/DONE` inside the 08 approve transaction (the gate's
   "flips plan item" step, now real). `NEEDS DOOR` items generate only for duties whose
   door is unshipped (07 registry) — the roster's honesty extends to the plan board.
7. **Brief is assembled from rows, not free-generated (FR-2.4, §13 grounding).**
   `assembleBrief()` builds tiles (§8: revenue/orders/messages/carts/posts/products/
   alerts/profit/hours — tiles render only when their source is real; each links its
   ledger query) and top-3 decision refs **deterministically**; the model writes only the
   narrative, constrained to reference tile ids it received. `opened_at` tracked
   (unread badge); share card (FR-2.6) renders the same tile data to a static export.
   06:00 store-time cadence is the shipped job def; `NovaReport` stays for
   pulse/weekly kinds — `NovaBrief` supersedes `kind:'morning'`.
8. **Two-store gate is the isolation proof.** The Phase 03 suite proved data isolation;
   Stage 3 proves *operational* isolation: two stores, different data, both nights run,
   both briefs correct, zero cross-talk — asserted by the gate script before the human
   demo.

## EVE features to use (exact surface)

- **Subagent `outputSchema`** (`docs/subagents.mdx`): delegation input
  `{ message, outputSchema }` → child runs task-mode, returns validated JSON as the tool
  result. Night-shift schemas live in `agent/lib/night/schemas.ts` (zod → JSON Schema).
- **Subagent retry semantics**: transient model failures auto-retry (≤3) from committed
  snapshots — a 3am Anthropic overload doesn't duplicate executed actions (tools already
  idempotent, Phase 02).
- **Dispatcher `receive()` sessions** (shipped 05): unchanged; night session runs under
  `tenantAppPrincipal`; trust-plane decision tools stay denied to it (08).
- **Dev harness**: `POST /eve/v1/dev/schedules/dispatcher` + job seeding = the exact
  production dispatch path for gate rehearsal (`sessionIds` streamed for assertion).
- **Dynamic model per job kind** (shipped): department runs get the cheap tier via the
  job-kind hint; CEO merge core tier.

## External services

Meta Graph API via dakio-api's existing `MetaAdsConnection` (read confirmed; write scope
= spike outcome). No other new services.

## Data models

```prisma
model Campaign {                       // E-10 — door source of truth
  id String @id @default(cuid()); tenantId String
  name String; owner String            // 'nova' | 'you'
  status String                        // draft|scheduled|active|paused|completed
  decisionRef String?; channels Json; goal String?; audience Json?
  budgetPerDayMinor BigInt?; spentMinor BigInt @default(0)
  roas Decimal?; revenueMinor BigInt @default(0); revenueBasis String @default("estimated")
  metaCampaignId String?               // null in propose-only mode
  templateKey String?; scheduledAt DateTime?; novaActionId String?   // by:nova (06 convention)
  createdAt DateTime; updatedAt DateTime; deletedAt DateTime?
}
model CampaignDayStat { campaignId String; day DateTime; spendMinor BigInt; impressions Int;
  clicks Int; ordersAttributed Int; revenueMinor BigInt; basis String; @@unique([campaignId, day]) }

model NovaDepartment {                 // E-4 — nightly grade/memo/now-next
  tenantId String; key String; grade String; statusLine String?
  now String?; next Json; memo String?; gradedAt DateTime
  @@unique([tenantId, key]) }
model NovaScoreMetric {                // E-6 — 3 per dept, grade inputs (receipts for grades)
  tenantId String; department String; label String; value String
  targetText String; pct Int; tone String; day DateTime
  @@index([tenantId, department, day]) }
model NovaPlanItem {                   // E-7 — plan board + (13) tonight's plan
  id String @id @default(cuid()); tenantId String; department String
  status String                        // DONE|IN_PROGRESS|WAITING_ON_YOU|SCHEDULED|NEEDS_DOOR
  title String; detail String?; progressPct Int @default(0)
  decisionRef String?; nightShiftDate DateTime?
  createdAt DateTime; updatedAt DateTime; deletedAt DateTime? }
model NovaBrief {                      // E-16 Brief — structured morning report
  id String @id @default(cuid()); tenantId String; day DateTime
  narrative String; tiles Json         // [{key,label,valueMinor?|value,evidenceQuery,basis}]
  decisionRefs Json; plannedVsDone Json?   // scored from 13's tonight's plan
  openedAt DateTime?; dedupeKey String
  @@unique([tenantId, dedupeKey]) }
```

## APIs & interfaces

dakio-api door + wizard (merchant JWT): `GET/POST /api/nova/campaigns` ·
`POST /api/nova/campaigns/:id/pause|resume|duplicate` (each executes through the action
pipeline — transitions only via actions) · `GET /api/nova/campaigns/templates` (6 seed)
· `GET /api/nova/campaigns/calendar` · `POST /api/nova/campaigns/wizard/check` (live
guardrail verdict via 07's `evaluateAuthority` — FR-6.2 budget step) ·
`POST /api/nova/campaigns/wizard` (creates scheduled campaign `owner:'you'` + founder-
actor ledger row). Audience-reach estimate: Meta read API, cached 1h.
Rooms/brief: `GET /api/nova/rooms/:dept` (grade+metrics+plan+memo+dept-filtered actions
+ duty roster w/ computed statuses from 07) · `GET /api/nova/status-line` (FR-2.1 vital)
· `GET /api/nova/brief[?day]` / `POST /api/nova/brief/:id/opened` · share card
`GET /api/nova/brief/:id/card` (static render).
Service surface: night-shift writes (`/agent-data/departments|score-metrics|plan-items|
briefs`), campaign stat ingest job.
nova-ai: `agent/lib/night/` (schemas, merge, grade math, assembleBrief); StoreClient
campaign methods implemented (or propose-only stubs per spike outcome — flagged at
runtime, never silently); wizard-draft authoring in decision payloads (outcome B).
All founder-facing strings bn+en; money ৳ minor units.

## Implementation steps

1. **Spike (week 1):** Meta write-scope investigation → decision record → branch D1
   outcome A/B through the rest of the plan.
2. Campaign + stat models, door/wizard/calendar/templates APIs, action-pipeline
   transitions, stat-ingest job kind, attribution v1.
3. StoreClient campaign methods (kill `NotImplementedError`s) + executor updates +
   campaign-optimization skill refresh (real fields).
4. Night schemas + department subagent instruction updates (typed contract) + CEO merge +
   entity persistence + model-tier hints.
5. E-4/E-6/E-7 + room APIs + PlanItem flip inside 08's approve transaction.
6. `assembleBrief` + brief APIs + tiles-with-evidence + share card.
7. Merchant wiring: Campaign Manager door + wizard UI (prototype exists as tiles/mock),
   rooms (grades/plan/history), brief modal + share card — mock veins deleted per surface.
8. Two-store staging seed + `stage3-gate.ts` (assert both stores end-to-end) + scripted
   demo ×2 by a non-builder; artifacts filed.

## Dependencies

06–08 shipped. Meta ads write scope (spike; fallback designed in). Two clean staging
stores with realistic seeded commerce data (PRD-signature bleeder campaign + scale-ready
candidate — the Phase-02 seed script extended to staging).

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Meta writes unobtainable | Outcome B is a first-class design, not a degraded one — gate passes with founder-as-executor (§18 says exactly this) |
| Night fan-out cost ×9 departments | cheap tier for departments; one night session per tenant; token budget per session (eve `limits`) + 15's per-tenant budgets |
| Typed outputs fail validation at 3am | outputSchema validation errors auto-retry (eve); on exhaustion the department is skipped + logged (`duty_skipped` honesty event) — brief says so rather than fabricating |
| Attribution heuristic overclaims | `basis:'estimated'` on every figure; tiles carry basis; §2.4 no-number-without-evidence |
| Brief narrative drifts from tiles | narrative constrained to tile ids; gate spot-audits narrative claims vs ledger (Stage 5's audit harness previews here) |
| Grade formula feels arbitrary | fixed documented weights over persisted metrics; "explain grade" cites rows; founders see the same 3 metrics the grade used |
| Two-store demo flakes on data | gate script asserts machine-checkable steps before the human demo; §16.5 shrink honestly if a tile's source isn't real yet |

## Testing strategy

Unit: grade math, brief assembly determinism, attribution joins, wizard guardrail check.
Integration: campaign transition-only-via-actions (direct PATCH → 422), stat ingest
idempotency, room composition, PlanItem flip in approve transaction. Night rehearsal:
dev-dispatch dispatcher on 2 seeded demo tenants → assert typed outputs persisted,
decisions authored, briefs assembled, zero cross-tenant rows (isolation suite extended).
Evals: night-shift department output quality (schema-valid + grounded metrics) per dept;
morning-brief eval updated to structured form. Prior suites green.

## Performance

Night session: 9 concurrent subagent calls (eve batches parallel delegations), cheap
tier — target < 8 min/tenant/night, tokens metered per job (usage into the ledger for
15's economics). Brief read is one row + tile queries (<150ms p95). Wizard reach check
cached; guardrail check is the 07 pure function.

## Security

Campaign writes carry Idempotency-Key + `X-Nova-Action-Id` (06); wizard executes as the
founder (JWT actor), Nova drafts as `nova` — actor separation preserved in the ledger.
Night session remains a non-user principal: it can author decisions but never approve
(08 denial). Meta tokens stay in dakio-api env (never in Nova context or model output).
Department typed outputs are data — merge step validates against schema before any
persistence (no prompt-injected SQL-ish payloads).

## Success & exit criteria

**PRD §15 Stage 3 gate (verbatim):** *Run twice on two stores: night shift → 06:00 brief
with a scale decision → approve → live in Campaign Manager → receipt → undo reverts. No
engineer touches anything after "run night shift."* **Company milestone.**
**Standing gates** (tsc/eve build/info/suites/breach evals) · **§16 discipline** (clean
staging stores ×2, non-builder runner, demo recordings + ledger exports filed).
**Phase-specific:** spike decision record filed · zero `NotImplementedError` on campaign
paths (or explicit propose-only mode flag) · briefs assembled at 06:00 local ±5m on both
stores · every brief tile links a reproducible ledger/door query · PlanItem flip observed
in the approve transaction · rooms render persisted grades/metrics (mock `DEPT_ROOMS`
deleted).

## Deliverables

Spike report + decision record; Campaign/CampaignDayStat + door/wizard/calendar APIs +
templates; StoreClient campaign implementation; night shift v2 (schemas, fan-out, merge,
tiering); E-4/E-6/E-7 entities + room APIs + UI; NovaBrief + brief UI + share card;
attribution v1; two-store gate script; demo recordings ×2 + ledger exports; capability
report `phase-09-stage3-proof.md` + matrix updates.

# Phase 01 — Foundation (Agent Core) · capability report

- **Status:** shipped
- **Branch / commit:** `claude/nova-phase-4-memory-avdxb6` @ `5fe4992` + `0d5e325` (build) + `93cdcaa` (complete: seed + evals)
- **Date:** 2026-07-20
- **Blueprint:** `docs/blueprint/01-foundation-agent-core.md`

> Phase 1 stands Nova up as a working AI Business Operator over a realistic
> **demo** store: a persona, 10 department subagents, ~40 tools, a real
> **action pipeline** (gate → executed/prepared/blocked → audit → undo), the
> **5-level autonomy** system with owner guardrails, an analytics + anomaly
> engine, an activity ledger that quantifies **hours saved**, and the proactive
> daily loop (morning/night/pulse/cart/weekly schedules). Founder-facing: *Nova
> can already run a store's day — observe, decide, act within permission, and
> report — end to end, on demo data.*

## Gate (all must be green)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ⏸ not re-run this session — `node_modules` absent; claimed green in blueprint exit criteria |
| `npx eve build` | ⏸ not re-run this session |
| `npx eve info` diagnostics | ⏸ not re-run this session |
| This phase's test suite | `evals/nova/*.eval.ts` — 4 **model-in-the-loop** evals (business-pulse, autonomy-gating, cart-recovery, morning-report) |
| Blueprint "40-check smoke test" | ⚠️ **no smoke-test file found in repo** (`**/*.{test,spec,smoke}.ts` = 0 hits); the deterministic suites that exist (`isolation`, `memory`) are Phase 3/4 |

> **Honesty note — important.** The four Phase-1 evals each drive a **live model**
> via `t.send` and need `AI_GATEWAY_API_KEY` — they can't run here even with deps
> installed. The blueprint marks a "40-check smoke test" done, but **no such file
> exists** in the tree. So Phase 1's gate is *authored-but-unverified-in-this-
> workspace*; the deterministic proof of the underlying mechanics now lives in the
> Phase 3/4 suites, which exercise the same tools/services without a model.

## New capabilities this phase

- **Action pipeline (single mutation path)** — `agent/lib/nova/actions.ts`
  (`performAction`): gate → write an `ActionRecord` as `blocked` / `prepared` /
  executed → persist to the audit log → undo from the executor's `undoData`
  snapshot. `PerformResult.status` is typed to exactly
  `"executed" | "prepared" | "blocked"`. — *Caveat: the audit log is the
  in-memory demo store; it resets on process restart.*
- **11 action tools all honor the contract** — `assign_courier`,
  `create_campaign`, `create_discount`, `create_purchase_order`,
  `import_product`, `publish_social_post`, `resolve_ticket`,
  `send_customer_message`, `switch_supplier`, `update_campaign`, `update_price`
  all route through `performAction`. Mutations execute via a single
  `executors.ts` registry. — *Caveat: mutations hit `DemoStore` arrays, not Dakio.*
- **Owner trust plane** — `approve_action` / `reject_action` / `undo_action` /
  `list_actions` (`actions.ts`: `approveAction`/`rejectAction`/`undoAction`).
  Undo restores from the reversible action's snapshot. — *Note: `rejectAction`
  also fires `learnFromRejection` — that memory write is Phase 4, not Phase 1.*
- **5-level autonomy system** — `agent/lib/nova/autonomy.ts` (`gateAction`):
  level 0 blocks all; 1–2 prepare; 3 auto-executes only `low`-risk; 4
  auto-executes anything passing guardrails. Per-action inherent risk in
  `RISK_CLASS`. Seed default = **level 2**. Matches the PRD table.
- **Owner guardrails** — `DEFAULT_GUARDRAILS` (20% discount, 15% price, 50%
  budget, 25% margin floor, $2500 auto-PO, $100 auto-refund); `checkGuardrails`
  hard-**blocks** over-cap discounts / sub-floor margins and forces **approval**
  on oversize deltas. Configurable via `configure_autonomy`. — *Caveat:
  `maxAutoRefundTotal` is defined but **inert** — no refund `ActionType` exists
  to enforce it against.*
- **Justification on every action** — `agent/lib/nova/schemas.ts`
  (`justificationSchema`: reason / expectedImpact / confidence) is extended onto
  every action tool's input and persisted on the record. Delivers PRD "Explain
  Every Decision."
- **Analytics engine (read-only)** — `agent/lib/nova/analytics.ts`:
  `computeCampaignMetrics` (ROAS/CPA windows), `buildBusinessSnapshot`
  (one-call pulse + profit estimate), `buildFinanceReport` (P&L + daily series +
  margin ranking).
- **Anomaly detection (7 domains)** — `analytics.ts` (`detectAnomalies`): ads,
  inventory, logistics, sales, support, carts, margin — severity-ranked findings
  with evidence and a concrete suggested tool call. — *Caveat: fixed threshold
  heuristics (e.g. ROAS<1, on-time<0.85, CPA trend≥30%), not learned/statistical.*
- **10 department subagents** — `agent/subagents/*` (`ceo`, `marketing`, `sales`,
  `support`, `product_research`, `inventory`, `supplier_manager`,
  `courier_manager`, `finance`, `growth`) = `NOVA_DEPARTMENTS`. — *Caveat:
  behavior is prompt/markdown-driven, not a deterministic mechanism.*
- **Proactive daily loop** — 5 schedules: `morning-report` (08:00),
  `night-operations` (02:00), `pulse-monitor` (hourly 09–21), `cart-recovery`
  (every 4h), `weekly-strategy` (Mon 09:00) + 4 skills. — *Caveat: schedule output
  shape depends on the model following markdown; cron doesn't fire under `eve dev`.*
- **Activity ledger / hours-saved** — `agent/lib/nova/activity.ts`
  (`MINUTES_BY_ACTION`, `recordActivity`, `summarizeWork`) — tasks, hours, and
  revenue by department, surfaced in the snapshot. Delivers PRD "Business Hours
  Saved."
- **Realistic deterministic seed** — `agent/lib/store/seed.ts` (`createSeed`,
  no RNG/clock): ~19 products, 5 suppliers, 4 couriers, 24 customers, 70+
  orders, 14 abandoned carts, 7 campaigns (incl. a scripted CPA-bleeder), 12
  tickets, seeded memory, overnight activity, and 2 pre-seeded prepared actions.

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| Autonomy Levels 0–4 | ⬜ | ✅ (demo) | Full gate logic + risk classes + guardrails. |
| Trust System (reason/impact/undo/approval) | ⬜ | ✅ (demo) | Justification on every action; approve/reject/undo. |
| 10 Departments | ⬜ | ✅ | All 10 subagents exist (prompt-driven). |
| Execution over Suggestions | ⬜ | ✅ (demo) | Real gated mutations via one pipeline. |
| Success Metric — Hours Saved | ⬜ | ✅ | Activity ledger + `summarizeWork`. |
| Success Metric — Revenue Influenced | ⬜ | 🟡 | Heuristic only (cart recovery 25%; else 0). → Phase 4. |
| Memory System | ⬜ | 🟡 | 7-namespace key/value + per-turn injection. → Phase 4. |
| Daily Workflow (morning/night) | ⬜ | ✅ (demo) | 5 schedules + skills; output model-dependent. |

## Scenario walkthroughs

### Scenario 1 — "How's the business doing?"
The founder asks a single open question. Nova calls `get_business_snapshot`
(one-call pulse: revenue, orders, profit estimate, prepared approvals waiting)
and answers with real numbers from the seed, not vibes — leading with what needs
attention. *(Grounded: `evals/nova/business-pulse.eval.ts` asserts the tool call
+ a `$` + revenue/orders/profit in the reply.)*

### Scenario 2 — A 35%-off blowout gets blocked, honestly
The founder asks for a 35% discount. `create_discount` runs the guardrail check,
which hard-blocks it (cap is 20%). Nova reports the block and the cap — and does
**not** claim a code like `BLOWOUT35` was created. *(Grounded:
`autonomy-gating.eval.ts` asserts the block acknowledgement and the no-false-
success check.)* This is the autonomy contract + the honesty principle in one.

### Scenario 3 — Overnight cart recovery, prepared for approval
At autonomy level 2, Nova finds 14 abandoned carts (`get_abandoned_carts`),
prepares a personalized `send_customer_message` for each, books an *estimated*
influence (cart value × 25%), and tells the founder the count and value waiting
to send. *(Grounded: `cart-recovery.eval.ts`.)* **Today vs vision:** the 25% is
a heuristic and the carts are seed data; Phase 4 rewrites influence to measured
order totals, and Phase 2 makes the carts real.

## Known limitations / not yet

- **In-memory DEMO backend** — no live Dakio, no persistence across restart.
  → Phase 2 (deferred).
- **`revenueInfluence` is heuristic** and mostly zero (only cart recovery is
  non-zero). → Phase 4 measured attribution (shipped).
- **Profit/anomaly numbers are heuristics** — COGS from current cost, fixed
  thresholds, fixed 25% recovery rate.
- **Phase-1 evals are model-in-the-loop** (need a gateway key) and there is **no
  deterministic smoke test** in the repo despite the blueprint claim.
- **`maxAutoRefundTotal` guardrail is inert** — no refund action type.
- **Department/report/skill quality is model-dependent** — markdown, not code
  guarantees.

## Matrix updates

Rows: Autonomy Levels, Trust System (reason/undo/approval), Guardrails, 10
Departments, Execution-over-Suggestions, Hours-Saved, Revenue-Influenced
(heuristic), Memory (basic), Reports & Schedules, Anomaly radar, Demo backend.
See `docs/prd/capability-matrix.md`.

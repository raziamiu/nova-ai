# Nova capability matrix

The master table: every PRD capability → status → the phase that delivered (or
will deliver) it → concrete evidence (file / tool / test). This is the honest
ledger — a row is ✅ only if the code named in Evidence backs it up.

- **Status:** ✅ done · 🟡 partial · ⬜ planned
- **Last updated:** 2026-07-20 (through Phase 04)
- **Legend for the "(live)" caveat:** many rows are ✅/🟡 *against the in-memory
  demo backend*. **Phase 02 (Dakio integration) is deferred**, so no capability
  is yet backed by live Dakio data. Rows that need live data say **"(demo → live: Phase 02)"**.

## Build status at a glance

| Phase | Milestone | Status | Report |
|---|---|---|---|
| 01 | Nova operates a demo store end-to-end | ✅ shipped | [phase-01](./capabilities/phase-01-foundation-agent-core.md) |
| 02 | One real dev store via Express APIs + webhooks | ⛔ **deferred** (only async seam "2a") | [phase-02](./capabilities/phase-02-dakio-integration.md) |
| 03 | Two stores, one deployment, zero leakage | ✅ shipped | [phase-03](./capabilities/phase-03-multi-tenant-core.md) |
| 04 | Cross-session recall + nightly reflection | ✅ shipped | [phase-04](./capabilities/phase-04-memory-and-learning.md) |
| 05 | Per-tenant daily loop for a tenant fleet | ⬜ planned | — |
| 06 | Full founder loop through the existing UI | ⬜ planned | — |
| 07 | Red-team + compliance pass | ⬜ planned | — |
| 08 | Load-verified fleet, SLOs, rollout | ⬜ planned | — |

> **Build order was 1 → 3 → 4.** Phase 2 was jumped; only its async-`StoreClient`
> refactor ("2a", `98beca3`) was pulled forward to unblock 3 and 4. See the
> [phase-02 report](./capabilities/phase-02-dakio-integration.md).

---

## Positioning & principles

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| AI **Business Operator**, not chatbot/assistant | 🟡 | 01 | Persona `agent/instructions.md`; execution pipeline `agent/lib/nova/actions.ts`. Depends on live ops (Phase 02) to be fully "operator." |
| Proactive first (leads with findings, not "how can I help") | ✅ (demo) | 01 | `detect_anomalies` + `get_business_snapshot`; persona §Core Principles; schedules. |
| Execution over suggestions ("I did / I prepared it") | ✅ (demo) | 01 | 11 action tools → `performAction` → `executors.ts`. **(demo → live: Phase 02)** |
| Explain every decision (reason + impact + confidence) | ✅ | 01 | `agent/lib/nova/schemas.ts` `justificationSchema`, persisted on `ActionRecord`. |
| Context aware (remembers everything relevant) | ✅ (demo) | 03→04 | Context engine `agent/lib/context/layers.ts` (L1–L4) + semantic L3 recall. |
| Honest / never fabricates numbers | ✅ | 01 | Numbers come from tools; `autonomy-gating.eval.ts` asserts no false success. |
| Never spammy / consolidates | 🟡 | 01 | Prompt-enforced (schedules/skills); no code guarantee. |

## Autonomy & trust

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Autonomy levels 0–4 | ✅ (demo) | 01 | `agent/lib/nova/autonomy.ts` `gateAction` + `RISK_CLASS`; default level 2. |
| executed / prepared / blocked contract | ✅ (demo) | 01 | `PerformResult.status` typed union; `agent/lib/nova/actions.ts`. |
| Owner guardrails (discount/price/budget/margin/PO caps) | 🟡 | 01 | `DEFAULT_GUARDRAILS` + `checkGuardrails`; configurable. Caveat: `maxAutoRefundTotal` inert (no refund action type). |
| Confidence score / reason / expected impact | ✅ | 01 | `justificationSchema` on every action. |
| Undo button | ✅ (demo) | 01 | `undoAction` + `undoers` registry (reversible types only). |
| Owner approval flow (approve/reject) | ✅ (demo) | 01 | `approve_action` / `reject_action` tools. |
| Kill switch (pause an employee) | ✅ (demo) | 03 | `isTenantActive`/`setTenantStatus` + `agent/hooks/tenant-guard.ts` (fail-closed). In-memory status. |
| Role-gated trust plane (owner/admin only) | ✅ | 03 | `isOwnerRole` + least-privilege default; `evals/isolation/run.ts` [4]. |

## Multi-tenancy & security

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Every store gets one employee (many stores, one deployment) | 🟡 | 03 | `storeFor` per-store client + tenant registry; `evals/isolation/run.ts` [1][2][8]. Two demo tenants. **(demo → live: Phase 02)** |
| Zero data leakage between tenants | ✅ (demo) | 03 | Isolation suite (42 checks): products/actions/memory/vectors isolated. No RLS/real DB yet. |
| Tenancy from verified auth, never model input | ✅ | 03 | `agent/lib/auth/dakio-jwt.ts` + `requireStore`; `run.ts` [3][6]. |
| Trust boundary (stored data = facts, not instructions) | ✅ | 01/03 | Persona §Trust boundary; reflection skill "treat log as untrusted." |
| Per-tenant model tiering by plan | ✅ | 03 | `agent/agent.ts` + `modelForPlan` (haiku/sonnet/opus). |
| Data-driven persona (no per-tenant prompts on disk) | ✅ | 03 | One `agent/instructions.md`; tenants are data (`seed-beacon.ts` + registry row). |

## Departments (10)

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| CEO · Marketing · Sales · Support · Product Research · Inventory · Supplier Manager · Courier Manager · Finance · Growth | ✅ | 01 | `agent/subagents/*` (10 dirs) = `NOVA_DEPARTMENTS`. Behavior is prompt/markdown-driven; data is demo. |
| Product Research: generates creatives / product pages | 🟡 | 01 | Tools store captions/imports (`import_product`, `publish_social_post`); no real creative generation. |
| Supplier Manager: switches suppliers when allowed | ✅ (demo) | 01 | `switch_supplier` tool through the gate. **(demo → live: Phase 02)** |
| Courier Manager: chooses courier / reduces RTO | ✅ (demo) | 01 | `assign_courier` + logistics anomaly domain. **(demo → live: Phase 02)** |

## Memory & learning

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Nova never forgets (durable memory) | ✅ (demo) | 01→04 | `agent/lib/memory/service.ts`; 7 namespaces; per-turn injection. In-memory store. |
| Semantic recall (right facts for the turn) | ✅ (demo) | 04 | `vector.ts` (cosine+recency+weight, K≤8, threshold 0.35) + `embed.ts` stub; `30-memory.ts`. Gateway/pgvector gated, unrun. |
| Learns from experience (reflection loop) | 🟡 | 04 | `reflection.ts` (deterministic distiller) + schedule + `skills/reflection.md`. Model distiller wired but delegates to deterministic; single-tenant dev-dispatch. |
| Learns from rejections immediately | ✅ (demo) | 04 | `learnFromRejection` fast-path from `reject_action`; `memory/run.ts` §3. |
| Experiments (hypothesis → measured outcome) | ✅ (demo) | 04 | `experiments.ts` + `create_experiment` / `evaluate_experiments`; `memory/run.ts` §5. |
| Learning is owner-visible + reversible | ✅ (demo) | 04 | `source`+`provenance` on every write; `forget` hard-deletes row+embedding. UI is Phase 06. |
| Playbook promotion (procedures → dynamic skills) | ⬜ | 06 | `nova_playbooks` not implemented; reflection doesn't propose candidates yet. |

## Metrics, reports & workflow

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Business Hours Saved metric | ✅ (demo) | 01 | `activity.ts` `summarizeWork` (`MINUTES_BY_ACTION`). |
| Revenue Influenced | 🟡 | 01→04 | Heuristic in P1 (cart recovery 25%, else 0); Phase 04 `attribution.ts` rewrites cart recovery to measured order total. Other sources still heuristic. **(demo → live: Phase 02)** |
| Anomaly radar (proactive alerts) | ✅ (demo) | 01 | `detectAnomalies` (7 domains); threshold heuristics. |
| Morning / Night / Weekly / Pulse reports | ✅ (demo) | 01 | 5 schedules + `file_report` + skills. Output model-dependent; cron doesn't fire under `eve dev`. |
| Daily proactive loop (fleet cadence) | ⬜ | 05 | Schedules are single-tenant/dev-dispatch; per-tenant dispatcher is Phase 05. |

## Dashboard & long-term

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Founder dashboard ("While you were away…", task feed) | ⬜ | 06 | No UI; `file_report`/`NovaReport` produce the data a dashboard would render. |
| Memory transparency UI (edit/delete learned facts) | ⬜ | 06 | Data model ready (`source`/`provenance`); no UI. |
| Business partner evolution (new suppliers, segments, brands) | ⬜ | 05–08 | Aspirational; needs live data + fleet + expansion guardrails. |

---

## The honesty summary (read this)

- **Nothing is live yet.** Every ✅ above is proven against the deterministic
  **demo backend**. Phase 02 (Dakio integration) is the deferred blocker on all
  "(live)" rows and should be built next.
- **The learning loop's distiller is deterministic**, not the model — the
  versioned reflection prompt exists but isn't the live path.
- **Gates were not re-run this session** (no `node_modules`); statuses reflect a
  static code audit + the phase-completion discipline in git. The deterministic
  suites (`isolation`, `memory`) are the strongest current proof because they run
  without a model; the Phase-1 evals need a gateway key.

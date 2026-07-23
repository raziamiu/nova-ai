# Nova capability matrix

The master table: every PRD capability → status → the phase that delivered (or
will deliver) it → concrete evidence (file / tool / test). This is the honest
ledger — a row is ✅ only if the code named in Evidence backs it up.

- **Status:** ✅ done · 🟡 partial · ⬜ planned
- **Last updated:** 2026-07-23 (through Phase 06 engineering; the Stage 0 gate is **not** signed off — see the phase-06 report)
- **Legend for the "(live)" caveat:** many rows are ✅/🟡 *against the in-memory
  demo backend* by default (`NOVA_STORE_BACKEND` defaults to `demo`). Phase 02
  shipped a live path behind that env switch; rows tagged
  **"(demo → live: Phase 02)"** are readable/actionable live for core commerce
  when the switch is flipped, not automatically.

## Build status at a glance

| Phase | Milestone | Status | Report |
|---|---|---|---|
| 01 | Nova operates a demo store end-to-end | ✅ shipped | [phase-01](./capabilities/phase-01-foundation-agent-core.md) |
| 02 | One real dev store via Express APIs + webhooks | 🟢 **all slices shipped** (2.0 foundation, 2.1 live reads, 2.2 commerce mutations, 2.3 event-driven proactivity) — marketing/support gap groups remain parked | [phase-02](./capabilities/phase-02-dakio-integration.md) |
| 03 | Two stores, one deployment, zero leakage | ✅ shipped | [phase-03](./capabilities/phase-03-multi-tenant-core.md) |
| 04 | Cross-session recall + nightly reflection | ✅ shipped | [phase-04](./capabilities/phase-04-memory-and-learning.md) |
| 05 | Per-tenant daily loop for a tenant fleet | ✅ shipped | [phase-05](./capabilities/phase-05-proactive-operations.md) |
| 06 | **Stage 0 "Spine"** — every write carries a receipt, lands in a door the founder already uses, and is reversible for 24h | 🟡 **engineering complete, gate NOT signed off** — the PRD §15 demo must be run by a non-builder on staging (H-1/H-2) | [phase-06](./capabilities/phase-06-stage0-spine.md) |
| 07 | **Stage 1 "Law"** — one seam decides every action; founder-only verbs, no-touch locks, door modes, cumulative ৳ cap, 65-duty roster | 🟡 **engineering complete, gate NOT signed off** — the §15 demo needs a non-builder on staging (H-9) | [phase-07](./capabilities/phase-07-stage1-law.md) |
| 08 | **Stage 2 "Consent"** — one Decision record, rendered everywhere, answered once; hire ritual; trust meter | 🟡 **engineering complete, gate NOT signed off** — the §15 demo needs a non-builder on staging (H-11) | [phase-08](./capabilities/phase-08-stage2-consent.md) |
| 09 | **Stage 3 "Proof"** — the whole loop unattended: night shift grades every dept + files a scale decision → approve → live campaign in the door with a receipt → plan item flips to done → undo reverts. Approve now EXECUTES; organic FB publish is the live mutation | 🟡 **engineering complete, loop machine-verified** (`stage3-gate.ts` 10/10) — the §15 demo needs a non-builder on **two** staging stores (H-16). Merchant UI wiring (09-G) + eve dispatcher trigger (blocked by H-13) pending | [phase-09](./capabilities/phase-09-stage3-proof.md) |
| 10 | **Stage 4 "Craft"** — content in the store's own voice (bn+en), scored against a structured brand profile, revised on request | ✅ **DONE — §15 gate signed (stage4-gate 14/14 live)**: scoreVoice (bn-aware, cited) + BrandProfile + review loop (request-changes→v2→approve) + night-shift authoring + publish (10-D, organic FB, honest no-Page) + Content Studio review UI (10-F, CDP) + model generation (10-C, `generate_content` scores the model's copy and files it) | [phase-10](./capabilities/phase-10-stage4-craft.md) |
| 11 | **Stage 5 "Conversation"** — one persistent chat thread; CEO-Nova routes to departments; every number grounded, chat verbs = UI verbs | 🟡 **foundation built** — intent table (routing prompt generated from it), typed reply envelope (signature + grounding validated), thread/message models + persistence + chips, routing contract in root, `disableTool` org-lock; verified (conversation 17, dakio-api 745, eve 0 diagnostics, live persistence smoke). **Live-model half unsigned**: subagent envelopes + merchant stream (11-D), grounding audit + 10-intent corpus (11-E) | [phase-11](./capabilities/phase-11-stage5-conversation.md) |
| 12 | **Stage 6 "Reach"** — remaining doors, broadcasts, research, growth, goals; zero NEEDS DOOR | 🟡 **math floor built** — experiment significance (two-proportion + sample floor) + ICE (E-15), goal pace/projection with honest confidence bands (E-16), research scoring with transparent weights + honest n/a renormalization (E-14); all deterministic + gate-verified (reach 20, research 11). **Remainder**: CustomerChannel + broadcast send infra, segment queries, 4 sub-view doors, furniture matrix, memory UI — DB/UI/integration work | [blueprint](../blueprint/12-stage6-reach.md) |
| 13–15 (v2) | Blueprint v2: one phase per Master Build PRD Stage 7–9 (Presence → Team → Launch) | ⬜ planned | [blueprint v2](../blueprint/README.md) |

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
| Kill switch (pause an employee) | ✅ (demo) | 03→05 | `isTenantActive`/`setTenantStatus` + `agent/hooks/tenant-guard.ts` (fail-closed). In-memory status. Phase 05: also enforced at job-claim time — `requireTenant` 403s a suspended tenant's `/jobs/claim` before the dispatcher's code path runs at all (live-verified). |
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
| Learns from experience (reflection loop) | 🟡 | 04→05 | `reflection.ts` (deterministic distiller) + `skills/reflection.md`; now dispatched per-tenant via the `reflection` job kind (`agent/lib/jobs/prompts.ts`), not a single-tenant dev-dispatch schedule. Model distiller wired but delegates to deterministic. Phase 05: attribution (`runAttribution`, built in Phase 04) is now actually invoked in production via the new `run_attribution` tool as reflection's step 4 — previously only exercised by the eval harness. |
| Learns from rejections immediately | ✅ (demo) | 04 | `learnFromRejection` fast-path from `reject_action`; `memory/run.ts` §3. |
| Experiments (hypothesis → measured outcome) | ✅ (demo) | 04 | `experiments.ts` + `create_experiment` / `evaluate_experiments`; `memory/run.ts` §5. |
| Learning is owner-visible + reversible | ✅ (demo) | 04 | `source`+`provenance` on every write; `forget` hard-deletes row+embedding. UI is Phase 06. |
| Playbook promotion (procedures → dynamic skills) | ⬜ | 06 | `nova_playbooks` not implemented; reflection doesn't propose candidates yet. |

## Metrics, reports & workflow

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Business Hours Saved metric | ✅ (demo → live read: Nova UI Build step 1) | 01 | `activity.ts` `summarizeWork` (`MINUTES_BY_ACTION`); merchant-readable live via `GET /api/nova/home`'s `hoursWorkedToday` (real `NovaActivity` sum, tenant-timezone-aware day boundary). |
| Revenue Influenced | 🟡 | 01→04 | Heuristic in P1 (cart recovery 25%, else 0); Phase 04 `attribution.ts` rewrites cart recovery to measured order total. Other sources still heuristic. **(demo → live: Phase 02)** |
| Anomaly radar (proactive alerts) | ✅ (demo) | 01 | `detectAnomalies` (7 domains); threshold heuristics. |
| Morning / Night / Weekly / Pulse reports | ✅ (demo) | 01 | 5 schedules + `file_report` + skills. Output model-dependent; cron doesn't fire under `eve dev`. |
| Daily proactive loop (fleet cadence) | ✅ | 05 | `agent/schedules/dispatcher.ts` (the one authored schedule) + `NovaJobDef`/`NovaJob` (dakio-api) + `StoreClient.claimDueJobs`. Each of the 6 job kinds fires in its OWN tenant's local time (IANA-tz cron engine, DST-correct); events (`cart.abandoned`) debounce into jobs too. Live-verified against the real dev tenant. |

## Dashboard & long-term

| Capability (PRD) | Status | Phase | Evidence |
|---|---|---|---|
| Founder dashboard ("While you were away…", task feed) | 🟡 | 06 (Nova UI Build, step 1) | UI exists (`dakio-merchant/src/pages/nova/`, Nova HQ) and its live feed + task count are now real — `GET /api/nova/feed`+`/home` (`dakio-api/src/routes/novaDashboard.js`) read `NovaActivity`, pushed live via SSE (`novaFeedBus.js`). Decision cards, autonomy, guardrails still mock — see [nova-ui-build-01](./capabilities/nova-ui-build-01-ledger-feed.md). |
| Memory transparency UI (edit/delete learned facts) | ⬜ | 06 | Data model ready (`source`/`provenance`); no UI. |
| Business partner evolution (new suppliers, segments, brands) | ⬜ | 05–08 | Aspirational; needs live data + fleet + expansion guardrails. |

---

## The honesty summary (read this)

- **A live path now exists (reads, core commerce writes, AND events).**
  Phase 02 (all four slices — 2.0/2.1/2.2/2.3) shipped: with
  `NOVA_STORE_BACKEND=dakio`, Nova reads real Dakio commerce data, persists
  its own state in Dakio's DB, acts (product/order/cart/discount/PO
  mutations, idempotently), and reacts to real order/cart events within the
  hour via the inbox drain rather than only ever discovering them by polling.
  Default is still the demo backend. Marketing/support actions (campaign
  writes, social, ticket status, customer messaging) remain unbuilt — two of
  those are genuine architecture gaps (see phase-02 report), not just
  unscheduled work — so most ✅ rows are still proven against the demo
  backend, and "(demo → live: Phase 02)" now means "readable, actionable, and
  event-reactive live for core commerce; marketing/support actions pending."
- **The learning loop's distiller is deterministic**, not the model — the
  versioned reflection prompt exists but isn't the live path.
- **Phase 05's session had `node_modules` and re-ran everything**: `tsc`,
  `eve build`, `eve info` (0 diagnostics), all three deterministic suites
  (isolation/memory/jobs — 123 checks total), the full dakio-api suite +
  every Nova integration test against a real local Postgres, AND a live
  smoke test against the real dev tenant (seed→claim→lease→complete→
  watchdog-recover→dedupe-verify, cleaned up after). An independent
  adversarial review then found and fixed two real bugs (job lease-fencing;
  a completion-ack failure misrouted into job-failure handling). Earlier
  phases' statuses below Phase 05 still reflect a static code audit plus the
  phase-completion discipline in git, not a fresh re-run this session.
- **Nova UI Build step 1 (2026-07-21) found the PRD's own "BUILD" verdict for
  the action ledger was wrong** — it already existed and was already live
  (Phase 01/02), just never merchant-readable. This step added a read-only
  API + SSE push + minimal UI wiring, zero new tables. Independent
  adversarial review found and fixed 2 critical bugs (an infinite
  redirect-loop regression; an unhandled-error path that could crash the
  whole shared dakio-api process) plus 4 lesser ones — see
  [nova-ui-build-01](./capabilities/nova-ui-build-01-ledger-feed.md) for the
  full list. No browser/visual check was possible (no browser tool available
  in that session) — verified via build + live API + a real captured SSE push
  against the dev tenant instead.
- The deterministic suites (`isolation`, `memory`, `jobs`) are the strongest
  current proof for the phases they cover because they run without a model;
  the Phase-1 evals need a gateway key.

# Phase 14 — Stage 8: Team · capability report

- **Status:** **deterministic engines + agent board built and verified; live
  playbook/negotiation/benchmark flows + privacy audit are honest remainder.**
  Per-agent trust/mode, playbook execution/rollback ordering, the negotiation
  concession ladder, and the benchmark privacy floor are done and tested; the
  agent board renders real per-agent trust from ledger slices.
- **Branch / commits:** `develop` — nova-ai `40631d7` (team engine); dakio-api
  `cd3b7ff` (models + agent board + benchmarks)
- **Date:** 2026-07-23 · **Blueprint:** `docs/blueprint/14-stage8-team.md`

## Gate

| Check | Result |
|---|---|
| `tsc` (nova-ai) | ✅ clean |
| nova-ai suites | + **team 20** — green |
| dakio-api hermetic | ✅ **766 pass / 0 fail** |
| agent board (live) | ✅ per-agent trust from own ledger slice (Marketing-Nova 46 / 7 events; others "earning"); mode change to autonomous |
| benchmark privacy (eval + live) | ✅ zero below-floor rows (floor 20); cold-start view honest, never fabricated; opt-out both directions |
| negotiation guardrail (eval) | ✅ concession ladder never breaches the ceiling / offers above ask; accepts at target |
| playbook rollback (eval) | ✅ reverse-order, HALTS at the first irreversible piece with an honest partial-rollback |

**PRD gate — engines met, product flows remainder.** §15 Stage 8: promote
Marketing-Nova in chat (undo), one-tap Eid playbook with per-piece receipts,
listen-in + voice-sign a negotiation, cohort benchmarks + privacy audit. The
DECISION LOGIC of each is built + tested (trust, mode tier, bundle/rollback
order, concession bounds, privacy floor) and the agent board is live; the
end-to-end product flows (promotion-as-decision-with-undo, bundle executor,
negotiation runner + calls, benchmark fleet job, CEO weekly merge, H2 chat
intents live, and the human privacy audit) are the remainder (H-20).

## New capabilities this phase

- **Team engine (tested, deterministic):** per-agent trust from the department's
  own ledger slice (events floor → "earning trust"), mode resolution
  agent→door→store→assisted, playbook execution/rollback ordering (halt on
  irreversible), negotiation concession ladder (guardrail-bounded — the number
  is code's), benchmark aggregation with a hard ≥20 privacy floor (no below-floor
  row ever, honest cold-start).
- **Agent board (live):** `GET /api/nova/agents` renders every department agent
  with real trust from its ledger slice; `PUT /agents/:dept/mode` sets per-agent
  mode; benchmarks read is opt-in-aware and cold-start-honest.
- **Models:** NovaAgentInstance, NovaSeasonalPlaybook, NovaNegotiation,
  NovaBenchmark (no tenantId — aggregates only), Tenant.novaBenchmarksOptIn.

## Known limitations / not yet (H-20)

- **Promotion is a direct mode set, not yet a decision-with-undo.** The mode tier
  + re-evaluation transaction + 24h undo (restoring mode + re-queuing
  auto-executed pieces) is the remaining wiring.
- **Playbook bundle executor + negotiation round runner not wired.** The ordering
  + concession engines are tested; the `performAction`-walking executor, the
  negotiation calls (on the Stage 7 stack) + listen-in + `contract_sign`
  founder-only signing are the integration.
- **Benchmark fleet job not built.** The floor/aggregation logic is tested; the
  nightly service-side aggregation over consenting tenants + the privacy audit
  (human sign-off) are pending — no real cohort data exists in dev.
- **H2 chat intents stay honestly deferred** until their flows are live (the
  intent table already answers them honestly).
- **CEO weekly merge + per-agent memos** not yet composed.

## Matrix updates

Stage 8 / Phase 14 → engines + agent board built + verified (team 20, live board);
playbook/negotiation/benchmark-job/promotion-undo + privacy audit are the H-20
remainder.

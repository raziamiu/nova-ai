# Phase 08 — Scale, Observability & Production Rollout

**Prereq: Phases 02–07.** Self-contained: taking the working, safe, multi-tenant Nova
to production scale — measurement, cost economics, load behavior, deployment topology,
and the rollout plan to the fleet.

## Objective

Run Nova for a large tenant fleet with known unit economics, SLOs, full tracing, and a
staged rollout with reversible steps. Milestone: load-verified at target scale N,
cost-per-tenant-day within plan margins, on-call-ready.

## Scope

**In**: instrumentation (OTel), per-tenant cost metering, caching, deployment topology
(Vercel vs self-hosted decision), load/chaos testing, SLOs + alerting, rollout plan,
fleet-level learning hooks.
**Out**: multi-region active-active (documented as a later step), fine-tuning.

## System architecture

```
eve instrumentation ─► OTel collector ─► traces (Honeycomb/Tempo)
        │                               metrics (Prometheus/Grafana)
        │                               logs (structured, redacted)
        └─► usage events (tokens, model, tenant, job kind) ─► warehouse (billing + economics)

Topology (decision, see below):
  Vercel: eve app (channels+harness) + Vercel Cron dispatcher + Neon Postgres + Upstash Redis
  Self-hosted alt: Node 24 `eve start` (Nitro) pods ×N + Postgres + Redis
                   (+ `@workflow/world-postgres` for durable session state)
```

## Design decisions

1. **Deployment: start on Vercel** (eve's first-class target: `eve deploy`, cron
   wiring, OIDC, gateway), with a proven self-hosted escape hatch (`eve build && eve
   start` + `experimental.workflow.world = "@workflow/world-postgres"`, pinned to the
   5.0.0-beta line) exercised quarterly in staging. Rationale: serverless absorbs the
   bursty, sparse per-tenant traffic pattern; the escape hatch caps platform risk.
2. **The unit of economics is tenant-day.** Every model call is attributed
   (tenant, surface: chat|job kind, department, model, tokens in/out) via
   instrumentation events → warehouse; plan pricing is validated against measured
   cost-per-tenant-day weekly. Tiering/caching work is prioritized by this dashboard,
   not intuition.
3. **Cache what the fleet repeats:** tenant profile (24h, Phase 03), business snapshot
   (60s TTL — the most-called tool), anomaly scan (5m), campaign metrics (5m). All
   Redis, all keyed `t:{store}:…`, all busted on relevant writes. Prompt caching:
   stable context layers (L0/L1) are ordered FIRST in instructions so provider prompt
   caches hit; model selection stays per-session (cache affinity — eve guidance).
4. **SLOs (initial):** chat first-token p95 < 3.5s; approval button p95 < 1s;
   morning report on-time (±5m local) ≥ 99.5%; job success (≤5 attempts) ≥ 99.9%;
   cross-tenant isolation incidents = 0 (pager, not SLO).
5. **Rollout is autonomy-gated like Nova itself:** internal stores → design-partner
   cohort (L0–L1 only) → GA cohorts with L2 default → L3/L4 unlocked per tenant after
   N clean weeks (automatic eligibility, owner opt-in). Every stage has halt criteria.

## EVE features to use (exact surface)

- **Instrumentation** (`agent/instrumentation.ts`, root-only):
  ```ts
  import { defineInstrumentation } from "eve/instrumentation";
  export default defineInstrumentation({ /* OTel SDK wiring; runs once at boot —
    no defineState/ctx access here (throws) */ });
  ```
  plus `defineHook` `"*"` event mirror for usage events (`step.completed` carries
  usage + finishReason per model call — the token-metering source of truth).
- `eve build` artifacts + `eve info --json` in CI (discovery drift check: tool/
  subagent/schedule counts pinned).
- Session `limits` + `compaction` tuned: compaction threshold default 0.9; long
  founder chats compact with the cheap model tier (`compaction: { model: haiku-tier }`).
- **eve limitations honored**: no built-in per-tenant metering/billing (ours, above);
  Vercel cron granularity = minute (dispatcher already assumes); `eve dev` ≠ prod
  runtime — staging runs the REAL build (`eve build && eve start` or Vercel preview).

## External services

OTel collector + trace/metric/log backends; warehouse (existing Dakio analytics stack
acceptable); k6/artillery for load; Neon/Upstash or self-managed equivalents.

## Data models

`usage_events(at, store_id, surface, department, model, tokens_in, tokens_out,
cost_estimate, session_id, turn_id)` (warehouse); `slo_burn` dashboards derived from
traces/metrics; no new OLTP tables.

## APIs & interfaces

Internal: `GET /internal/economics/tenant-day?cohort=` · Grafana dashboards
(fleet health, job backlog, budget shedding, isolation-test canary) · weekly cost
report job (a Nova-for-Nova touch: filed like a morning report to the eng channel).

## Implementation steps

1. Instrumentation + usage events + redaction policy; traces sampled 10% (100% for
   errors + red-team tags).
2. Cache layer for snapshot/anomalies/campaign metrics + hit-rate metrics + bust hooks.
3. Economics pipeline + per-plan margin dashboard; set tiering targets (e.g. ≥60% of
   job tokens on cheap tier).
4. Load tests: (a) chat concurrency burst; (b) dispatcher with 100k due jobs;
   (c) webhook storm 10k events/min → debounce holds; (d) isolation canary under load.
5. Chaos: kill dispatcher/replicas mid-batch; Postgres failover; Redis loss (budgets
   fail CLOSED for actions, OPEN for reads); gateway 429 storms (backoff + shed).
6. Staging = production topology; quarterly self-hosted fire drill.
7. Runbooks + on-call rotation + pager wiring for the Phase 07 kill paths.
8. Rollout cohorts + halt criteria + weekly economics review cadence.

## Dependencies

All prior phases; infra accounts; pricing/plan inputs from product for margin targets.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Model provider outage | gateway failover model list (dynamic model resolver returns fallback tier); degrade to read-only Nova (reports queue, actions pause) with honest UI banner |
| Vercel platform limits (duration/concurrency) at fleet scale | measured in load tests; self-hosted escape hatch rehearsed; dispatcher shards |
| Cost overrun vs plans | hard budgets (07) cap downside; economics dashboard catches drift weekly |
| Workflow-state store growth (sessions) | session rotation (06) + retention policy on completed sessions |
| Observability PII leakage | redaction at the OTel processor (emails, addresses, tokens); audit of trace samples |

## Testing strategy

Load/chaos suites above with pass thresholds tied to SLOs; isolation canary (two
synthetic tenants continuously cross-probing) running in PROD permanently; weekly
restore drill of Postgres backups; game-day for kill switches.

## Performance considerations

First-token latency budget: auth+context < 200ms, gateway TTFT dominates —
prompt-cache-friendly context ordering is the main lever; snapshot cache converts the
most common tool call to <10ms; dispatcher horizontal scale documented (claim batch ×
replicas).

## Security considerations

Trace/log redaction; warehouse access controls (economics ≠ content); canary tenants
carry no real data; quarterly access review of internal ops APIs.

## Success / exit criteria

Load targets met at scale N with SLOs green · cost-per-tenant-day within plan margin ·
chaos suite green (incl. budget fail-closed) · isolation canary clean 30 days ·
rollout cohort 1 completed with halt criteria never tripped · on-call runbooks
exercised in game-day.

## Deliverables

OTel wiring + dashboards, usage/economics pipeline, cache layer, load & chaos suites,
staging parity + self-hosted drill, rollout plan + halt criteria, runbooks/on-call.

---

*End of blueprint. Extension tracks (multi-region, marketplace of Nova skills, fleet-
level cross-tenant learning with privacy review, additional founder channels like
WhatsApp/Slack via eve channel files) attach cleanly after Phase 08 without
re-architecture.*

# Phase 15 — Stage 9 "Launch hardening": GA

**PRD stage:** Stage 9 (PRD §15) · **Prereqs:** phases 06–14 shipped. Owners: all teams.
Self-contained. This phase absorbs the archived v1 docs `archive/07-trust-safety-scale.md`
and `archive/08-scale-observability-production.md` — their engineering content survives
here with PRD §15 Stage 9 exit criteria replacing their v1 gates. Assume every input
lies and every job runs twice; then run 30 days on ≥20 pilot stores and prove it.

**Pulled-forward ledger (already delivered by earlier v2 phases — do not rebuild):**
undo CI inverse check + append-only whitelist + ledger export → 06 · guardrails-v2
versioning + policy seam (`evaluateAuthority`) + breach evals as CI hard gates → 07 ·
decision expiry TTLs → 08 · degradation shed-order at job claim → 05 (shipped) ·
outbound-content checks (publish surface) → 10 · watchdog + push quiet hours → 13 ·
privacy floor + audit for benchmarks → 14.

## Already real vs to build

| Area | Today | This phase |
|---|---|---|
| Budgets | Per-session eve `limits` only; shed-order priority in dispatcher (05) | Per-tenant daily token/action budgets (Redis) + fleet circuit breaker + degrade ladder |
| Audit | Append-only whitelist (06); receipts 100% schema-enforced | INSERT-only DB role separation, audit completeness state-machine test, 90d cold storage |
| Injection defense | Data-not-instructions framing (01/03); publish-surface outbound checks (10) | `untrusted()` helper sweep across all renderers, provenance-aware gating, red-team corpus + exercise |
| Kill paths | Tenant kill switch live-verified (03/05); turn-cancel cascade (eve) | Fleet stop <30s, runbooks, game-days |
| Observability | `eve info`/build artifacts; SSE feed; no tracing | OTel via `defineInstrumentation`, per-tenant cost metering, dashboards, SLOs |
| Scale | Single Railway instance; in-process SSE bus (documented caveat) | LISTEN/NOTIFY SSE, load/chaos suites, staging parity + self-host drill |
| Grounding | Stats-ref audit harness (11); hours-saved auditor script (13) | Fleet grounding audit ≥99%; measured-basis expansion |
| Rollout | — | ≥20-store pilot cohorts, halt criteria, GA checklist |

## Objective

No tenant can be harmed beyond explicitly-granted authority; every number reproducible;
any tenant or the fleet stoppable in seconds; unit economics known — proven by a 30-day
pilot on ≥20 stores hitting every Stage 9 number, with degradation drills and a red-team
exercise passed.

## Scope

**In:** budgets + circuit breaker + degradation ladder; audit hardening (roles,
completeness, retention); injection defense-in-depth + red team; kill paths + runbooks +
on-call; OTel + per-tenant economics + dashboards; caching + prompt-cache ordering;
load/chaos suites; SSE scale-out; SLOs; grounding audit + basis expansion; degradation
drills (model-down "off duty", voice-down push+desk); rollout cohorts + halt criteria;
compliance checklist.
**Out:** multi-region active-active (documented later step); fine-tuning (never in v1);
new product surfaces (frozen during hardening — §16.5 gate-cut rule).

## System architecture

```
POLICY LAYER (final form — steps 1-5 existed by 07, hardened here)
 every action: schema (zod) → tenancy (03/06) → kill+budget (Redis, NEW) →
   evaluateAuthority (07) → execute idempotent + undo snapshot (06) → receipt + audit row
 model context: untrusted() labeling on EVERY external string (customer msgs, webhooks,
   memory values, product descriptions, negotiation replies, lock names)

eve instrumentation ─► OTel collector ─► traces (10% sampled, 100% errors/red-team tags)
  step.started runtimeContext {tenantId, surface, dept, jobKind} ─► per-tenant token metering
  ─► usage_events warehouse ─► cost-per-tenant-day + plan-margin dashboards
novaFeedBus (in-process) ─► Postgres LISTEN/NOTIFY fan-out ─► SSE across N instances
Deployment: Railway `eve start` (Nitro cron) · proxy forwards /eve/ + /.well-known/workflow/
  · @workflow/world-postgres@5.0.0-beta.x pinned · quarterly self-host fire drill
```

## Design decisions

1. **Budgets are layered hard ceilings, checked pre-model and pre-action (archived-07
   D2).** Per-tenant daily token budget (plan-based) + per-risk-class daily action
   counts + per-action financial caps (07 guardrails) + fleet spend/min circuit
   breaker. Redis counters (`t:{store}:tokens:{yyyymmdd}`, `t:{store}:acts:{risk}:…`,
   `fleet:spend:1m`); exceeded ⇒ the 05 degradation ladder (drop pulse → reduce sweeps
   → keep brief → **decision surfacing never sheds**). Token source of truth: eve
   `step.completed` usage events mirrored by hook into the metering pipe; eve session
   `limits` stay a backstop (per-session only — documented eve gap).
2. **Metering rides instrumentation, not guesswork (archived-08 D2; canon §4.8).**
   `defineInstrumentation` with `events["step.started"]` stamping
   `{tenantId, surface, department, jobKind}` runtimeContext onto every model-call
   span; `recordInputs/recordOutputs: false` (merchant financial data never leaves —
   defaults are TRUE, flipped deliberately). Economics = usage_events → warehouse →
   cost-per-tenant-day by plan, reviewed weekly; tiering targets (≥60% of job tokens on
   cheap tier) enforced by dashboard, not intuition. $eve.* run tags are unavailable
   off-Vercel — OTel is the plane.
3. **Injection defense is structural (archived-07 D3, §16 spirit).** `untrusted(text)`
   helper wraps every external string entering context with fenced data framing —
   adoption sweep is a lint rule (renderers must import it). Provenance-aware gating:
   high-risk actions in sessions that ingested raw external text within N turns get a
   provenance note + stricter verdict (L4 tenants: force decision). Outbound checks
   (10) extend to every send surface (broadcasts, negotiation messages). Red-team
   corpus (injection via product description / review / webhook / negotiation reply /
   memory value; cross-tenant probes; budget exhaustion; replay) runs as CI evals —
   breaches are hard gates (§16.4), and a live exercise precedes the pilot.
4. **Audit hardening completes 06's whitelist.** Postgres role separation: app role
   INSERT-only on `NovaAction`/audit tables (no UPDATE/DELETE grants; status
   transitions via a SECURITY DEFINER function implementing the 06 whitelist);
   completeness test walks the action state machine asserting exactly one audit row
   per transition; monthly partitions, cold storage after 90d; benchmark-raw access
   confined to the aggregation role (14).
5. **Kill paths get drills, not just switches.** Tenant pause <5s (shipped, now
   measured); fleet stop <30s (circuit breaker + dispatcher halt flag + turn-cancel
   cascade for in-flight sessions); voice-down ⇒ push+desk fallback (13 ladder skips
   tier 1); model-down ⇒ **"off duty"** founder-facing state (HQ banner, doors' manual
   `+ Create` paths keep working — 12's furniture is the degradation guarantee),
   reports queue, actions pause. Each is a scripted drill in the gate; runbooks +
   on-call rotation + pager wiring.
6. **SSE grows up: LISTEN/NOTIFY (repo-audit caveat).** `novaFeedBus` keeps its API;
   transport becomes Postgres NOTIFY (payload = tenant + event ref, listeners re-fetch)
   so feed/decision/transcript pushes survive multi-instance Railway. Load-tested to
   the p95 ≤3s SLO under fan-out.
7. **Grounding audit generalizes 11's harness (§14 NFR, Stage 9 ≥99%).** Nightly
   sampled audit: brief tiles, chat stats refs, hours-saved, campaign figures, grades —
   re-derived from ledger/door queries; mismatches page. `basis:'estimated'` figures
   are exempt from equality but must name their heuristic; the measured-basis share is
   itself a tracked metric (attribution expansion beyond cart recovery rides here).
8. **Rollout is earned-level-aware (canon §3 — supersedes archived-08 D5).** Cohorts:
   internal stores → design partners → GA waves. Every store hires at L3 with L4
   locked by trust (07/08) — the product mechanism IS the rollout caution; cohort
   gates add fleet-level halt criteria (isolation incident = full stop; breach = stop;
   budget overrun >2× plan = pause wave; watchdog FP > SLO = pause wave). 30-day pilot
   on ≥20 real stores is the gate's substrate.
9. **Deployment truth: Railway-first, drilled (canon §4.8; archived-08 D1 inverted —
   Nova lives beside dakio-api).** `eve start` (Nitro schedule runner — crons fire),
   proxy forwards `/eve/` AND `/.well-known/workflow/`, durable state on
   `@workflow/world-postgres@5.0.0-beta.x` (pinned; local `.eve/.workflow-data` dies
   with the filesystem), direct `@ai-sdk/anthropic` (hyphenated ids) with gateway
   fallback config documented. Staging = production topology; quarterly drill
   rehearses world-store failover + restore.

## EVE features to use (exact surface)

- `defineInstrumentation({ setup, recordInputs: false, recordOutputs: false,
  events: { "step.started": (input) => ({ runtimeContext }) } })` — root
  `agent/instrumentation.ts`, boots before agent code; presence enables telemetry.
- `defineHook` mirrors for usage/audit events (`step.completed` usage → metering;
  `action.result` → audit mirror via `toolResultFrom`, isError results captured raw);
  hooks wrapped in try/catch (a thrown hook fails the turn — deliberate ONLY for the
  kill-path pre-check hook).
- Session `limits` backstop + `compaction` tuned (cheap-tier compaction model for long
  founder threads).
- `eve info --json` + `compiled-agent-manifest.json` diffed in CI (tool/subagent/
  schedule drift check across the 10 departments).
- Turn-cancel cascade (`POST /eve/v1/session/:id/cancel`, recursive to children) as the
  in-flight half of kill paths.

## External services

OTel collector + trace/metric backends (Grafana stack or Honeycomb); warehouse (Dakio
analytics stack); Redis (budgets/circuit breaker — first Redis in the v2 plan; budgets
fail CLOSED for actions, OPEN for reads on Redis loss); k6/artillery; pager (Slack/
PagerDuty).

## Data models

```
usage_events(at, tenant_id, surface, department, job_kind, model, tokens_in, tokens_out,
             cost_estimate_minor, session_id, turn_id)          -- warehouse
Redis: t:{store}:tokens:{yyyymmdd} · t:{store}:acts:{risk}:{yyyymmdd} · fleet:spend:1m ·
       fleet:halt (flag)
NovaBudget(tenantId PK, plan, dailyTokens, dailyActions Json, updatedAt)
-- audit: role grants migration (INSERT-only) + transition function; monthly partitions
```

## APIs & interfaces

Ops (private network + separate auth): `POST /internal/tenants/:id/pause|resume` ·
`POST /internal/fleet/halt|resume` · `GET /internal/anomalies` (Nova-watches-Nova SQL:
action-volume spikes, repeated blocked attempts, unusual discount patterns → auto-pause
thresholds) · `GET /internal/economics/tenant-day?cohort=`. Dashboards: fleet health,
job backlog, budget shedding, SLO burn, isolation canary, cost-per-tenant-day.
Weekly cost report filed to the eng channel like a morning report (Nova-for-Nova).

## Implementation steps

1. Instrumentation + runtimeContext metering + redaction policy + usage warehouse +
   economics dashboards.
2. Budgets + circuit breaker + pre-turn hook + claim-time checks (05 wiring) +
   fail-closed/open semantics under Redis loss.
3. Audit role separation + completeness state-machine test + partitions/retention.
4. `untrusted()` sweep + lint rule + provenance gating + outbound-check generalization;
   red-team corpus as CI evals; live red-team exercise (fix + re-run).
5. SSE LISTEN/NOTIFY migration + fan-out load test.
6. SLOs + alerts + runbooks + on-call + game-day (kill paths, drills: model-down off
   duty, voice-down, Redis loss, Postgres failover, gateway 429 storm, dispatcher kill
   mid-batch, webhook storm 10k/min, 100k-due-jobs backlog).
7. Grounding audit generalization + measured-basis expansion + hours-saved/brief/chat
   audit in nightly rotation.
8. Staging parity + self-host/world drill; isolation canary (two synthetic tenants
   cross-probing) permanent in prod.
9. Pilot: ≥20 stores, 30 days, halt criteria armed; weekly economics review; GA
   checklist + compliance sign-off.

## Dependencies

06–14 shipped and stable on staging. Infra accounts (OTel/Redis/warehouse/pager).
Plan-pricing inputs for margin targets. Pilot-store recruitment (≥20). Security
resource for the red-team exercise.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Policy layer latency on every action | budget/kill checks are Redis O(1) (<5ms); authority is a pure function after cached reads (07); measured in load suite |
| Redis loss stalls the fleet | actions fail CLOSED (safety), reads fail OPEN (availability); drill proves the split; budgets reconcile from usage_events on recovery |
| Red team finds structural holes late | corpus runs in CI from phase 07 onward (pulled forward); the exercise is confirmation, not discovery |
| Pilot stores churn mid-window | recruit 25+ for ≥20 completing; halt criteria distinguish store-level vs fleet-level failures |
| Cost overruns surface after GA | hard budgets cap downside during pilot; weekly margin review is a gate artifact |
| Observability leaks PII | recordInputs/Outputs false; OTel processor redaction (emails/addresses/tokens); trace-sample audit in the compliance checklist |
| LISTEN/NOTIFY payload limits | id-only payloads + re-fetch (08's SSE pattern already id-only) |

## Testing strategy

Load: chat concurrency burst (first-token p95 <3.5s), dispatcher 100k due jobs,
webhook storm (debounce holds), SSE fan-out at instance count ×3. Chaos: the §Steps-6
drill list, each with pass criteria tied to SLOs. Security: red-team corpus (CI) +
live exercise report. Audit completeness state-machine test. Grounding: nightly audit
≥99% over the pilot window. Isolation canary clean 30 days. Weekly Postgres restore
drill. All prior suites + gate harnesses (06–14) green on the production build
(`eve build && eve start`, not `eve dev`).

## Performance

SLOs (gate-bound): chat first-token p95 <3.5s · approval p95 <1s · feed/decision push
p95 ≤3s · brief on-time ±5m ≥99.5% · job success (≤5 attempts) ≥99.9% · watchdog FP
<1/store/week · cross-tenant incidents = 0 (pager, not SLO). Prompt-cache ordering
(L0/L1 first) + snapshot/anomaly/campaign caches (60s/5m/5m TTLs, `t:{store}:` keys,
busted on writes) are the cost levers; tiering target ≥60% cheap-tier job tokens.

## Security

This phase is security. Additionally: internal ops APIs on private network + separate
auth; platform guardrail bounds not editable via tenant paths (07); secrets rotation
runbook; audit writer role cannot read other stores; benchmark-raw role isolation (14)
verified in the audit; quarterly access review.

## Success & exit criteria

**PRD §15 Stage 9 gate (verbatim):** *30 days on ≥20 pilot stores: 100% receipt
coverage, zero guardrail breaches, zero founder-only executions, undo 100% in-window,
feed p95 ≤3s, watchdog false-positive <1/store/week; degradation drills pass;
grounding audit ≥99% reproducible.*
**Plus:** red-team exercise passed (zero unauthorized actions, zero cross-tenant
reads) · audit completeness 100% in the state-machine test · kill drills: tenant <5s,
fleet <30s · cost-per-tenant-day within plan margin · isolation canary clean 30 days ·
self-host drill rehearsed · on-call live · compliance checklist signed.
**§16 discipline:** the pilot itself is the demo; artifacts = pilot report + ledger
exports + drill recordings + red-team report + economics review, filed.

## Deliverables

Budgets + circuit breaker + degradation drills; hardened audit (roles/completeness/
retention); injection defenses + red-team report; OTel + metering + economics
dashboards + weekly review cadence; LISTEN/NOTIFY SSE; SLOs + alerts + runbooks +
on-call + game-day records; grounding audit fleet rotation; staging parity + drill;
rollout plan + halt criteria + pilot report; GA/compliance checklist; capability report
`phase-15-stage9-launch.md` + final capability-matrix sweep.

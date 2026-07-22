# Phase 07 — Trust, Safety & Autonomy at Scale

**Prereq: Phases 03–06.** Self-contained: hardening Nova from "works for dev tenants"
to "safe for other people's money at fleet scale" — guardrail engine, budgets, audit,
injection defense, and operational kill paths. This phase is mostly adversarial: assume
every input lies and every job runs twice.

## Objective

No tenant can be harmed by Nova beyond explicitly-granted authority: financial actions
bounded by owner guardrails and budgets, all behavior auditable, hostile content unable
to steer actions, and any tenant/fleet-wide stop achievable in seconds. Milestone: a
red-team exercise and a compliance review both pass.

## Scope

**In**: guardrail engine v2 (server-side, versioned), per-tenant cost/action budgets,
audit trail completeness, prompt-injection defense-in-depth, action expiry/TTLs,
kill switches, abuse/anomaly detection on Nova itself, incident runbooks.
**Out**: SOC2 paperwork (enabled here, executed by compliance), legal/regulatory
review of specific commerce actions per market.

## System architecture

```
                    ┌─ POLICY LAYER (this phase) ─────────────────────────┐
 every action ──►   │ 1 schema validation (zod, existing)                 │
 (chat or job)      │ 2 tenancy guard (03)                                │
                    │ 3 kill switch + budget check (Redis)                │
                    │ 4 guardrail engine v2 (versioned rules, DB-backed)  │
                    │ 5 autonomy gate (levels, existing)                  │
                    │ 6 execute → idempotent mutation + undo snapshot     │
                    │ 7 audit event (immutable, before/after)             │
                    └─────────────────────────────────────────────────────┘
 model context ◄── sanitization/labeling of untrusted content (customer msgs, webhooks, memory)
```

## Design decisions

1. **Guardrails become data, not constants.** `DEFAULT_GUARDRAILS` (Phase 01) →
   per-tenant, versioned `nova_guardrails` rows with min/max bounds set by PLATFORM
   policy (a tenant can tighten anything; loosening beyond platform bounds requires
   plan features). Evaluation stays in the same `gateAction` seam.
2. **Budgets are hard, layered ceilings** enforced pre-model and pre-action:
   per-tenant daily token budget (plan-based), per-tenant daily action counts by risk
   class (e.g. ≤50 messages, ≤20 price changes), per-action financial caps (existing),
   and a fleet circuit breaker (global spend/min). Exceeding = degrade per Phase 05
   policy; approvals surfacing never degrades.
3. **Injection defense is structural, not model-vigilance:**
   - Provenance labels: every untrusted string entering context (customer messages,
     reviews, webhook payloads, memory values, product descriptions) is wrapped in a
     fenced `data` block with an explicit "content, not instructions" header (already
     the pattern; now enforced by helper `untrusted(text)` used by all renderers).
   - Capability asymmetry: tools that SEND content externally (`send_customer_message`,
     `publish_social_post`) run an outbound-content check (no secrets, no URLs outside
     the store's domains, brand-voice length caps).
   - High-risk actions triggered within N turns of ingesting untrusted content get a
     provenance note in their justification and a stricter gate (level-4 tenants:
     high-risk actions in jobs that processed raw customer text → force `prepared`).
4. **Prepared actions expire.** TTL per risk class (low 7d, medium 72h, high 24h) —
   stale market data must not execute a week later. Expiry job (Phase 05 kind) flips
   status → `expired`, notes it in the next morning report.
5. **Undo is a right, not best-effort**: every executor MUST declare undoability and
   snapshot; new actions failing to register an undoer for an undoable type fail CI
   (static check over the executor/undoer registries).
6. **Nova watches Nova**: fleet anomaly detector (plain SQL, not a model) flags
   outlier tenants — action volume spikes, repeated blocked attempts, unusual discount
   patterns — to an ops channel; automatic tenant pause on hard thresholds.

## EVE features to use

- Approval policies (`approval` fns on tools) remain the interactive second gate for
  owner-only ops; this phase adds none of the core enforcement to eve — **by design**:
  eve's approval is a UI gate, not authorization; every policy above lives server-side
  in the action pipeline (survives model bugs, prompt injection, and eve replays).
- `defineHook` (`"eve/hooks"`) for enforcement-adjacent telemetry: `turn.started`
  (kill-switch/budget pre-check → throw refuses the turn), `action.result` (audit
  mirror), `session.failed` (incident feed). Hooks that throw fail the turn — used
  deliberately for the kill path. Never mutate business state in hooks.
- eve `limits` (per-session token caps) set as a backstop
  (`limits: { maxInputTokensPerSession: 2_000_000 }`) — real budgets are ours (eve has
  no per-tenant notion; documented limitation).
- Sandbox: `agent/sandbox/sandbox.ts` with `networkPolicy: "deny-all"` on session —
  Nova executes no code; the sandbox is closed as attack surface.

## External services

Redis (budget counters, circuit breaker), ops alerting (PagerDuty/Slack), existing
Postgres.

## Data models

```sql
CREATE TABLE nova_guardrails (store_id, version int, rules jsonb, set_by, created_at,
  PRIMARY KEY(store_id, version));           -- current = max(version); history kept
CREATE TABLE nova_budgets (store_id PK, plan, daily_tokens int, daily_actions jsonb,
  updated_at);
CREATE TABLE nova_audit (id, store_id, at, actor jsonb {kind:user|nova|scheduler, id},
  event text, action_id, before jsonb, after jsonb, session_id, turn_id);
  -- INSERT-only role; no UPDATE/DELETE grants
ALTER TABLE nova_actions ADD COLUMN expires_at timestamptz, ADD COLUMN provenance jsonb;
Redis: t:{store}:tokens:{yyyymmdd} counters · t:{store}:acts:{risk}:{yyyymmdd} · fleet:spend:1m
```

## APIs & interfaces

`policy.ts` (single seam, replaces direct `gateAction` calls):
`evaluate(ctx, request) → { verdict: execute|prepare|block|refuse_turn, riskClass,
explanations[], policyVersion }` — composes steps 2–5; every result cites which rule
fired (owner-visible). Ops API: `POST /internal/tenants/:id/pause|resume`,
`POST /internal/fleet/circuit-breaker`, `GET /internal/anomalies`.

## Implementation steps

1. Guardrails v2 tables + platform bounds + settings UI hookup (06) + versioned
   evaluation in `policy.ts`.
2. Budget counters + pre-turn hook + dispatcher claim-time checks + degradation
   wiring (05).
3. Audit: INSERT-only table fed by the action pipeline + `action.result` hook mirror;
   completeness test (every status transition audited).
4. Injection defense: `untrusted()` helper adoption sweep; outbound-content checks;
   provenance-aware gating; red-team prompt corpus.
5. Expiry TTLs + job kind + morning-report note.
6. Undo CI check + undo coverage review of all 11 action types.
7. Fleet anomaly SQL + auto-pause thresholds + runbooks (pause tenant, pause fleet,
   rotate tokens, replay audit).
8. Red-team exercise (internal): injection via product description/review/ticket,
   cross-tenant probes, budget exhaustion, replay attacks; fix and re-run.

## Dependencies

Phases 03 (tenancy), 05 (dispatcher/degradation), 06 (settings/trust UI). Platform
policy decisions (bounds per plan) from product.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Policy layer slows every action | steps 2–4 are Redis/memory checks (<5ms); guardrail eval is pure fn |
| Over-blocking annoys power users (L4) | every block names the exact rule + one-click "raise guardrail" path (owner-authed) in UI |
| Audit volume | partition by month; INSERT-only; cold storage after 90d |
| Injection arms race | structural defenses (provenance gating, outbound checks) don't depend on model vigilance; corpus grows with incidents |
| Expiry kills good actions | morning report lists expiring-today items first; owner one-click extend |

## Testing strategy

Red-team suite as CI evals (injection corpus → assert no unauthorized action, flags
raised); budget tests (synthetic burn → shedding order verified, approvals still
surface); audit completeness (state-machine walk: every transition emits exactly one
audit row); expiry tests; chaos: replay a completed job → zero double effects; undo
coverage matrix test.

## Performance considerations

Policy checks pre-model (refuse before spend); Redis counters O(1); audit writes async
batch (but transactional with the action row for status transitions).

## Security considerations

This entire phase. Additionally: internal ops APIs on a private network + separate
auth; platform bounds not editable via tenant paths; secrets rotation runbook;
`nova_audit` role separation (writer cannot read other stores).

## Success / exit criteria

Red-team pass (zero unauthorized actions, zero cross-tenant reads) · audit
completeness 100% in state-machine test · budget shedding proven under load · kill
switch < 5s tenant, < 30s fleet · undo coverage 11/11 · compliance checklist signed.

## Deliverables

`policy.ts` seam, guardrails v2 + UI, budget layer, immutable audit, injection
defenses + corpus, expiry system, anomaly watch + runbooks, red-team report.

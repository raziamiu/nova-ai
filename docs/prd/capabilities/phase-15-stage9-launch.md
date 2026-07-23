# Phase 15 — Stage 9: Launch hardening · capability report

- **Status:** **security-critical hardening cores built + verified (incl. a live
  red-team pass); the infra + 30-day pilot are honest remainder.** Budgets +
  degradation shed-order, the `untrusted()` injection framing + red-team corpus,
  the kill-path fail-closed/open split, and the grounding audit are done and
  tested; the model does not act on an injected instruction (live). Redis, OTel,
  LISTEN/NOTIFY, dashboards, and the ≥20-store/30-day pilot need infra + time.
- **Branch / commits:** `develop` — nova-ai `df87df5` (hardening core + live red-team)
- **Date:** 2026-07-23 · **Blueprint:** `docs/blueprint/15-stage9-launch.md`

## Gate

| Check | Result |
|---|---|
| full nova-ai gate | ✅ **all suites green** incl. launch 20, team 20, presence 19 (EXIT 0) |
| budget shed-order (eval) | ✅ hard ceilings; decision surfacing is never sheddable (invariant) |
| injection defense (eval + live) | ✅ untrusted() frames + strips fence-spoofing; 6-vector corpus; **live: an injected customer quote does NOT make Nova act (2/2 real model)** |
| kill path (eval) | ✅ actions fail closed / reads fail open on Redis loss; halt pauses actions, keeps reads |
| grounding audit (eval) | ✅ measured mismatch fails, estimated exempt-but-flagged, fleet ≥99% score computes |

**PRD gate — hardening logic met; the pilot IS the gate.** §15 Stage 9 is a
30-day run on ≥20 pilot stores hitting every SLO (100% receipt coverage, zero
breaches, undo 100% in-window, feed p95 ≤3s, watchdog FP <1/store/wk, grounding
≥99%) plus drills + red-team + privacy + economics. The **safety logic** those
SLOs rest on is built + verified here, and the injection defense passes live. The
pilot itself, the infra (Redis budgets, OTel metering, LISTEN/NOTIFY fan-out,
dashboards, on-call), and the drills/audits are **H-21** — none autonomously
completable.

## New capabilities this phase

- **Budget ceilings + degradation ladder (tested).** Per-tenant token + per-risk
  action caps; shed cheapest-first; **decision surfacing never sheds** (hard
  invariant).
- **Injection defense (tested + live).** `untrusted()` wraps every external
  string as fenced data, names provenance, strips fence-spoofing; a red-team
  corpus covers the 6 vectors; the live model refuses to act on an injected quote.
- **Kill path (tested).** Fail-closed for actions / fail-open for reads on budget-
  store loss; fleet halt pauses actions, preserves reads.
- **Grounding audit (tested).** Re-derive + diff a claimed figure; measured
  mismatch fails, estimated basis exempt-but-flagged; fleet ≥99% score.

## Known limitations / not yet (H-21)

- **No Redis / real budget counters.** The ceiling + shed logic is tested; the
  Redis-backed daily counters + fleet circuit breaker + pre-turn hook are infra.
- **No OTel / metering / economics dashboards.** `defineInstrumentation` +
  usage-event warehouse + cost-per-tenant-day review are the observability build.
- **`untrusted()` not yet swept across all renderers.** The helper + corpus exist;
  the lint-enforced adoption sweep + provenance gating are the integration.
- **SSE is still in-process.** LISTEN/NOTIFY fan-out for multi-instance is pending.
- **Audit role separation, retention, kill drills, self-host drill, the ≥20-store
  30-day pilot, red-team exercise, privacy audit, compliance sign-off** — all
  need infra, external resources, and time.

## Matrix updates

Stage 9 / Phase 15 → hardening cores built + verified (launch 20 + live red-team);
infra + pilot + drills are the H-21 remainder. This completes the deterministic
build across all 10 blueprint phases (Stages 0–9).

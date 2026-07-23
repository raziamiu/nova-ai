# Phase 12 — Stage 6: Reach · capability report

- **Status:** **doors shipped, zero NEEDS DOOR — the stage-exit criterion is met.**
  The four analytics doors, Broadcasts (with the consent/opt-out prerequisite),
  Research, Growth, and Goals are live and wired to deterministic, tested logic.
  Honest remainders (real send provider, night-shift authoring of the new draft
  types, full furniture rollout, memory UI) are listed below.
- **Branch / commits:** `develop` — nova-ai `d2b6091` (math floor) · `9b222cc`
  (research scoring) · `3c2a906` (zero NEEDS DOOR); dakio-api `fe00ff1` (trust
  logic) · `9135250` (Reach doors) · `90e51d0` (agent-data filing + seed);
  dakio-merchant `04948c6` (Reach page)
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/12-stage6-reach.md`

## Gate

| Check | Result |
|---|---|
| `tsc` (nova-ai) + merchant build | ✅ clean |
| nova-ai suites | + **reach 20** + **research 11**; duties **39** (zero NEEDS DOOR) — green |
| dakio-api hermetic | ✅ **760 pass / 0 fail** (+ novaReachMath 6, novaBroadcast 9) |
| **zero NEEDS DOOR** | ✅ `export-duty-seed` → **65/65 doored, 0 awaiting**; all 65 ACTIVE at L4 |
| Reach doors (live) | ✅ segments live-count, broadcast prepare/send, research, growth, goals, 4 sub-view doors, badges — all 200 |
| consent gate (live) | ✅ recovery broadcast 6 eligible; campaign 0 (marketing consent required); opt-out absolute |
| Reach page (CDP) | ✅ /nova/reach renders P&L / Rate / RTO / RFQ / Goals / Research with live data |
| Nova→founder (live) | ✅ agent-data filing → merchant badges show research/broadcast counts |

**PRD gate — substantially met.** §15 Stage 6: *per door, duties flip ACTIVE,
night-shift outputs land as inspectable drafts, the founder completes one manual
job; stage exits at zero NEEDS DOOR.* Zero NEEDS DOOR is **met and verified**;
every door has a real surface and the founder-manual path (compose broadcast,
set goal, create experiment, shortlist research) is live. The one honest gap vs
"night-shift outputs land as drafts" is that the night shift doesn't yet CALL the
new filing endpoints (they exist + are smoked; wiring `runNightShift` to author a
research candidate / goal / broadcast is the remaining nova-ai step).

## New capabilities this phase

- **Deterministic math + trust floor (tested).** Experiment significance
  (two-proportion + sample floor) + ICE; goal pace + trailing-run-rate projection
  with honest confidence bands; research scoring (transparent weights, honest n/a
  renormalization); broadcast trust logic (opt-out absolute, consent baseline,
  segment AST, recipient dedupe — fails closed). Ported to JS API-side so doors
  and agent never disagree.
- **CustomerChannel registry (E-13 prerequisite).** Backfilled from orders
  (phone/email = transactional consent), opt-out + marketing-consent grant.
  Sends only ever target these verified rows.
- **Broadcast Center.** Compose (founder job) → prepare (opt-out/consent-filtered,
  idempotent recipients) → send is HONEST (no provider → "prepared, not sent",
  never a faked delivery). Decision-gating slot present.
- **Segments** with live counts over a Customer+Order projection.
- **Research Hub / Growth Lab / Goals** doors, wired to the tested logic
  (score/significance/pace), with founder verbs (shortlist/import, experiment
  tick, set goal / risk register).
- **Four sub-view doors** — Rate Compare, RTO Analytics, P&L (30d, basis-labeled),
  RFQ Compare — as live read-model aggregates, on the merchant Reach page.
- **Zero NEEDS DOOR.** All 65 duties doored; the duty registry's honesty
  mechanism now reports zero unbuilt doors.

## Known limitations / not yet

- **No real SMS/email send provider wired to broadcasts.** `send` is honestly
  "prepared, not sent" until a sender is connected (same discipline as organic-FB
  publish). The `broadcast_send` scheduled job + provider adapter are the follow-up.
- **Night shift doesn't yet author the new draft types.** The filing endpoints
  exist + are smoked; `runNightShift` extension (research candidate + goal update
  + broadcast draft) is a small nova-ai step.
- **Furniture is partial.** The Reach doors have surfaces + badges; the full
  FR-6.5 matrix (+ Create / mode banner / toast on every one of the 16 doors) and
  the memory transparency UI are not yet swept.
- **Door aggregates are live-computed, not the nightly `CourierPerfDaily` job.**
  The model + live aggregation exist; the idempotent nightly job that fills the
  derived table is deferred (live aggregation covers the door today).

## Matrix updates

Stage 6 / Phase 12 → doors shipped, zero NEEDS DOOR (stage-exit met); send
provider + night-shift authoring + furniture sweep are the honest remainder.

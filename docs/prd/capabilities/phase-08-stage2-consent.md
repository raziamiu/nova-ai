# Phase 08 — Stage 2: Consent · capability report

- **Status:** engineering complete; **the PRD §15 Stage 2 gate is NOT signed off** (needs a non-builder staging demo — H-11)
- **Branch / commit:** `develop` @ `c4e4233` (nova-ai) · `develop` @ `cc5adee` (dakio-api) · `develop` @ `70e05d0` (dakio-merchant)
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/08-stage2-consent.md`

> Stage 0 made every write explain itself; Stage 1 made it ask permission.
> Stage 2 makes the asking a real thing a founder can answer — **one Decision
> record, rendered everywhere, answered once.** Before this the merchant desk
> was a localStorage mock: per-browser, so approving on a laptop left the card
> on the phone, and local-only, so the ledger never learned what was decided.
> Now the desk shows real decisions from the ledger, approving in the browser
> writes to the server, and an empty desk finally means the desk is empty.

## Gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx eve build` · `eve info` | ✅ clean · 0 errors, 0 warnings |
| nova-ai suites | isolation **44** · memory **40** · jobs **39** · spine **33** · duties **39** · authority **66** · decisions **34** |
| §16.3 completeness | undo coverage **12/12** · duty mirror in sync |
| dakio-api hermetic | ✅ **0 failures** |
| dakio-api integration | decisions **18** · authority **8** · receipts **8** · growService **9** · dashboard **6** |
| Browser | ✅ Approve clicked in the UI moved the server queue 5 → 4, `decidedBy` stamped, 0 page errors |

**PRD gate — NOT met.** §15 Stage 2 wants one decision visible on desk + room +
module, approved on the desk, flipping the plan item and logging the feed, with
Later requeueing and a lock freezing it — run by a non-builder on a clean
staging store. The behaviours exist and are tested; the scripted demo is
outstanding (**H-11**).

## New capabilities this phase

- **`NovaDecision` (E-9)** — the asking, split from the action. One record per
  action (unique index), rendered on desk / room / door via `surfacedIn`.
- **Authoring** — `agent/lib/nova/decisions.ts` derives a scannable card from
  the receipt. Nothing invented: an unquantified impact reads "Impact not
  quantified"; an unknown verb yields an empty params line.
- **Approve / Later / Reject** — every verb a *conditional* update, so a second
  approve gets a 409 with the current state rather than executing twice.
- **Later is a deferral** — back of the queue, still approvable.
- **Reject carries the reason onto the action**, so it lands in the ledger
  export where an auditor already looks.
- **Freeze reaches backwards** — adding a no-touch lock freezes matching
  *waiting* decisions and records which lock; lifting it thaws them unless
  another lock still catches them.
- **Expiry** — stale asks expire by risk class (24h high / 72h medium / 168h
  low). Lock-frozen cards are exempt.
- **Hire (FR-1)** — server truth, not a browser flag. Cautious seeds (L3,
  ৳5,000/day, 15%, assisted), idempotent and non-destructive on re-hire.
- **Trust meter v1 (§11)** — computed from the ledger, with its inputs
  persisted so the founder can redo the maths. Eligibility ≠ promotion.
- **The merchant desk is real** — `useNovaDecisions`, optimistic with 409
  reconcile; the fixtures no longer reach it.

### Two real bugs found and fixed

- **Bangla no-touch locks matched nothing.** The matcher normalized away
  everything outside `\p{L}\p{N}`, but Bangla matras and nuktas are combining
  MARKS. `"শাড়ির দাম"` became `"শ ড র দ ম"` — shredded into single letters,
  every token then dropped as noise. A founder writing a lock in Bangla got
  **zero protection, silently**; English locks worked, which is why it hid.
  Fixed in both repos, with a shared 14-row vector corpus (`novaLockVectors.json`)
  that both implementations run — the anti-drift device for a matcher that has
  to exist twice.
- **The decision backfill dropped frozen work.** The first version selected
  only `prepared` actions, so anything a lock had frozen would have got no
  decision at all — the founder's most deliberate work, gone in the upgrade.
  Caught by writing the verification before trusting the migration; fixed in
  place, since it had never left the local machine.

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| E-9 Decision | ⬜ | ✅ done | Model, lifecycle, fan-out, queue semantics |
| §5 Decision lifecycle | ⬜ | ✅ done | queued → approved / later / rejected / frozen / expired |
| FR-1 Hire ritual | 🟡 localStorage mock | ✅ done | Server state, cautious seeds, idempotent |
| §11 Trust | ⬜ | 🟡 partial | Meter + inputs real; **formula is a placeholder (§18)** |
| FR-3 Promotion offer | ⬜ | 🟡 partial | Eligibility computed; the offer card lands with the vertical |
| §5.3 Freeze on lock | 🟡 actions only | ✅ done | Retargeted onto decisions, both directions |
| §14 push ≤3s | ✅ activity | ✅ decisions | `decision.created|updated` on the same bus |
| §15 Stage 2 gate | ⬜ | 🟡 **awaiting demo** | H-11 |

## Scenario walkthroughs

### Scenario 1 — "I already approved that on my phone"

A founder has the desk open on a laptop and the department room on a phone, and
taps Approve on both. The first request's conditional update matches and
executes; the second matches zero rows and returns 409 with `status: "approved"`.
The laptop doesn't restore the card or show a scary error — the decision *was*
made, just elsewhere, so it refetches and both surfaces settle on the same
truth. Asking the founder the same question twice would be worse than a moment
of uncertainty.

### Scenario 2 — "Never touch saree pricing" (said after the fact)

Nova has already prepared a saree reprice; it is sitting on the desk. The
founder then adds the lock. Before this phase, the lock stopped *new* work while
the existing card stayed tappable — so they could approve the very thing they
had just forbidden. Now adding the lock sweeps waiting decisions, freezes the
matching one, and records `frozenByLock: "SAREE PRICING"` so the card can say
which instruction is holding it. Lift the lock and it returns to the queue —
unless another lock also catches it, in which case it stays frozen and renames
its captor.

### Scenario 3 — "How much do I trust this thing?"

`GET /api/nova/trust` returns a score **and the counts it came from**. With
fewer than five decided items it returns `null` and says why, rather than a
flattering number off a thin sample. Undos weigh heaviest (Nova acted and was
reversed), rejections next, and refusals count for nothing at all — penalising
Nova for declining inside its own limits would push it toward recklessness to
protect its score. Crossing the threshold makes Nova *eligible to ask*; raising
the ceiling stays a founder-only act.

## Known limitations / not yet

- **Approve does not execute yet.** It marks the decision and returns
  `executed: false` with a note. The executors live agent-side; wiring them
  through the approve transaction is phase 09. Reporting work as done when
  nothing ran is the exact failure this system exists to prevent, so it says so.
- **Trust's formula is a placeholder** (§18 open product decision), isolated in
  one pure function so replacing it is a one-function change.
- **No promotion-offer card yet.** Eligibility is computed; authoring the
  `promotion_accept` decision lands with the vertical.
- **The room and door surfaces are stubs.** `surfacedIn` is populated and the
  desk is real; rendering decisions inside each department room and door module
  is phase 09's room anatomy.
- **SSE frames are emitted but the merchant doesn't consume `decision.*` yet** —
  the desk refetches instead. Fine at this scale, but it is polling-shaped.
- **`decQueue`/`appr` mock state still exists in NovaContext** for the playbook
  and negotiation demos, which have no backend. They no longer reach the desk.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Stage 2 / Phase 08 build-status
row; E-9 Decision; FR-1 hire; §11 trust; §5.3 freeze.

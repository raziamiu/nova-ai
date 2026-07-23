# Phase 09 — Stage 3: Proof · capability report

- **Status:** engineering complete; the **full Stage 3 loop is machine-verified**
  end-to-end on the live backend (`scripts/stage3-gate.ts` — 10/10). **The PRD
  §15 Stage 3 gate is NOT signed off** — it wants a *non-builder* running it on
  **two** clean staging stores (H-16).
- **Branch / commits:** `develop` — dakio-api `a2d32bb`·`d46c02a`·`d8279eb`·`b3fa285`·`a7bfcae`, nova-ai `164e474`
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/09-stage3-proof.md` (+ `grow-lab-reconciliation.md`)

> Stage 0 made every write explain itself; Stage 1 made it ask permission;
> Stage 2 made the asking a real thing to answer. Stage 3 is the whole machine
> turning **unattended**: overnight Nova grades every department, files a scale
> decision into the morning brief, the founder taps approve, a campaign goes
> live in the door with a receipt, the plan item flips to done — and undo
> reverses it. "We don't call Nova working until this passes." It passes.

## Gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` (nova-ai) | ✅ clean |
| `npx eve build` | ✅ built, 0 diagnostics |
| nova-ai suites | isolation · memory · jobs · spine · duties · authority · decisions · **night 13** — all green |
| dakio-api hermetic | ✅ **737 pass / 0 fail / 1 win-skip** (executors **14** + brief **6** new) |
| **`stage3-gate.ts` (live loop)** | ✅ **10/10** — night shift → decision → approve → live campaign → plan flip → brief tiles → undo |

**PRD gate — NOT met.** §15 Stage 3 wants the loop run **twice on two stores by
a non-builder**, with recordings + ledger exports filed. The behaviours exist,
are tested, and the gate script asserts them on the live path; the two-store
non-builder demo is outstanding (**H-16**). A second staging tenant
(`NOVA_GATE_TENANT_2`) turns the isolation assertion on.

## New capabilities this phase

- **Approve executes (09-A).** Approving a decision runs its linked action
  through a typed executor, logs the `NovaActivity` that feeds the live feed
  (`activity.created` on the SSE bus the merchant already consumes), and arms a
  24h undo. Three honest outcomes only: a real executor ran · a recognized
  advisory verb was acknowledged (no fabricated door write) · an unmapped verb
  reports `executed:false`. Never claims work that didn't happen (§16.2).
- **The grow vertical (09-B).** `create_grow_campaign` lands a real GrowCampaign
  in the Campaigns door; `publish_grow_post` attempts a **real organic Facebook
  Page publish** — the Stage 3 live mutation — and is honest when no Page is
  connected (status stays Scheduled, "prepared, connect a Page", never a faked
  send). Both `createdBy:'nova'` + `novaActionId` so the by:nova chip links the
  receipt.
- **Undo (09-C).** `POST /nova/actions/:id/undo` reverses within 24h: delete the
  coupon/campaign, **Graph-delete** the Facebook post (engineered inverse) then
  the row. Fails closed with a reason (window closed / not reversible / already
  undone), never a silent no-op.
- **Rooms (09-E).** `NovaDepartment`/`NovaScoreMetric`/`NovaPlanItem` — a
  department's grade with the three metrics it was computed from, and the plan
  board. `GET /nova/rooms/:dept` composes them with the dept's action history;
  a room with no grade says `graded:false` rather than inventing one.
- **The plan flip (09-E).** Approving a decision flips its `WAITING_ON_YOU` plan
  item → `DONE` (or `IN_PROGRESS`) inside the approve handler — the gate's
  "flips the plan item", now real.
- **The morning brief (09-F).** `assembleBrief` builds tiles from **real rows
  only** — 0 orders → no orders tile; every figure carries a `basis` and a
  reproducible `evidenceQuery`. Nova writes the narrative, never the numbers
  (tiles are computed server-side when a brief is filed).
- **The night shift (09-D).** `runNightShift(store)` reads the store's live
  signals, grades departments deterministically, fills the plan board, authors
  the scale decision, and files the brief — all through the StoreClient, so it
  lands in the same ledger/rooms/brief the founder reads. Deterministic core: a
  3am model hiccup cannot fabricate a grade or invent a decision.

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| §15 Stage 3 gate | ⬜ | 🟡 **loop verified, awaiting 2-store demo** | `stage3-gate.ts` 10/10; H-16 |
| §16.3 Undo | 🟡 agent-side | ✅ founder-facing | 24h window, Graph inverse, fails closed |
| E-8 execution | 🟡 marked only | ✅ executes | typed executors + activity + attribution |
| E-4/E-6/E-7 rooms | ⬜ | ✅ done | grade + metrics + plan board + room API |
| E-16 Brief | ⬜ | ✅ done | assembled from rows, tiles carry evidence |
| §9 Night shift | 🟡 markdown reports | ✅ typed outputs | grades/plan/decision/brief authored |
| §13 Campaign optimization | 🟡 read-only | 🟡 organic-live | GrowCampaign door write + organic FB publish |

## Scenario walkthroughs

### Scenario 1 — "I woke up and Nova had done the thinking"

Overnight the night shift graded Marketing a **C** (one live campaign, thin
activity) off three real metrics, and left one thing on the desk: *scale the Eid
collection into a Facebook campaign*, with a receipt citing the collection's
prior organic reach. The founder reads the brief — narrative plus five tiles,
each linking the query behind its number — taps **Approve**, and the campaign is
live in the Campaigns door with a by:nova receipt. The plan board item that said
*waiting on you* now says **done**. None of it needed an engineer after "run
night shift".

### Scenario 2 — "Actually, hold off on that"

Same campaign, but the founder changes their mind an hour later. The receipt
drawer says *reversible until…*; they tap undo. If a Facebook Page were
connected, the post would be deleted from the Page (Graph inverse), not just
from Dakio. The 24h window is enforced server-side: past it, undo returns a
plain "the window has closed" rather than pretending.

### Scenario 3 — "Nova published, right?" — no, and it says so

On a store with **no connected Facebook Page**, approving a publish decision
still creates the post in Content Studio, but the outcome reads *"prepared —
connect a Facebook Page to publish it"* and the activity is `post_prepared`, not
`post_published`. Reporting a send the product can't make is the exact failure
this system exists to prevent, so it doesn't.

## Known limitations / not yet

- **The night shift is a deterministic core.** The blueprint's eve-subagent
  typed fan-out (9 departments, model narrative per room) is a refinement on top;
  today grades/metrics/decision are computed, and the CEO-narrative is a
  template. Honest and testable now; richer later.
- **The eve dispatcher can't trigger it yet** — `eve dev`/schedule-dispatch is
  broken by the eve 0.25.2 dev-host bug (**H-13**); `runNightShift` is invoked
  directly (and by `stage3-gate.ts`). Wiring it to the `night_ops` job kind
  awaits that fix.
- **Merchant UI wiring is pending (09-G).** Rooms, the brief modal, and the
  campaign Nova-lane still render the old mock veins; the real APIs
  (`/nova/rooms/:dept`, `/nova/brief`) are live and ready to consume.
- **Two-store isolation is asserted, not yet demoed** — the gate runs a second
  tenant when `NOVA_GATE_TENANT_2` is set; a clean second staging store + a
  non-builder run is H-16.
- **Attribution v1 (roas/revenue per campaign) is not built** — the reconciliation
  flags per-order campaign attribution as still-needed; brief revenue is
  store-wide and honestly `estimated`.
- **Paid ads stay `ads_read`** (H-5) — the Stage 3 live mutation is organic FB,
  which is real; paid-ads write is a separate app-review decision.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Stage 3 / Phase 09 build-status;
E-8 execution; §16.3 undo; E-4/E-6/E-7 rooms; E-16 brief; §9 night shift;
§13 campaign optimization.

# Nova PRD & capability tracking

This folder keeps the **product vision** and the **implementation reality** side
by side, so at any commit you can see how much of Nova is actually real.

| File | What it is | Changes |
|---|---|---|
| `nova-prd.md` | The product north star — what Nova should become. | Rarely (vision shifts). |
| `capability-matrix.md` | Master table: every PRD capability → status → phase → evidence. | Every phase. |
| `capabilities/phase-NN-<slug>.md` | One report per phase: new capabilities + scenario walkthroughs. | One new file per phase. |
| `capabilities/TEMPLATE.md` | The format each phase report copies. | Rarely. |

## Status legend

- ✅ **done** — a concrete tool/function/test implements it; anchored to a file.
- 🟡 **partial** — works but constrained: demo backend (not live Dakio),
  model-reasoned via instructions (no dedicated tool), single-tenant/dev-only,
  or backend-only (no UI yet).
- ⬜ **planned** — not yet; the phase that will deliver it is named.

## The per-phase ritual

See `AGENTS.md` → "Capability tracking". In short, at the end of each phase:
pass the gate → audit PRD vs code (ground every claim) → write the phase report
→ update the matrix → commit with the phase work.

## Honesty rule

Never mark a capability ✅ that the code can't back up. A tool that stores a
caption is not "generates creatives"; a schedule that only fires in dev is not a
live per-tenant loop; anything that needs real Dakio data or a dashboard UI is
not done until those phases land. The matrix is only useful if it's true.

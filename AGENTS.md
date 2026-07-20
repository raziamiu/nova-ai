# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use https://eve.dev/docs as a fallback.

## What Nova is

Nova is Dakio's **AI Business Operator** — one proactive digital employee per
commerce store. The product vision lives in `docs/prd/nova-prd.md`; the phased
engineering plan in `docs/blueprint/`. Read the PRD to understand the north
star, the blueprint for how each phase gets there.

## Capability tracking (do this at the end of every phase)

The PRD is the promise; the code is the reality. `docs/prd/` keeps them honest:

- `docs/prd/nova-prd.md` — the vision (north star; changes rarely).
- `docs/prd/capability-matrix.md` — the master table: every PRD capability →
  status (✅ done / 🟡 partial / ⬜ planned) → phase → evidence (file/tool/test).
- `docs/prd/capabilities/phase-NN-*.md` — one report per phase: new
  capabilities, PRD sections advanced, and concrete scenario walkthroughs.
- `docs/prd/capabilities/TEMPLATE.md` — the report format to copy.

**When you finish a phase**, before calling it done:

1. Pass the phase gate (tsc, `eve build`, `eve info` 0 diagnostics, the phase's
   test suite, prior suites still green).
2. Audit the PRD against the code — ground every capability claim in a real
   file/tool/test; never mark something "done" the code can't back up.
3. Write `docs/prd/capabilities/phase-NN-<slug>.md` from the template, with 2–3
   scenario walkthroughs a founder would recognize.
4. Update `docs/prd/capability-matrix.md` rows the phase moved.
5. Commit the docs alongside the phase work.

The goal: at any commit, a reader can see exactly how much of the Nova vision is
real, what each phase added, and what a founder can actually do today.

# Phase NN — <Phase Name> · capability report

- **Status:** <shipped / in progress>
- **Branch / commit:** `<branch>` @ `<sha>`
- **Date:** <YYYY-MM-DD>
- **Blueprint:** `docs/blueprint/NN-<slug>.md`

> One-paragraph summary: what this phase makes Nova able to do that it couldn't
> before, in founder terms.

## Gate (all must be green)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ / ❌ |
| `npx eve build` | ✅ / ❌ |
| `npx eve info` diagnostics | 0 errors, 0 warnings |
| This phase's test suite | `<suite>` — N checks |
| Prior suites still green | `<suites>` — N checks |

## New capabilities this phase

Each line: capability → evidence (real file/tool/test) → any caveat.

- **<capability>** — `<file/tool>` — <caveat, if any>
- …

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| <section> | 🟡 partial | ✅ done | <what moved> |

## Scenario walkthroughs

2–3 concrete, end-to-end scenarios a founder would recognize, grounded in the
real tools/data. Show the mechanism (which tools/memory/schedule), not just the
outcome. Where the vision still outstrips the code, add a one-line
today-vs-vision contrast.

### Scenario 1 — <title>
<walkthrough>

### Scenario 2 — <title>
<walkthrough>

## Known limitations / not yet

- <honest limitation> → arrives in <Phase M>

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: <list or "see matrix">.

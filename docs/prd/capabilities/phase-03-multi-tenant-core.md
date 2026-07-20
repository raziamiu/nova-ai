# Phase 03 — Multi-Tenant Core · capability report

- **Status:** shipped
- **Branch / commit:** `claude/nova-phase-4-memory-avdxb6` @ `8482e4c` (feature) + `93279f9` (adversarial hardening)
- **Date:** 2026-07-20
- **Blueprint:** `docs/blueprint/03-multi-tenant-core.md`

> Phase 1 gave Nova one store. Phase 3 makes **one deployment serve many
> stores, each as its own dedicated employee, with zero data leakage** — the
> foundation of the PRD's "every Dakio store gets one employee from day one."
> Which store a session belongs to is decided **only from a verified Dakio JWT**,
> never from anything the model can be tricked into saying. Each store's "brain"
> (identity, live ops, relevant memory, current dashboard page) is assembled at
> runtime by a token-budgeted context engine from data — there is not a single
> per-tenant prompt or code file on disk. Founder-facing: *Nova is your store's
> employee, and it cannot see or touch anyone else's business.*

## Gate (all must be green)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ⏸ not re-run this session — `node_modules` absent; green at commit `93279f9` per phase discipline |
| `npx eve build` | ⏸ not re-run this session |
| `npx eve info` diagnostics | ⏸ not re-run this session |
| This phase's test suite | `evals/isolation/run.ts` — 42 checks across 9 groups, two seeded tenants in one process (`npx -y tsx evals/isolation/run.ts`) |
| Prior suites still green | `evals/nova/*.eval.ts` (Phase 1) — group [9] re-runs snapshot/anomaly for one tenant |

> **Honesty note.** Gate not executed this session (deps not installed);
> findings are a static code audit. Treat ⏸ as "not verified now," not ✅.

## New capabilities this phase

- **Tenancy from verified auth, never model input** — `agent/lib/auth/dakio-jwt.ts:92-139`
  verifies the JWT signature via `node:crypto`; `agent/lib/tenant.ts` (`requireStore`)
  reads `storeId` only from `ctx.session.auth.current ?? initiator`, never a tool
  argument. Proven: `evals/isolation/run.ts` [3] forges `{storeId: BEACON}` into
  tool input and the read still returns only Aurora data.
- **Tenant-scoped StoreClient — no ambient access** — `agent/lib/store/resolve.ts`
  (`storeFor`) returns a per-store client from a keyed map; the old ambient
  `getStoreClient()` is gone. All 40 tools route through `requireStore` + `storeFor`.
  — *Caveat: enforced by convention (every tool calls the guard), not a type that
  makes an unscoped read impossible; no lint rule enforces it yet.*
- **Dynamic context engine (L1–L4), token-budgeted** — `agent/lib/context/layers.ts`:
  `buildTenantProfile` (L1), `buildLiveOps` (L2), `buildRelevantMemory` (L3);
  `agent/lib/context/client-context.ts` (L4 page context). Wired as dynamic
  instructions: `10-tenant-profile.ts` (`session.started`, cached), `20-live-ops.ts`
  and `30-memory.ts` (`turn.started`). Each layer clamps to a budget with a
  "…(more via tools)" marker. — *Caveat: token count is a `length/4` estimate,
  not a real tokenizer; L3 semantic tier is Phase-04 work already present here.*
- **Per-tenant model tiering by plan** — `agent/agent.ts:12-23` +
  `agent/lib/tenants.ts` (`modelForPlan`): starter→`claude-haiku-4-5`,
  growth→`claude-sonnet-5`, scale→`claude-opus-4-8`, else the compiled default
  `anthropic/claude-sonnet-5`. Chosen once at `session.started` for prompt-cache
  locality. — *Caveat: plan comes from the in-memory registry; not exercised by
  the eval (no model runs).*
- **Tenant registry** — `agent/lib/tenants.ts` (`TenantRecord`: status/plan/
  vertical/voice/timezone; `getTenant`/`isTenantActive`/`setTenantStatus`). —
  *Caveat: in-process `Map` of two seeded tenants, not the `nova_tenants`
  Postgres table.*
- **No per-tenant prompts/code on disk (data-driven persona)** — one static
  `agent/instructions.md` (L0); everything else renders from the registry row +
  store memory. The second tenant (`seed-beacon.ts` + a registry row, wired via
  the `SEEDERS` map) is **data only** — no per-store markdown.
- **Tenant-guard hook — pinning + kill switch, fail-closed** —
  `agent/hooks/tenant-guard.ts` throws on `current ≠ initiator` store mismatch
  (session hijack) and on any non-active/unknown store. Proven: [4] allows an
  active turn, refuses a paused tenant, a hijacked session, and an unprovisioned
  `store-ghost`.
- **Role-gated trust plane** — `agent/lib/tenant.ts` (`isOwnerRole`,
  least-privilege default `staff`); a no-role caller is denied `approve_action` ([4]).

### What the hardening commit (`93279f9`) fixed
Four fail-open edges closed after adversarial review: (1) dev/scheduler fallback
no longer defaults to the live `store-aurora` — resolves a store only if
`NOVA_DEV_STORE_ID` is set, never for a `dakio` principal; (2) JWTs must carry
`exp` (no non-expiring tokens); (3) missing role → `staff`, not owner; (4) kill
switch fails closed on **unknown** stores, not just paused ones. Suite extended
to 42 checks. Core seam was already sound (no storeId from input, real signature
checks, no alg confusion, per-tenant cache keys).

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| Vision — "every store gets one employee" | ⬜ single store | 🟡 multi-tenant | One deployment, many stores, proven isolation — on demo backend. |
| Core Principle 2 — Context Aware | 🟡 static context | ✅ (demo data) | Runtime context engine, page-aware, budgeted. |
| Trust System — data boundary | 🟡 | ✅ (demo backend) | Tenancy from verified JWT; guard hook; role gating. |
| Autonomy / plan-based capability | ⬜ | ✅ | Per-tenant model tiering by plan. |

## Scenario walkthroughs

### Scenario 1 — Two founders, one deployment, no bleed
Aurora's owner and Beacon's owner both hit the same running Nova. Aurora's JWT
resolves `store-aurora`; every read/write goes to Aurora's client. When a
crafted Aurora request smuggles `storeId: store-beacon` into the tool payload,
`requireStore` ignores it and returns Aurora data — and an Aurora session at
autonomy 4 that names Beacon's campaign id throws (the id doesn't exist in
Aurora's store). *(Grounded: `evals/isolation/run.ts` [1][2][3].)*

### Scenario 2 — Pausing an employee actually stops it
Dakio ops flips Beacon to paused. The next Beacon turn is refused at the guard
hook before any tool runs; Aurora is unaffected. An unknown/unprovisioned store
is refused the same way (fail closed). *(Grounded: [4].)*
**Today vs vision:** status lives in the in-memory registry; production is a
Postgres column + Redis flag (Phase 8-class ops).

## Known limitations / not yet

- **Demo backend.** "Zero leakage" is proven against `DemoStore`, not a real
  multi-tenant DB with row-level security. Live data blocked on Phase 2 (deferred).
- **Registry / cache / kill-switch are in-memory** stand-ins for Postgres + Redis.
- **JWKS rotation not wired** — the RS256/ES256 public key is read from an env
  var, not fetched from a live JWKS endpoint.
- **Dev header-auth bypass** (`DAKIO_DEV_AUTH=1` in `agent/channels/eve.ts`) is a
  deliberate two-store-on-one-box affordance, off by default — a config-dependent
  trust hole if that env var ever reaches prod.
- **Isolation is convention-enforced, not type-enforced** — no lint rule blocks a
  tool from importing the raw client without `requireStore`.

## Matrix updates

Rows: "every store gets one employee," Context-Aware, Trust boundary/tenancy,
per-tenant model tiering, kill switch, role-gated trust plane, data-driven
persona. See `docs/prd/capability-matrix.md`.

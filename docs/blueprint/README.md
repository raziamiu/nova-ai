# Nova Engineering Blueprint

The master technical plan for building **Nova — the AI Business Operator for Dakio** —
on the eve framework, from foundation to production fleet.

## How to use these documents

- **`00-master-architecture.md`** is the map: components, orchestration, context,
  memory, data flow, tenancy, security, scalability, and the honest EVE capability
  verdict table. Read it once for the whole picture.
- **`01`–`08`** are self-contained phase documents. Each carries the exact EVE API
  surface, data models, and contracts it needs, so an engineer — or an AI coding
  model — can implement that phase **without loading the rest of the blueprint or the
  eve documentation**. Feed one phase doc + the repo to the implementer; that's the
  intended workflow.
- Every phase ends in a working, testable milestone gated by explicit exit criteria.
  Do not start phase N+1 with phase N red.

## Phase index

| Phase | Document | Milestone | Status |
|---|---|---|---|
| 00 | [Master architecture](./00-master-architecture.md) | — (reference) | ✅ |
| 01 | [Foundation agent core](./01-foundation-agent-core.md) | Nova operates a demo store end-to-end | ✅ shipped |
| 02 | [Dakio integration](./02-dakio-integration.md) | One real dev store via Express APIs + webhooks | 🟢 all slices shipped (2.0 foundation, 2.1 live reads, 2.2 commerce mutations, 2.3 event-driven proactivity) — marketing/support gap groups remain parked |
| 03 | [Multi-tenant core](./03-multi-tenant-core.md) | Two stores, one deployment, zero leakage | ✅ shipped |
| 04 | [Memory & learning](./04-memory-and-learning.md) | Cross-session recall + nightly reflection | ✅ shipped |
| 05 | [Proactive operations](./05-proactive-operations.md) | Per-tenant daily loop for a tenant fleet | ⬜ |
| 06 | [Dashboard experience](./06-dashboard-experience.md) | Full founder loop through the existing UI | ⬜ |
| 07 | [Trust, safety & scale](./07-trust-safety-scale.md) | Red-team + compliance pass | ⬜ |
| 08 | [Scale & production](./08-scale-observability-production.md) | Load-verified fleet, SLOs, rollout | ⬜ |

## Standing engineering rules (apply to every phase)

1. **The `StoreClient` interface is the only data path.** Tools never touch storage
   or HTTP directly.
2. **Every mutation flows through the action pipeline** (gate → executed/prepared/
   blocked → audit → undo). No side doors, including internal jobs.
3. **Tenancy comes only from verified auth** (`requireStore(ctx)`), never from model
   input.
4. **No per-tenant prompts or code on disk.** Tenant identity is data rendered by the
   context engine.
5. **Everything Nova learns is owner-visible and reversible.**
6. **Idempotency everywhere** — eve replays interrupted steps; webhooks and jobs are
   at-least-once.
7. Phase gates: `tsc --noEmit` clean · `eve build` clean · phase test suite green ·
   prior phases' suites still green.

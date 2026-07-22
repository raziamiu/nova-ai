# Nova Engineering Blueprint — v2 (Master Build)

The master technical plan for building **Nova — the AI Business Operator for Dakio** —
on the eve framework, from the shipped v1 foundation to the full
[Master Build PRD](../prd/PRD%20-%20Nova%20Master%20Build.md) (Stages 0–9, through H2).

> **v2 note.** Blueprint v1 (phases 01–08) was written against the original vision PRD
> (`docs/prd/nova-prd.md`). Phases 01–05 shipped and remain the substrate — their docs
> are kept unchanged as the record of what exists. The Master Build PRD (v2.0,
> canonical since 2026-07-22) superseded the vision doc and absorbed the UI Build and
> Feature Build PRDs; v1's unbuilt phases 06–08 were re-planned against it as phases
> 06–15, one per PRD delivery stage. The old 06/07/08 docs are archived in
> [`archive/`](./archive/) — their engineering content is absorbed into the new phases
> (mostly 15, with guardrails-v2 pulled into 07 and the undo CI check into 06).

## How to use these documents

- **`00-master-architecture.md`** is the map: the five PRD primitives and how they land
  on eve + the three repos, orchestration, context, memory, authority, data flow,
  tenancy, the corrected eve capability verdicts, and the Stage↔Phase roadmap. Read it
  once for the whole picture.
- **`01`–`05`** are the shipped v1 phases (history + the contracts everything builds on).
- **`06`–`15`** are the go-forward phase documents, one per Master Build PRD stage
  (Stage 0 → 9). Each is self-contained: exact eve API surface, data models, HTTP
  contracts — feed one phase doc + the repos to an implementer; that's the workflow.
- Every phase ends in a **scripted gate demo** (PRD §15) on a clean staging store, run
  by someone who didn't build the stage, plus the standing engineering gates. A stage
  that doesn't pass doesn't ship, and the next doesn't start.

## Phase index

| Phase | Document | PRD Stage | Milestone | Status |
|---|---|---|---|---|
| 00 | [Master architecture](./00-master-architecture.md) | — | reference (v2) | ✅ |
| 01 | [Foundation agent core](./01-foundation-agent-core.md) | — | Nova operates a demo store end-to-end | ✅ shipped |
| 02 | [Dakio integration](./02-dakio-integration.md) (+ [findings](./02-findings-live-dakio.md)) | — | One real dev store: reads, writes, events | ✅ shipped (marketing/support gap groups parked → picked up in 09/10/12) |
| 03 | [Multi-tenant core](./03-multi-tenant-core.md) | — | Two stores, one deployment, zero leakage | ✅ shipped |
| 04 | [Memory & learning](./04-memory-and-learning.md) | — | Cross-session recall + nightly reflection | ✅ shipped |
| 05 | [Proactive operations](./05-proactive-operations.md) | — | Per-tenant daily loop for a tenant fleet | ✅ shipped |
| 06 | [Stage 0 — Spine](./06-stage0-spine.md) | 0 | E-8 receipts on the live ledger, ৳, by:nova doors, export, undo window | ⬜ |
| 07 | [Stage 1 — Law](./07-stage1-law.md) | 1 | Authority engine v2 + 65-duty registry + canonical org | ⬜ |
| 08 | [Stage 2 — Consent](./08-stage2-consent.md) | 2 | Decision service: one record, every surface, zero drift | ⬜ |
| 09 | [Stage 3 — Proof](./09-stage3-proof.md) | 3 | Campaign vertical + night shift v2 + brief v2 — **company milestone** | ⬜ |
| 10 | [Stage 4 — Craft](./10-stage4-craft.md) | 4 | Content Studio + brand voice (bn+en) | ⬜ |
| 11 | [Stage 5 — Conversation](./11-stage5-conversation.md) | 5 | CEO-Nova-routed, agent-signed, ledger-grounded chat | ⬜ |
| 12 | [Stage 6 — Reach](./12-stage6-reach.md) | 6 | Broadcasts, Research, Growth, Goals + 4 sub-view doors; zero `NEEDS DOOR` | ⬜ |
| 13 | [Stage 7 — Presence](./13-stage7-presence.md) | 7 | Voice, memory H1.2, watchdog, hours-saved, tonight's plan | ⬜ |
| 14 | [Stage 8 — Team](./14-stage8-team.md) | 8 | 11 agents, playbooks, negotiation, benchmarks | ⬜ |
| 15 | [Stage 9 — Launch hardening](./15-stage9-launch.md) | 9 | GA: 30-day pilot fleet, SLOs, red team, economics | ⬜ |

## Standing engineering rules (apply to every phase)

1. **The one rule (PRD §3):** the model layer never mutates Dakio directly. Every state
   change flows authority check → execute → append ledger entry with receipt → land
   behind a door, marked `by: nova`. If a capability can't honor that, it doesn't ship.
2. **The `StoreClient` interface is the only data path.** Tools never touch storage or
   HTTP directly.
3. **Receipts are schema-enforced (PRD §16.2).** A write missing its receipt is a
   failed write — enforced at the dakio-api layer, not model goodwill (from phase 06).
4. **New verb checklist (PRD §16.3):** authority gate-table entry + tested engineered
   inverse (if undoable) + founder-only classification, before merge. CI-checked.
5. **Tenancy comes only from verified auth** (`requireStore`), never from model input.
   Inside subagent sessions it resolves via the server-side session→tenant registry
   (phase 06 fix) — never from the delegation message.
6. **No per-tenant prompts or code on disk.** Tenant identity is data rendered by the
   context engine.
7. **Everything Nova learns is owner-visible and reversible**; memory corrections are
   receipted (phase 13).
8. **Idempotency everywhere** — eve replays interrupted steps; webhooks and jobs are
   at-least-once.
9. **Guardrail-breach evals are CI hard gates (PRD §16.4)** — one breach fails the build.
10. **Gate discipline (PRD §15/§16):** scripted demo on a clean staging store, run by a
    non-builder, zero manual DB pokes; every stage files a founder-visible artifact
    (demo recording + the ledger export from it). Scope cuts allowed; gate cuts never.
11. Engineering gates on top: `tsc --noEmit` clean · `eve build` clean · `eve info`
    0 diagnostics · phase test suite green · prior phases' suites still green.

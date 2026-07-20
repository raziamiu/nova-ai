# Phase 04 — Memory & Learning · capability report

- **Status:** shipped
- **Branch / commit:** `claude/nova-phase-4-memory-avdxb6` @ `f6277e2` (feature) + `e56339f` (adversarial hardening)
- **Date:** 2026-07-20
- **Blueprint:** `docs/blueprint/04-memory-and-learning.md`

> Before Phase 4, Nova's "memory" was a flat key/value list dumped into the
> prompt — it never forgot, but it never *learned*, and it could not tell which
> of a hundred stored facts mattered for the question in front of it. Phase 4
> makes memory a service with **semantic recall** (the right facts surface for
> the current turn, by similarity — not the whole shelf), and it closes the
> **experience → knowledge loop**: owner rejections become standing rules the
> same night (or the same second), experiments get measured against their
> targets, and heuristic revenue guesses get rewritten to real order totals.
> Every learned fact is owner-visible, carries provenance back to the decision
> it came from, and can be hard-deleted. Founder-facing: *Nova now remembers
> what you told it, learns from what you rejected, and proves what worked.*

## Gate (all must be green)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ⏸ not re-run this session — `node_modules` absent (deps never installed in this workspace); green at commit `e56339f` per phase discipline |
| `npx eve build` | ⏸ not re-run this session — same reason |
| `npx eve info` diagnostics | ⏸ not re-run this session |
| This phase's test suite | `evals/memory/run.ts` — 9 sections, ~40 assertions (run: `NOVA_DEV_STORE_ID=store-aurora npx -y tsx evals/memory/run.ts`) |
| Prior suites still green | `evals/isolation/run.ts` (Phase 3; +11 memory-isolation checks added here) · `evals/nova/*.eval.ts` (Phase 1) — `npm test` chains typecheck + isolation + memory |

> **Honesty note.** This report was written from a static code audit; the gate
> was **not** executed this session because dependencies are not installed in
> this checkout. The phase commits (`f6277e2`, then `e56339f` "harden memory
> seam per adversarial review") were made under the standing rule "don't start
> N+1 with N red." Re-running the gate needs `npm install` first — see the
> repo's top-level status report. Do not read ⏸ as ✅.

## New capabilities this phase

Each line: capability → evidence → caveat.

- **Memory as a tenant-scoped service** — `agent/lib/memory/service.ts`
  (`upsert` / `retrieveRelevant` / `listNamespace` / `remove` / `distill`).
  Every entry point takes an explicit `storeId`; there is **no ambient
  default**, so a caller physically cannot touch memory without naming a tenant.
- **Semantic vector recall (L3)** — `agent/lib/memory/vector.ts`. Score =
  `0.6·cosine + 0.25·recencyDecay + 0.15·weight`, threshold `0.35`, top-K
  `K≤8`, deduped by `(namespace,key)` — exactly the blueprint scoring contract.
  A hardening guard drops any entry with `similarity ≤ 0` so a recent/high-weight
  but semantically-unrelated (or un-embedded) fact can't clear the threshold on
  recency+weight alone (`vector.ts:104-105`). — *Caveat: brute-force cosine over
  in-memory vectors; pgvector/HNSW is the prod swap, not wired (Phase 2 backend).*
- **Embedding pipeline with two backends** — `agent/lib/memory/embed.ts`.
  Default is a **deterministic** FNV-1a feature-hashing stub (256-dim, token +
  bigram, L2-normalized) so recall is byte-reproducible with no model key; the
  gateway path (`voyage-3.5-lite` via the `ai` SDK, 1024-dim, lazy-imported) is
  gated behind `NOVA_EMBEDDINGS=gateway`. — *Caveat: dev/tests use the stub;
  the gateway path is unexercised without a key.*
- **Embed worker / outbox pattern** — `service.runEmbedWorker`. Writes leave
  `embedding = null`; the worker fills them in batches (≤64). Stub mode embeds
  inline for immediate consistency; gateway mode leaves it for the async worker
  so a write never blocks a turn.
- **Per-turn semantic retrieval into context** — `agent/instructions/30-memory.ts`
  builds the recall hint from the tail of the conversation (last user message,
  capped 500 chars) and calls `buildRelevantMemory → retrieveRelevant` on
  `turn.started`. The right memories render into L3 for the turn, tenant-scoped.
- **Rejection fast-path — learn immediately** — `service.learnFromRejection`,
  called synchronously from `reject_action`. A rejected action writes a
  `preferences` standing objection *the same second*, with provenance (the
  rejected action id) and a lower weight (0.6 — a learned candidate, not an
  owner-authored rule). No waiting for nightly reflection to stop a repeat.
- **Nightly reflection loop** — `agent/lib/memory/reflection.ts` +
  `agent/schedules/reflection.ts` (cron `0 3 * * *`) + `agent/skills/reflection.md`.
  Groups the day's rejections by action type into standing `rules` (a repeated
  objection earns weight 0.9 vs 0.7 for a one-off), runs the experiment
  evaluator + attribution, records an owner-visible "Reflection: what I learned"
  activity, and **dedupes** the now-superseded fast-path candidate. Hard bound:
  **≤10 writes per run**, enforced across *both* the rejection and experiment
  steps (`reflection.ts:117-123`). Every write is `source: reflection` with
  linked action ids — no silent drift. — *Caveat: the default distiller is
  **deterministic/rule-based**, not model-driven; `runGatewayReflection`
  currently delegates to the deterministic path (`reflection.ts:161-166`), so
  the versioned prompt in `skills/reflection.md` is not yet the live distiller.
  Single-tenant / dev-dispatch until the Phase 05 per-tenant dispatcher.*
- **Experiments — the data flywheel** — `agent/lib/memory/experiments.ts` +
  tools `create_experiment` / `evaluate_experiments`. A hypothesis carries a
  metric (`roas7d` / `revenue7d` / `cpa7d`; cpa is lower-is-better), baseline,
  target, and the action ids that enact it. The evaluator measures the linked
  campaign's real metric via `computeCampaignMetrics`, marks it
  won/lost/inconclusive, and records the outcome to `experiments` memory with
  provenance (falling back to the experiment id so no learned memory is ever
  written without a traceable origin). — *Caveat: metrics computed off the demo
  campaign dataset.*
- **Attribution upgrade — measured revenue over heuristic** —
  `agent/lib/memory/attribution.ts`. Joins a cart-recovery activity to the order
  that actually recovered it (same customer, eligible order after abandonment,
  earliest wins) and rewrites `revenueInfluence` in place to the real order
  total with `revenueBasis: "measured"` + provenance. Conservative: an
  unrecovered cart keeps its estimate rather than being zeroed on a guess. —
  *Caveat: covers cart recovery only; other revenue-influence heuristics
  unchanged.*
- **Owner-visible, reversible learning** — `remember` / `recall` / `forget`
  tools strip the embedding vector from anything returned to the model (it's an
  index, not content); `forget` is a **hard delete** of the row *and* its
  embedding together (compliance). Every learned write carries `source` +
  `provenance` for the (future) memory UI.
- **Tenant isolation of memory & vectors** — proven, not just asserted:
  `evals/memory/run.ts` §7 writes an Aurora-only secret and confirms Beacon's
  recall and L3 context contain neither the key nor its text, while Aurora's own
  recall does surface it.

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| Memory System ("Nova never forgets") | 🟡 flat prompt dump | ✅ structured + semantic | Namespaced source-of-truth + vector recall + provenance; owner-visible/reversible. Caveat: demo backend. |
| Product Philosophy → "Learns" | ⬜ | 🟡 | Reflection loop turns rejections/experiments into durable knowledge; deterministic distiller, single-tenant dev-dispatch. |
| Core Principle 2 — Context Aware | 🟡 all-facts-in-prompt | ✅ relevant-facts-per-turn | L3 retrieves top-K by similarity to the current turn. |
| Trust System (reason/impact/undo/approval) | 🟡 | ✅ (learning slice) | Learned memory is owner-visible, provenance-carried, hard-deletable. |
| Success Metric — Revenue Influenced | 🟡 heuristic | 🟡→✅ (cart recovery) | Measured attribution replaces the 25%-of-cart heuristic where a recovering order exists. |

## Scenario walkthroughs

### Scenario 1 — "We never discount over 15%" sticks across sessions
Monday, the founder tells Nova in chat: *"We never discount over 15% now."*
`remember` writes it to `rules/discount-cap` and embeds it. Thursday, in a
brand-new session, the founder asks *"should we run a 25%-off promo this
weekend?"* On `turn.started`, `30-memory.ts` builds the hint from that question,
`retrieveRelevant` scores the discount rule far above the unrelated courier note
(cosine dominates), and the 15% cap renders verbatim into L3 — so Nova proposes
a ≤15% promo and cites the standing rule instead of re-asking. *(Grounded:
`evals/memory/run.ts` §2 asserts exactly this recall + ranking + verbatim-in-L3.)*
**Today vs vision:** recall works on the deterministic stub embeddings; a
production `voyage`-class model + pgvector would sharpen ranking on paraphrases,
but the loop is real today.

### Scenario 2 — Reject a supplier twice, Nova stops proposing it
Nova prepares a purchase order from Supplier X. The founder rejects it —
*"Supplier X is unreliable."* The rejection fast-path writes a `preferences`
standing objection **synchronously**, so even the very next proposal that night
sees it. Nova prepares another PO from X anyway (different context); the founder
rejects again. At 03:00, nightly reflection groups both rejections by type into
one `rules/avoid-create_purchase_order` entry (weight 0.9 because it repeated),
links **both** action ids as provenance, files a "what I learned" note for the
morning report, and deletes the now-superseded fast-path candidate so memory
stays lean. The next time inventory wants to reorder, the standing objection is
in context. *(Grounded: §3 fast-path + §4 distillation/provenance/dedup.)*

### Scenario 3 — A cart-recovery guess becomes a measured number
Nova sends a recovery message to an abandoned cart and books an *estimated*
$30 of influence (heuristic). Two days later the customer buys — a $150 order.
The nightly attribution pass finds the recovering order (same customer, placed
after abandonment), rewrites the activity's `revenueInfluence` to **$150**,
flips `revenueBasis` to `measured` with provenance `recovered by order …`, and
marks the cart recovered. A different cart with no follow-on order keeps its $20
estimate — Nova never fabricates a recovery. *(Grounded: §6 asserts $150
measured, `measured` basis + provenance, and the unrecovered cart untouched.)*
**Today vs vision:** the orders/carts are the demo dataset; against live Dakio
orders (Phase 2) this same pass reports real recovered revenue in the morning
report.

## Known limitations / not yet

- **Runs on the in-memory DEMO backend.** pgvector + real embeddings + live
  order/campaign data are blocked on **Phase 2 (Dakio integration), which is
  deferred** — only the async `StoreClient` seam ("Phase 2a") was pulled
  forward. The memory *contract* is prod-shaped; the *data and vector store* are
  not live. → Phase 2.
- **Reflection distiller is deterministic, not the model.** `runGatewayReflection`
  delegates to the rule-based path; the versioned `skills/reflection.md` prompt
  isn't the live distiller yet. → gateway wiring / Phase 05.
- **Reflection is single-tenant / dev-dispatch.** Per-tenant nightly cadence
  across a fleet needs the dispatcher. → Phase 05.
- **No owner-facing memory UI.** Edit/delete/inspect-provenance in the dashboard
  is not built; the data model supports it. → Phase 06.
- **Playbook promotion not implemented.** `nova_playbooks` → dynamic-skill
  promotion (blueprint step 7) is deferred; reflection does not yet propose
  candidates. → Phase 06 (approval) / Phase 05.
- **Monthly compaction** (merge near-duplicates cosine>0.92) from the blueprint
  risk table is not implemented. → later.
- **Attribution covers cart recovery only.** Other revenue-influence heuristics
  are unchanged. → incremental.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Memory System, Context-Aware,
"Learns" (reflection), Trust System (reversible learning), Revenue-Influenced
attribution, Experiments/Growth (data flywheel). See matrix for status + evidence.

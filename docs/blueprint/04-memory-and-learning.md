# Phase 04 — Memory & Learning Architecture

**Prereq: Phase 03** (tenant identity, context engine with an L3 slot, agent-data API).
Self-contained: the full memory stack that makes Nova "never forget" and visibly learn,
per tenant, at scale.

## Objective

Layered memory (working / episodic / semantic / procedural) with retrieval that puts
the RIGHT knowledge in context at the RIGHT time, plus a reflection loop that turns
experience (actions, approvals, rejections, experiment outcomes) into durable,
owner-visible knowledge. Milestone: measurable cross-session recall and
preference-learning behaviors.

## Scope

**In**: memory service (Postgres + pgvector), embedding pipeline, retrieval policy,
reflection jobs, forgetting/compaction, owner-facing memory transparency, attribution
upgrade for `revenueInfluence`.
**Out**: fleet-level shared learning (Phase 08 note), fine-tuning (explicitly not v1).

## System architecture

```
                       WRITE PATHS                          READ PATHS
 conversation → remember tool ─┐                    ┌─► L1 profile (brand, goals — stable keys)
 action pipeline (auto) ───────┤                    ├─► L3 relevant memory (top-K vector + recency)
 trust plane (approve/reject) ─┼─► nova_memory ─────┤
 reflection jobs (nightly) ────┤   nova_actions     ├─► recall tool (keyed/namespace)
 experiment evaluator ─────────┘   nova_activity    └─► reflection reads (bulk, offline)
                                        │
                                   embed worker (async) → nova_memory.embedding (pgvector)
```

| Layer | Store | Write | Read | In context |
|---|---|---|---|---|
| Working | eve `defineState` (per session) | tools/hooks | handle | implicit |
| Conversation | eve sessions (+compaction) | harness | harness | automatic |
| Episodic | `nova_actions` + `nova_activity` (02) | action pipeline, automatic | tools; reflection | L3 when relevant |
| Semantic | `nova_memory` + embedding | `remember`, reflection, trust signals | keyed + vector | L1 stable keys; L3 top-K |
| Procedural | authored skills + `nova_playbooks` | engineering; reflection promotion | dynamic skills | on `load_skill` |

## Design decisions

1. **eve `defineState` stays working-memory only.** It is per-session, non-shared,
   throws outside session scope — correct for scratch state (e.g. "today's already-
   surfaced alerts"), wrong for anything durable. All durable memory is external
   (eve's own recommended pattern).
2. **Semantic memory is structured-first, vectors-second.** Namespaced key/values
   (`goals, brand, preferences, rules, insights, experiments, customers`) remain the
   source of truth; embeddings are an INDEX for retrieval, not the storage. This keeps
   memory auditable and editable by the owner (PRD: transparency).
3. **Retrieval policy is tiered, not "RAG everything":** stable identity keys
   (brand/goals/rules) are ALWAYS in L1; L3 adds top-K (K≤8) by cosine similarity
   against a query built from the current turn (last user message + active task) with
   recency/weight boosts; everything else is on-demand via `recall`.
4. **Reflection is a scheduled model job, not an online loop** — nightly per tenant,
   reading the day's episodic log and emitting semantic writes with provenance
   (`source: reflection`, linked action ids). Cheap model tier; bounded output.
5. **Learning is visible and reversible.** Every reflection-written memory appears in
   the dashboard memory UI (Phase 06) with provenance; owner can edit/delete; deletes
   are honored (no shadow copies).
6. **Rejections teach immediately**: `reject_action(reason)` synchronously writes a
   `preferences`/`rules` candidate ("Owner rejected X because Y") — no waiting for
   nightly reflection to stop repeating a mistake.

## EVE features to use

- Dynamic instructions `"turn.started"` (Phase 03's `30-memory.ts`) now calls the
  memory service's `retrieveRelevant(storeId, hint)`; hint = last user message
  (available via the resolver's `ctx.messages` tail) + L4 page context.
- `defineState` for per-session working sets:
  ```ts
  // agent/lib/state/working.ts
  import { defineState } from "eve/context";
  export const surfacedAlerts = defineState("nova.surfaced-alerts", () => ({ ids: [] as string[] }));
  ```
  (Never touch it from schedule `run` handlers or module top level — it throws.)
- Reflection runs as schedule-dispatched task sessions (Phase 05 dispatcher) — they
  need no human input, so eve task-mode is a fit; memory writes happen through the
  same `remember`-equivalent service calls inside tools.
- **eve limitations honored**: no vector store (we own it); session compaction is
  eve's, but *cross-session* continuity is exclusively this memory layer; subagents
  don't share state — departments read memory via their `recall` tool, and the root
  passes task-relevant memory in delegation messages.

## External services

Postgres + pgvector (Nova-owned or Dakio-hosted — decide with Dakio; contract is SQL
below). Embeddings: Vercel AI Gateway embedding model (e.g. `voyage-3.5-lite` class),
async worker, batch of ≤64. Redis (existing) for retrieval cache (30s, per turn burst).

## Data models

```sql
ALTER TABLE nova_memory ADD COLUMN id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN source text NOT NULL DEFAULT 'owner',   -- owner|nova|reflection|system
  ADD COLUMN provenance jsonb,                       -- {actionIds:[], sessionId, note}
  ADD COLUMN weight real NOT NULL DEFAULT 1.0,       -- retrieval boost; decays
  ADD COLUMN expires_at timestamptz,                 -- optional TTL (e.g. seasonal)
  ADD COLUMN embedding vector(1024);
CREATE INDEX ON nova_memory USING hnsw (embedding vector_cosine_ops);

CREATE TABLE nova_playbooks (           -- procedural promotions
  id uuid PK, store_id text, name text, description text, markdown text,
  status text CHECK (status IN ('candidate','active','retired')),
  created_from jsonb, created_at timestamptz, UNIQUE(store_id, name));

CREATE TABLE nova_experiments (
  id uuid PK, store_id text, hypothesis text, action_ids text[],
  metric text, baseline numeric, target numeric, actual numeric,
  status text CHECK (status IN ('running','won','lost','inconclusive')),
  started_at, evaluated_at);
```

## APIs & interfaces

`agent/lib/memory/service.ts` (used by tools + context engine + reflection):
```ts
upsert(storeId, entry: { namespace, key, value, source, provenance?, weight?, expiresAt? })
retrieveRelevant(storeId, hint: string, k = 8): Promise<ScoredEntry[]>   // vector + recency + weight
listNamespace(storeId, namespace) · remove(storeId, namespace, key)      // delete = hard delete + embedding
distill(storeId, day): ReflectionInput                                    // bulk episodic read for reflection
```
Scoring: `0.6·cosine + 0.25·recencyDecay(updated_at) + 0.15·weight`, threshold 0.35,
dedupe by (namespace,key). Embed worker consumes an outbox (`nova_memory` rows with
`embedding IS NULL`).

Reflection job spec (per tenant, nightly, cheap model tier): input = last 24h
episodic log + open experiments + yesterday's report; output ≤10 memory upserts +
experiment status updates + ≤1 playbook candidate; every write carries provenance.
Prompt lives in a skill (`skills/reflection.md`) so it's versioned content.

## Implementation steps

1. Schema migration + memory service + embed worker (no behavior change yet).
2. Point `remember/recall/forget` tools and L1/L3 context layers at the service
   (demo backend keeps an in-memory vector stub: brute-force cosine — fine for tests).
3. Rejection fast-path: `rejectAction()` writes the preference candidate synchronously.
4. Reflection skill + job (runs via Phase 05 dispatcher; until then, dev-dispatch route).
5. Experiments: `create_experiment`/`evaluate_experiments` internal service +
   evaluator step inside reflection; campaign/pricing actions can attach experiment ids.
6. Attribution upgrade: replace heuristic `revenueInfluence` (e.g. cart recovery 25%)
   with measured outcomes where possible (recovered cart → actual order total,
   joined by `relatedId`) — computed by a nightly attribution pass, updating
   `nova_activity.revenue_influence` in place with provenance.
7. Playbook promotion: reflection may propose; owner approves in dashboard (Phase 06);
   active playbooks served as **dynamic skills** (`defineDynamic` skill on
   `"session.started"` loading `nova_playbooks` for the tenant).

## Dependencies

Phase 03 context engine; Phase 05 dispatcher for production cadence (dev-dispatch
suffices to build/test); embedding model access via gateway.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Memory bloat → context noise | per-namespace caps (L1 keys fixed; L3 K≤8, threshold); weight decay; TTLs; monthly compaction job merges near-duplicates (cosine>0.92) |
| Reflection hallucinating "lessons" | reflection writes require provenance action ids; low-confidence outputs land as `candidate` visible in UI, not auto-trusted rules |
| Silent behavior drift | all learned memory owner-visible/editable; rules namespace changes surface in the morning report ("I learned: …") |
| Embedding cost at fleet scale | embed only on write (not read); batch; lite model; ~1 write/action avg |
| Vector infra ops | pgvector inside existing Postgres — no new database engine |

## Testing strategy

Recall evals: (session 1) "we never discount over 15% now" → (session 2, fresh) propose
a discount → assert ≤15% used and rule cited. Rejection learning: reject a PO twice →
third proposal must reference the standing objection. Retrieval unit tests: scoring
determinism, threshold, tenant isolation (A's vectors never in B's results — extend
Phase 03 suite). Reflection: golden-day fixture → assert ≤10 writes, all with
provenance. Attribution: recovered-cart fixture → influence equals order total.

## Performance considerations

`retrieveRelevant` p95 < 60ms (HNSW + K small); context assembly stays < 200ms p95
total; reflection batched off-peak; embed worker async (never blocks a turn).

## Security considerations

Memory is tenant-partitioned at SQL and service level (storeId mandatory arg — no
ambient default); reflection prompts treat episodic text as untrusted data; customer
PII in memory minimized (reference ids, not raw addresses); owner delete = hard delete
including embeddings (compliance).

## Success / exit criteria

Recall + rejection-learning evals green · isolation suite still green · context p95
within budget · reflection running nightly on dev tenants with 100% provenance ·
attribution replacing heuristics for cart recovery.

## Deliverables

Memory service + pgvector schema, embed worker, upgraded tools/context layers,
reflection skill+job, experiments service, attribution pass, playbook promotion path,
recall/learning eval suite.

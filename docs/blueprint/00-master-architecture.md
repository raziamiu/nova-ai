# Nova — Master System Architecture

**Document 00 of the Nova Engineering Blueprint** · Audience: architects & tech leads.
Phase documents 01–08 are self-contained; this document is the map that connects them.

Nova is Dakio's AI Business Operator: one dedicated, proactive digital employee per store,
operating 24/7 across ten departments, gated by owner-controlled autonomy. This document
defines the system components, how they connect, where knowledge lives, and how work
executes — for **millions of tenant stores** on a single Nova platform.

---

## 1. System components

```
┌────────────────────────────────────────────────────────────────────────────┐
│ DAKIO PLATFORM                                                             │
│  ┌──────────────┐   ┌───────────────────────┐   ┌───────────────────────┐  │
│  │ Dashboard UI │   │ Dakio Core (Express)  │   │ Dakio Event Bus       │  │
│  │ (done)       │   │ Store APIs + AgentData│   │ (webhooks/queue)      │  │
│  └──────┬───────┘   └──────────┬────────────┘   └──────────┬────────────┘  │
└─────────┼──────────────────────┼───────────────────────────┼───────────────┘
          │ chat/stream/approve  │ tenant-scoped HTTPS       │ events
┌─────────▼──────────────────────▼───────────────────────────▼───────────────┐
│ NOVA SERVICE (one eve app deployment, serves ALL tenants)                  │
│                                                                            │
│  Channels          Harness (eve runtime)            Tool Layer             │
│  ├ dashboard  ──►  ┌─────────────────────────┐  ┌──────────────────────┐   │
│  ├ webhooks   ──►  │ durable sessions/turns  │──│ 38+ typed tools      │   │
│  └ internal   ──►  │ context assembly        │  │ (all tenant-scoped)  │   │
│                    │ department subagents ×10│  └─────────┬────────────┘   │
│  Dispatcher        └─────────────────────────┘            │                │
│  (per-tenant cron) Action Pipeline: gate → execute/prepare/block → undo    │
└───────────────────────────────────────────────────────────┼────────────────┘
                                                            │
        ┌──────────────┬──────────────┬─────────────────────┼──────────────┐
        │ Postgres     │ pgvector     │ Redis               │ Model Gateway│
        │ (Nova state: │ (semantic    │ (context cache,     │ (Anthropic   │
        │ memory, jobs,│ memory)      │ rate/cost budgets)  │ via Vercel   │
        │ actions log) │              │                     │ AI Gateway)  │
        └──────────────┴──────────────┴─────────────────────┴──────────────┘
```

| Component | Responsibility | Built on |
|---|---|---|
| **Nova Agent Core** | Persona, orchestration, department subagents, tools | eve (filesystem-first agent) |
| **StoreClient layer** | ONLY path to tenant business data; demo backend today, Dakio HTTP client in prod | authored TypeScript (`agent/lib/store/`) |
| **Action Pipeline** | Autonomy gate → execute/prepare/block; justification; undo; audit | authored (`agent/lib/nova/actions.ts`) |
| **Context Engine** | Assembles per-tenant, per-turn model context (no static tenant prompts) | eve dynamic instructions + Redis cache |
| **Memory Service** | Episodic/semantic/procedural memory, reflection, forgetting | Postgres + pgvector, nightly jobs |
| **Proactive Engine** | Per-tenant schedules + event-driven triggers | eve schedule dispatcher pattern + Dakio webhooks |
| **Trust Plane** | Prepared-action queue, approvals, guardrails, kill switch, audit | Postgres + dashboard APIs |
| **Observability** | Traces, token/cost metering per tenant, SLOs | eve instrumentation → OTel |

## 2. Agent orchestration

- **One root agent ("Nova")** owns the conversation, the persona, and accountability.
- **Ten department subagents** (`ceo, marketing, sales, support, product_research,
  inventory, supplier_manager, courier_manager, finance, growth`) are eve subagents:
  isolated context windows, scoped toolsets, own instructions. Root delegates
  multi-step department work; handles quick lookups itself.
- Why subagents (vs one giant toolset): context isolation (department work doesn't
  pollute the founder conversation), parallelism (eve runs concurrent subagent calls),
  per-department model tiering, and independent evallability.
- eve reality to respect: **subagents inherit nothing** — tools are shared by
  re-exporting root tool modules; procedures shared via `lib/` imports. Delegation is
  NOT a security boundary; every tool re-derives tenancy and autonomy itself.
- Orchestration for fan-out jobs (e.g. nightly ops across departments) stays
  model-driven within a session; deterministic cross-tenant fan-out lives OUTSIDE the
  model in the Dispatcher (§7).

## 3. Context management (dynamic, never static)

Static markdown is allowed for exactly one thing: Nova's invariant persona and operating
contract. Everything tenant-specific is assembled at runtime:

| Layer | Content | Source | Refresh | Budget |
|---|---|---|---|---|
| L0 Persona core | identity, principles, autonomy contract, style | authored `instructions.md` | deploy | ~700 tok |
| L1 Tenant profile | store name, vertical, currency, plan, brand voice, goals | Dakio API + memory | `session.started`, cached 24h | ~400 tok |
| L2 Live ops state | autonomy level+guardrails, pending approvals, active alerts digest | Nova DB | `turn.started`, no cache | ~300 tok |
| L3 Relevant memory | top-K semantic + recent episodic relevant to current task | pgvector similarity | `turn.started` | ~500 tok |
| L4 Page/task context | current dashboard page, selected entity, active workflow | client `clientContext` per message | per message | ~150 tok |
| L5 Everything else | catalog, orders, campaigns, finance… | tools, on demand | live | unbounded, tool-paged |

Implementation: eve **dynamic instructions** (`defineDynamic` on `session.started` /
`turn.started`) render L1–L3; the channel's `onMessage` maps client-provided page
context into L4; tools are L5. All injected values are labeled as **data, not
instructions** (prompt-injection trust boundary). Details: Phase 03.

## 4. Memory architecture (the intelligence layers beyond Dakio data)

| Layer | Why it exists | Stored where | Written by | Retrieved how | At inference |
|---|---|---|---|---|---|
| Working memory | current-task scratch state | eve `defineState` (per-session, durable across turns) | tools/hooks | in-process handle | implicit |
| Conversation history | dialogue continuity | eve sessions (Workflow SDK) | harness | harness replay + compaction | automatic |
| Episodic memory | "what happened & what we did": every action, decision, outcome | Postgres `nova_actions`, `nova_activity` | Action Pipeline (automatic) | tools (`list_actions`, `get_activity_report`) + reflection jobs | L3 when relevant; trust UI always |
| Semantic memory | durable facts: goals, brand voice, preferences, rules, customer notes | Postgres `nova_memory` (+pgvector embedding) | `remember` tool + reflection distillation | keyed recall + top-K similarity | L1 (stable) + L3 (relevant) |
| Procedural memory | how Nova performs recurring jobs | authored eve skills + per-tenant playbook skills (dynamic) | engineering + reflection promotions | eve `load_skill` | on demand |
| Decision history | approvals/rejections → preference learning | `nova_actions` (status transitions) | trust plane | reflection jobs | distilled into semantic rules |
| Business knowledge | commerce expertise (benchmarks, playbooks) | versioned skill packs | engineering | `load_skill` | on demand |
| Planning state | today's focus, weekly commitments | `nova_memory` namespace `goals` | strategy schedules | L1 injection | every turn |
| Execution logs | debugging, audit, billing | OTel traces + eve event stream → warehouse | instrumentation | ops tooling | never |

Two eve limitations drive this design (both documented in eve's own guidance):
`defineState` is **per-session only** and **never crosses the subagent boundary** —
therefore all cross-session intelligence lives in external storage behind
tenant-scoped tools; and nothing in eve is a vector store — semantic retrieval is our
own service. Details: Phase 04.

## 5. Data flow

**Interactive turn**: Dashboard → Nova channel (Dakio JWT) → auth maps to
`SessionAuthContext{ attributes.storeId }` → context engine assembles L0–L4 → model →
tool calls (each tool re-derives `storeId` from session auth, calls Dakio API /
Nova DB) → action pipeline for mutations → streamed reply + events → dashboard.

**Proactive run**: Dispatcher cron fires → claims due tenant jobs from `nova_jobs` →
`receive()` into the internal channel with a synthetic tenant principal → same context
assembly → same tools → outcomes land as reports/prepared actions in Nova DB →
dashboard surfaces them; push/email via notification service. **No approval can park a
scheduled run** (eve constraint) — the prepared-action queue absorbs everything needing
a human.

**Event-driven**: Dakio webhook (order.created, cart.abandoned, ticket.opened) →
webhook channel route (HMAC-verified) → debounced/deduped into `nova_jobs` → dispatcher
path above. Events are queued, never model-invoked synchronously — protects the model
budget from event storms.

## 6. Multi-tenant isolation

- **Identity**: tenancy comes ONLY from verified auth (`ctx.session.auth.current.attributes.storeId`),
  set by the channel auth layer from Dakio-signed JWTs. Model input is never trusted
  for tenancy. One `requireStore(ctx)` guard used by every tool.
- **Data**: every Nova table keyed by `store_id` (+ Postgres RLS as defense-in-depth);
  Dakio APIs called with tenant-scoped service tokens; Redis keys prefixed `t:{storeId}:`.
- **Compute/cost**: per-tenant token budgets, action rate limits, and concurrency caps
  enforced in the tool layer + dispatcher (eve's limits are per-session, not per-tenant —
  our metering wraps it).
- **Configuration**: autonomy level, guardrails, quiet hours, brand voice — all rows in
  Nova DB, injected per turn. No per-tenant code, no per-tenant prompts on disk.
- **Blast radius**: per-tenant kill switch (`nova_tenants.status = paused`) checked in
  `turn.started` hook + dispatcher; one tenant's failure never blocks the fleet.

## 7. AI execution pipeline

```
trigger (chat | schedule | event)
  → tenant resolution (auth / job row)          [hard fail if missing]
  → kill-switch + budget check                  [cheap, Redis]
  → context assembly (L0–L4)
  → model turn (root Nova)
      ↳ tool calls (reads)                      [tenant-scoped]
      ↳ subagent delegation (departments)       [isolated context]
      ↳ mutations → Action Pipeline:
           gate(autonomy, guardrails, risk)
           → executed  (+undo snapshot, +activity, +audit)
           → prepared  (queue for owner)
           → blocked   (explained)
  → outputs: reply / report / notifications
  → metering + traces
```

Model tiering (via eve dynamic model selection + per-subagent models): routine/bulk
work (support drafts, pulse scans) → Haiku-class; core operator loop → Sonnet-class
(`anthropic/claude-sonnet-5`); strategy (weekly/CEO synthesis) → Opus-class. Selection
at `session.started` per job type; never mid-conversation.

## 8. Long-term learning

Learning = data flywheel, not fine-tuning (v1):
1. Every action stores justification + outcome (episodic).
2. Owner approvals/rejections are preference signals; rejection reasons are distilled
   into `rules`/`preferences` memory by nightly **reflection jobs** (scheduled model
   runs that read the week's episodic log and write/update semantic entries).
3. Experiment outcomes (campaigns, pricing) are written to `experiments` memory with
   success criteria evaluated against actuals.
4. Promotions: recurring successful procedures become per-tenant playbook skills.
5. Fleet-level (privacy-safe, aggregated) benchmarks feed the shared knowledge packs.
Guardrail: reflection writes are themselves autonomy-gated artifacts — visible and
editable by the owner (memory UI), never silent behavior drift.

## 9. Scalability

- Nova service is stateless serverless (Vercel/Node 24); eve sessions are durable via
  Workflow SDK backing store — horizontal scale by default. For self-hosted scale-out,
  pin `@workflow/world-postgres`.
- Hot paths cached: tenant profile (24h), business snapshot (60s), anomaly scan (5m).
- Dispatcher shards by `store_id` hash; N dispatcher lanes; at-least-once with
  idempotent jobs (idempotency key = `job_id`).
- Cost ceilings: per-tenant daily token budget by plan; degrade gracefully (skip pulse
  runs before skipping morning report; never skip approvals surfacing).
- Millions of tenants ⇒ the binding constraint is **model spend**, not compute:
  aggressive tiering + snapshot caching + event debouncing are first-class features.

## 10. Security

- AuthN: Dakio-signed JWT (JWKS) at the channel; `placeholderAuth` never ships.
- AuthZ: role attributes (owner vs staff) gate trust-plane tools (approve/reject/undo,
  autonomy config). eve approval-parks add interactive confirmation for owner-only ops.
- Approval ≠ authorization: policies re-checked inside `execute` at run time.
- Injection defense: customer messages/reviews/webhooks and memory values are labeled
  untrusted data in context; instructions require flag-don't-follow; high-risk tools
  ignore instruction-like content provenance (Phase 07).
- Secrets: only in Nova app runtime env; never in sandbox (sandbox networking
  `deny-all`; Nova needs no code execution).
- Audit: immutable action log with actor (nova|owner|schedule), justification,
  before/after snapshots.

## 11. Extensibility

- New department = new subagent directory (instructions + tool re-exports). No core changes.
- New action = payload schema + executor + undoer + risk class entry. The gate,
  queue, audit, and UI pick it up automatically.
- New data source = new connection (eve MCP/OpenAPI connection) or StoreClient method.
- New channel (WhatsApp founder chat, Slack) = eve channel file; same sessions.
- Skill packs are versioned content — shippable without deploys (dynamic skills).

## 12. EVE capability map (summary; each phase doc carries its own details)

| Need | EVE fit | Verdict |
|---|---|---|
| Durable sessions, streaming, HITL parks | native | ✅ use as-is |
| Typed tools + approval policies | native (`defineTool`, approvals) | ✅ use as-is |
| Department agents | subagents | ✅ use (share via re-export/lib) |
| Dynamic per-tenant context | dynamic instructions/skills/model | ✅ use — core of tenancy |
| Persona | static instructions.md | ✅ minimal core only |
| Cross-session memory | ❌ `defineState` is per-session | build: Postgres/pgvector service |
| Per-tenant scheduling | ❌ schedules are static, root-only, UTC, no HITL parks | build: dispatcher + `nova_jobs` (eve's documented dynamic-scheduling pattern) |
| Approvals in background runs | ❌ task-mode can't park | build: prepared-action queue (already core to PRD trust system) |
| Vector retrieval / reflection | ❌ none | build: memory service + scheduled reflection |
| Per-tenant cost metering | ❌ per-session limits only | build: Redis budgets + instrumentation |
| Observability | instrumentation hooks | ✅ wire to OTel |

## 13. Phase roadmap

| # | Phase | Milestone (testable) | Doc |
|---|---|---|---|
| 01 | Foundation Agent Core *(shipped)* | Nova operates a demo store end-to-end in `eve dev` | `01-foundation-agent-core.md` |
| 02 | Dakio Integration | Nova operates one real dev store via Express APIs + webhooks | `02-dakio-integration.md` |
| 03 | Multi-Tenant Core | Two stores, one deployment, zero leakage, dynamic context | `03-multi-tenant-core.md` |
| 04 | Memory & Learning | Cross-session recall + nightly reflection, measurable | `04-memory-and-learning.md` |
| 05 | Proactive Operations | Per-tenant daily loop + event triggers for a tenant fleet | `05-proactive-operations.md` |
| 06 | Dashboard Experience | Chat, task feed, approvals, reports wired to the done UI | `06-dashboard-experience.md` |
| 07 | Trust, Safety & Autonomy at Scale | Guardrail engine, audit, budgets, kill switch, injection defense | `07-trust-safety-scale.md` |
| 08 | Scale, Observability & Production | Load-tested fleet, SLOs, cost dashboards, rollout | `08-scale-observability-production.md` |

Each phase ends green (typecheck + `eve build` + phase test suite) before the next begins.
